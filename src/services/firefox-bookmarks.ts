import { getDesktopNodeModules } from "@/utils/desktop-fs";
import {
  createFirefoxPathGuard,
  FIREFOX_PROFILE_READ_BASENAMES,
  FIREFOX_TEMP_READ_BASENAMES,
  type FirefoxPathGuard,
} from "@/utils/firefox-fs-guard";
import { resolveTrustedBinary } from "@/utils/trusted-binary";
import {
  firefoxDebugError,
  firefoxDebugLog,
  firefoxDebugWarn,
  type FirefoxDebugContext,
} from "@/services/firefox-debug";
import { FIREFOX_NOTICE } from "@/services/firefox-messages";
import {
  getFirefoxProfilesIniRoots,
  parseProfilesIni,
  selectDefaultProfile,
  type FirefoxBookmark,
  type FirefoxBookmarkFolder,
  type FirefoxProfileCandidate,
} from "@/services/firefox-profiles";
import { openPlacesDatabase } from "@/services/sql-js-loader";
import { formatLogError } from "@/utils/error-formatters";
import type { NodeFs, NodeOs, NodePath } from "@/utils/desktop-fs";
import type { Database } from "sql.js";

export {
  firefoxBookmarkFolderSchema,
  firefoxBookmarkSchema,
  type FirefoxBookmark,
  type FirefoxBookmarkFolder,
  type FirefoxProfileCandidate,
} from "@/services/firefox-profiles";

const BOOKMARK_TYPE = 1;
const FOLDER_TYPE = 2;
const PLACE_PREFIX = "place:";

/** Stable Places GUID for the tags root (moz_bookmarks_roots was removed in Firefox 31). */
export const FIREFOX_TAGS_ROOT_GUID = "tags________";

/**
 * Relative names to hot-copy from a Firefox profile for places reads.
 * Never includes `-shm` — copying Firefox's live WAL index can hide newest frames.
 */
export const listPlacesHotCopyRelativeNames = (
  walPresent: boolean,
): readonly ["places.sqlite"] | readonly ["places.sqlite", "places.sqlite-wal"] =>
  walPresent ? ["places.sqlite", "places.sqlite-wal"] : ["places.sqlite"];

export class FirefoxBookmarksError extends Error {
  public readonly userMessage: string;
  public readonly cause?: unknown;

  public constructor(userMessage: string, cause?: unknown) {
    super(userMessage);
    this.name = "FirefoxBookmarksError";
    this.userMessage = userMessage;
    this.cause = cause;
  }
}

type PlacesCopyResult = {
  buffer: Uint8Array;
  walSidecarsPresent: boolean;
  walMerged: boolean;
};

type ChildProcessModule = {
  execFileSync: (file: string, arguments_: readonly string[], options: { stdio: "pipe" }) => Buffer;
};

const readFileToBuffer = (
  fs: NodeFs,
  guard: FirefoxPathGuard,
  filePath: string,
  allowedBasenames: ReadonlySet<string>,
): Buffer => {
  const safePath = guard.assertReadablePath(filePath, allowedBasenames);
  const contents = fs.readFileSync(safePath);
  return Buffer.isBuffer(contents) ? contents : Buffer.from(contents);
};

const describeFileSnapshot = (
  fs: NodeFs,
  guard: FirefoxPathGuard,
  filePath: string,
  allowedBasenames: ReadonlySet<string>,
): Record<string, unknown> => {
  try {
    const safePath = guard.assertReadablePath(filePath, allowedBasenames);
    if (!fs.existsSync(safePath)) {
      return { path: safePath, exists: false };
    }
    const stats = fs.statSync(safePath);
    return {
      path: safePath,
      exists: true,
      size: stats.size,
      mtimeMs: stats.mtimeMs,
    };
  } catch {
    return { path: filePath, exists: false, guarded: false };
  }
};

const getChildProcessModule = (): ChildProcessModule | undefined => {
  const browserWindow = window as Window & {
    require?: (moduleId: string) => unknown;
  };
  return browserWindow.require?.("node:child_process") as ChildProcessModule | undefined;
};

/**
 * Checkpoint a copied places DB (+ WAL) into a single file sql.js can read.
 * Prefers the sqlite3 CLI; falls back to Python's sqlite3 module (common on Linux).
 */
const tryMergeWalDatabaseCopy = (
  fs: NodeFs,
  path: NodePath,
  os: NodeOs,
  guard: FirefoxPathGuard,
  temporaryDirectory: string,
  debugContext?: FirefoxDebugContext,
): Uint8Array | undefined => {
  const childProcess = getChildProcessModule();
  if (childProcess === undefined) {
    firefoxDebugWarn("tryMergeWalDatabaseCopy: child_process unavailable", undefined, debugContext);
    return undefined;
  }

  const sourcePath = path.join(temporaryDirectory, "places.sqlite");
  const mergedPath = path.join(temporaryDirectory, "merged.sqlite");
  firefoxDebugLog(
    "tryMergeWalDatabaseCopy: start",
    {
      source: describeFileSnapshot(fs, guard, sourcePath, FIREFOX_TEMP_READ_BASENAMES),
      wal: describeFileSnapshot(fs, guard, `${sourcePath}-wal`, FIREFOX_TEMP_READ_BASENAMES),
      shm: describeFileSnapshot(fs, guard, `${sourcePath}-shm`, FIREFOX_TEMP_READ_BASENAMES),
    },
    debugContext,
  );

  const sqliteBinary = resolveTrustedBinary(fs, path, os, "sqlite3");
  const pythonBinary = resolveTrustedBinary(fs, path, os, "python3");

  const mergeAttempts: readonly { label: string; run: () => void }[] = [
    ...(sqliteBinary === undefined
      ? []
      : [
          {
            label: "sqlite3",
            run: () => {
              const safeSource = guard.assertReadablePath(sourcePath, FIREFOX_TEMP_READ_BASENAMES);
              const safeMerged = guard.assertWritablePath(mergedPath, FIREFOX_TEMP_READ_BASENAMES);
              childProcess.execFileSync(sqliteBinary, [safeSource, `.backup ${safeMerged}`], {
                stdio: "pipe",
              });
            },
          },
        ]),
    ...(pythonBinary === undefined
      ? []
      : [
          {
            label: "python3",
            run: () => {
              const safeSource = guard.assertReadablePath(sourcePath, FIREFOX_TEMP_READ_BASENAMES);
              const safeMerged = guard.assertWritablePath(mergedPath, FIREFOX_TEMP_READ_BASENAMES);
              const script = `
import sqlite3, sys
src, dst = sys.argv[1], sys.argv[2]
src_conn = sqlite3.connect(src)
dst_conn = sqlite3.connect(dst)
with dst_conn:
    src_conn.backup(dst_conn)
dst_conn.close()
src_conn.close()
`;
              childProcess.execFileSync(pythonBinary, ["-c", script, safeSource, safeMerged], {
                stdio: "pipe",
              });
            },
          },
        ]),
  ];

  if (mergeAttempts.length === 0) {
    firefoxDebugWarn(
      "tryMergeWalDatabaseCopy: no trusted sqlite3/python3 binary found",
      undefined,
      debugContext,
    );
    return undefined;
  }

  for (const attempt of mergeAttempts) {
    try {
      if (fs.existsSync(guard.assertWritablePath(mergedPath, FIREFOX_TEMP_READ_BASENAMES))) {
        fs.rmSync(guard.assertRemovablePath(mergedPath), { recursive: false, force: true });
      }
      const startedAt = Date.now();
      attempt.run();
      if (!fs.existsSync(mergedPath)) {
        firefoxDebugWarn(
          "tryMergeWalDatabaseCopy: merged file missing after attempt",
          {
            via: attempt.label,
          },
          debugContext,
        );
        continue;
      }
      const safeMergedPath = guard.assertReadablePath(mergedPath, FIREFOX_TEMP_READ_BASENAMES);
      const mergedBuffer = new Uint8Array(
        readFileToBuffer(fs, guard, safeMergedPath, FIREFOX_TEMP_READ_BASENAMES),
      );
      firefoxDebugLog(
        "tryMergeWalDatabaseCopy: merge succeeded",
        {
          via: attempt.label,
          elapsedMs: Date.now() - startedAt,
          merged: describeFileSnapshot(fs, guard, safeMergedPath, FIREFOX_TEMP_READ_BASENAMES),
          mergedBufferByteLength: mergedBuffer.byteLength,
        },
        debugContext,
      );
      return mergedBuffer;
    } catch (error) {
      firefoxDebugWarn(
        "tryMergeWalDatabaseCopy: merge attempt failed",
        {
          via: attempt.label,
          errorMessage: error instanceof Error ? error.message : String(error),
        },
        debugContext,
      );
    }
  }

  firefoxDebugError("tryMergeWalDatabaseCopy: all merge attempts failed", undefined, debugContext);
  return undefined;
};

const copyPlacesDatabase = (
  fs: NodeFs,
  path: NodePath,
  os: NodeOs,
  profileDirectory: string,
  debugContext?: FirefoxDebugContext,
): PlacesCopyResult => {
  const guard = createFirefoxPathGuard({
    fs,
    path,
    firefoxProfileIniRoots: getFirefoxProfilesIniRoots(os.homedir(), process.platform),
    profileDirectory,
  });

  const placesPath = path.join(profileDirectory, "places.sqlite");
  if (!fs.existsSync(placesPath)) {
    throw new FirefoxBookmarksError(FIREFOX_NOTICE.placesMissingOrUnreadable);
  }
  guard.assertReadablePath(placesPath, FIREFOX_PROFILE_READ_BASENAMES);

  const temporaryDirectory = guard.createTempDirectory(path.join(os.tmpdir(), "syncer-firefox-"));
  try {
    const walPath = `${placesPath}-wal`;
    const copiedPlacesPath = path.join(temporaryDirectory, "places.sqlite");
    const copiedWalPath = path.join(temporaryDirectory, "places.sqlite-wal");
    const walSidecarsPresent =
      fs.existsSync(walPath) &&
      (() => {
        try {
          guard.assertReadablePath(walPath, FIREFOX_PROFILE_READ_BASENAMES);
          return true;
        } catch {
          return false;
        }
      })();
    firefoxDebugLog(
      "copyPlacesDatabase: source snapshot",
      {
        profileDirectory,
        temporaryDirectory,
        walSidecarsPresent,
        places: describeFileSnapshot(fs, guard, placesPath, FIREFOX_PROFILE_READ_BASENAMES),
        wal: describeFileSnapshot(fs, guard, walPath, FIREFOX_PROFILE_READ_BASENAMES),
      },
      debugContext,
    );

    // Hot-copy policy: main + WAL only (see listPlacesHotCopyRelativeNames).
    const copyStartedAt = Date.now();
    for (const relativeName of listPlacesHotCopyRelativeNames(walSidecarsPresent)) {
      const source =
        relativeName === "places.sqlite" ? placesPath : path.join(profileDirectory, relativeName);
      const destination = path.join(temporaryDirectory, relativeName);
      fs.copyFileSync(
        guard.assertReadablePath(source, FIREFOX_PROFILE_READ_BASENAMES),
        guard.assertWritablePath(destination, FIREFOX_TEMP_READ_BASENAMES),
      );
    }
    if (walSidecarsPresent) {
      // Re-copy WAL after the main DB so frames written during the main copy are included.
      fs.copyFileSync(
        guard.assertReadablePath(walPath, FIREFOX_PROFILE_READ_BASENAMES),
        guard.assertWritablePath(copiedWalPath, FIREFOX_TEMP_READ_BASENAMES),
      );
    }
    firefoxDebugLog(
      "copyPlacesDatabase: hot-copy complete",
      {
        elapsedMs: Date.now() - copyStartedAt,
        copiedPlaces: describeFileSnapshot(
          fs,
          guard,
          copiedPlacesPath,
          FIREFOX_TEMP_READ_BASENAMES,
        ),
        copiedWal: describeFileSnapshot(fs, guard, copiedWalPath, FIREFOX_TEMP_READ_BASENAMES),
        liveWalAfterCopy: describeFileSnapshot(fs, guard, walPath, FIREFOX_PROFILE_READ_BASENAMES),
      },
      debugContext,
    );

    if (walSidecarsPresent) {
      const mergedBuffer = tryMergeWalDatabaseCopy(
        fs,
        path,
        os,
        guard,
        temporaryDirectory,
        debugContext,
      );
      if (mergedBuffer !== undefined) {
        firefoxDebugLog(
          "copyPlacesDatabase: using merged buffer",
          {
            mergedBufferByteLength: mergedBuffer.byteLength,
          },
          debugContext,
        );
        return { buffer: mergedBuffer, walSidecarsPresent: true, walMerged: true };
      }
      firefoxDebugWarn(
        "copyPlacesDatabase: WAL merge failed, falling back to main copy",
        undefined,
        debugContext,
      );
    }

    const buffer = readFileToBuffer(fs, guard, copiedPlacesPath, FIREFOX_TEMP_READ_BASENAMES);
    firefoxDebugLog(
      "copyPlacesDatabase: using main sqlite copy",
      {
        bufferByteLength: buffer.byteLength,
        walSidecarsPresent,
      },
      debugContext,
    );
    return {
      buffer: new Uint8Array(buffer),
      walSidecarsPresent,
      walMerged: false,
    };
  } finally {
    fs.rmSync(guard.assertRemovablePath(temporaryDirectory), { recursive: true, force: true });
  }
};

const queryAll = <T extends Record<string, unknown>>(
  database: Database,
  sql: string,
  parameters: readonly unknown[] = [],
): T[] => {
  const statement = database.prepare(sql);
  try {
    statement.bind(parameters);
    const rows: T[] = [];
    while (statement.step()) {
      rows.push(statement.getAsObject() as T);
    }
    return rows;
  } finally {
    statement.free();
  }
};

/** Resolves the tags folder id from the stable Places GUID. Exported for unit tests. */
export const resolveFirefoxTagsRootId = (database: Database): number | undefined => {
  const rows = queryAll<{ id: number }>(database, "SELECT id FROM moz_bookmarks WHERE guid = ?", [
    FIREFOX_TAGS_ROOT_GUID,
  ]);
  return rows[0]?.id;
};

const isUnderTagsRoot = (
  database: Database,
  parentId: number,
  tagsRootId: number | undefined,
): boolean => {
  if (tagsRootId === undefined) {
    return false;
  }

  let currentId: number | undefined = parentId;
  const visited = new Set<number>();

  while (currentId !== undefined && !visited.has(currentId)) {
    if (currentId === tagsRootId) {
      return true;
    }
    visited.add(currentId);
    const parentRows: { parent: number | null }[] = queryAll(
      database,
      "SELECT parent FROM moz_bookmarks WHERE id = ?",
      [currentId],
    );
    currentId = parentRows[0]?.parent ?? undefined;
  }

  return false;
};

const buildFolderPath = (
  folderId: number,
  titleById: Map<number, string>,
  parentById: Map<number, number | undefined>,
): string => {
  const segments: string[] = [];
  let currentId: number | undefined = folderId;
  const visited = new Set<number>();

  while (currentId !== undefined && !visited.has(currentId)) {
    visited.add(currentId);
    const title = titleById.get(currentId);
    if (title !== undefined && title.length > 0) {
      segments.unshift(title);
    }
    currentId = parentById.get(currentId);
  }

  return segments.join(" / ");
};

const listBookmarkFoldersFromDatabase = (database: Database): FirefoxBookmarkFolder[] => {
  const folderRows = queryAll<{
    id: number;
    guid: string;
    title: string | null;
    parent: number | null;
  }>(database, "SELECT id, guid, title, parent FROM moz_bookmarks WHERE type = ? ORDER BY title", [
    FOLDER_TYPE,
  ]);

  const titleById = new Map<number, string>();
  const parentById = new Map<number, number | undefined>();
  for (const row of folderRows) {
    titleById.set(row.id, row.title?.trim() ?? "(Untitled folder)");
    parentById.set(row.id, row.parent ?? undefined);
  }

  return folderRows.map((row) => ({
    guid: row.guid,
    title: titleById.get(row.id) ?? "(Untitled folder)",
    path: buildFolderPath(row.id, titleById, parentById),
  }));
};

const fetchBookmarksUnderFolderGuids = (
  database: Database,
  folderGuids: readonly string[],
  debugContext?: FirefoxDebugContext,
): FirefoxBookmark[] => {
  const tagsRootId = resolveFirefoxTagsRootId(database);
  const bookmarks: FirefoxBookmark[] = [];
  const seenGuids = new Set<string>();
  firefoxDebugLog(
    "fetchBookmarksUnderFolderGuids: start",
    {
      folderGuids: [...folderGuids],
      tagsRootId: tagsRootId ?? "(missing)",
    },
    debugContext,
  );

  for (const folderGuid of folderGuids) {
    if (folderGuid === FIREFOX_TAGS_ROOT_GUID) {
      firefoxDebugLog(
        "fetchBookmarksUnderFolderGuids: skipping tags root",
        { folderGuid },
        debugContext,
      );
      continue;
    }

    const rows = queryAll<{
      guid: string;
      title: string | null;
      url: string | null;
      parent: number;
    }>(
      database,
      `
      WITH RECURSIVE tree AS (
        SELECT id, guid, type, fk, parent, title
        FROM moz_bookmarks
        WHERE guid = ?
        UNION ALL
        SELECT b.id, b.guid, b.type, b.fk, b.parent, b.title
        FROM moz_bookmarks b
        JOIN tree t ON b.parent = t.id
        WHERE b.guid != ?
      )
      SELECT t.guid, t.title, h.url, t.parent
      FROM tree t
      LEFT JOIN moz_places h ON t.fk = h.id
      WHERE t.type = ?
      `,
      [folderGuid, FIREFOX_TAGS_ROOT_GUID, BOOKMARK_TYPE],
    );

    let skippedPlaceOrEmpty = 0;
    let skippedUnderTags = 0;
    let skippedDuplicate = 0;
    const keptTitles: string[] = [];

    for (const row of rows) {
      if (row.url === null || row.url.length === 0 || row.url.startsWith(PLACE_PREFIX)) {
        skippedPlaceOrEmpty += 1;
        continue;
      }
      if (isUnderTagsRoot(database, row.parent, tagsRootId)) {
        skippedUnderTags += 1;
        continue;
      }
      if (seenGuids.has(row.guid)) {
        skippedDuplicate += 1;
        continue;
      }
      seenGuids.add(row.guid);
      keptTitles.push(row.title?.trim() ?? row.url);
      bookmarks.push({
        guid: row.guid,
        title: row.title?.trim() ?? row.url,
        url: row.url,
      });
    }

    firefoxDebugLog(
      "fetchBookmarksUnderFolderGuids: folder results",
      {
        folderGuid,
        rawRows: rows.length,
        kept: keptTitles.length,
        skippedPlaceOrEmpty,
        skippedUnderTags,
        skippedDuplicate,
        keptTitles,
        rawRowsPreview: rows.slice(0, 20).map((row) => ({
          guid: row.guid,
          title: row.title,
          url: row.url,
          parent: row.parent,
        })),
      },
      debugContext,
    );
  }

  firefoxDebugLog(
    "fetchBookmarksUnderFolderGuids: complete",
    {
      total: bookmarks.length,
      titles: bookmarks.map((bookmark) => bookmark.title),
    },
    debugContext,
  );
  return bookmarks;
};

const withPlacesDatabase = async <T>(
  profileDirectory: string,
  // Retained for call-site compatibility and debug breadcrumbs.
  wasmDirectory: string,
  operation: (
    database: Database,
    copyResult: Pick<PlacesCopyResult, "walSidecarsPresent" | "walMerged">,
  ) => T,
  debugContext?: FirefoxDebugContext,
): Promise<T> => {
  firefoxDebugLog("withPlacesDatabase: start", { profileDirectory, wasmDirectory }, debugContext);
  const nodeModules = getDesktopNodeModules();
  if (nodeModules === undefined) {
    firefoxDebugError("withPlacesDatabase: node modules unavailable", undefined, debugContext);
    throw new FirefoxBookmarksError(FIREFOX_NOTICE.couldNotOpenDatabase);
  }

  const { fs, path, os } = nodeModules;
  let buffer: Uint8Array;
  let walSidecarsPresent = false;
  let walMerged = false;

  try {
    const copyResult = copyPlacesDatabase(fs, path, os, profileDirectory, debugContext);
    buffer = copyResult.buffer;
    walSidecarsPresent = copyResult.walSidecarsPresent;
    walMerged = copyResult.walMerged;
    firefoxDebugLog(
      "withPlacesDatabase: copy result",
      {
        bufferByteLength: buffer.byteLength,
        walSidecarsPresent,
        walMerged,
      },
      debugContext,
    );
  } catch (error) {
    firefoxDebugError(
      "withPlacesDatabase: copy failed",
      {
        errorMessage: error instanceof Error ? error.message : String(error),
      },
      debugContext,
    );
    if (error instanceof FirefoxBookmarksError) {
      throw error;
    }
    throw new FirefoxBookmarksError(FIREFOX_NOTICE.placesMissingOrUnreadable, error);
  }

  let database: Database | undefined;
  try {
    database = await openPlacesDatabase(buffer, wasmDirectory, debugContext);
    firefoxDebugLog("withPlacesDatabase: sql.js open succeeded", undefined, debugContext);
    return operation(database, { walSidecarsPresent, walMerged });
  } catch (error) {
    firefoxDebugError(
      "withPlacesDatabase: sql.js open failed",
      {
        errorMessage: error instanceof Error ? error.message : String(error),
      },
      debugContext,
    );
    console.error(`Failed to open Firefox places database: [${formatLogError(error)}].`);
    throw new FirefoxBookmarksError(FIREFOX_NOTICE.couldNotOpenDatabase, error);
  } finally {
    database?.close();
  }
};

const readProfilesIniCandidates = (): FirefoxProfileCandidate[] => {
  const nodeModules = getDesktopNodeModules();
  if (nodeModules === undefined) {
    return [];
  }

  const { fs, os, path } = nodeModules;
  const roots = getFirefoxProfilesIniRoots(os.homedir(), process.platform);
  let guard: FirefoxPathGuard;
  try {
    guard = createFirefoxPathGuard({
      fs,
      path,
      firefoxProfileIniRoots: roots,
    });
  } catch (error) {
    throw new FirefoxBookmarksError(FIREFOX_NOTICE.profilePathNotFound, error);
  }
  const candidates: FirefoxProfileCandidate[] = [];

  for (const root of roots) {
    const iniPath = `${root}/profiles.ini`;
    try {
      if (!fs.existsSync(iniPath)) {
        continue;
      }
      guard.assertReadablePath(iniPath, FIREFOX_PROFILE_READ_BASENAMES);
      const content = fs.readFileSync(iniPath, "utf8");
      if (typeof content !== "string") {
        continue;
      }
      const parsed = parseProfilesIni(content, root);
      candidates.push(...parsed.profiles);
    } catch (error) {
      console.warn(
        `Failed to parse Firefox profiles.ini at ${iniPath}: [${formatLogError(error)}].`,
      );
    }
  }

  return candidates;
};

const resolveProfileDirectory = (manualProfilePath: string | undefined): string => {
  const trimmedManual = manualProfilePath?.trim();
  if (trimmedManual !== undefined && trimmedManual.length > 0) {
    const nodeModules = getDesktopNodeModules();
    if (nodeModules === undefined) {
      throw new FirefoxBookmarksError(FIREFOX_NOTICE.profilePathNotFound);
    }
    const { fs, path, os } = nodeModules;
    if (!fs.existsSync(trimmedManual)) {
      throw new FirefoxBookmarksError(FIREFOX_NOTICE.profilePathNotFound);
    }
    const guard = createFirefoxPathGuard({
      fs,
      path,
      firefoxProfileIniRoots: getFirefoxProfilesIniRoots(os.homedir(), process.platform),
      profileDirectory: trimmedManual,
    });
    const placesPath = path.join(trimmedManual, "places.sqlite");
    if (!fs.existsSync(placesPath)) {
      throw new FirefoxBookmarksError(FIREFOX_NOTICE.profilePathNotFound);
    }
    guard.assertReadablePath(placesPath, FIREFOX_PROFILE_READ_BASENAMES);
    return trimmedManual;
  }

  const candidates = readProfilesIniCandidates();
  const selected = selectDefaultProfile(candidates);
  if (selected === undefined) {
    throw new FirefoxBookmarksError(FIREFOX_NOTICE.profilePathNotFound);
  }

  return selected.path;
};

export type FetchFirefoxFoldersResult = {
  profileDirectory: string;
  folders: readonly FirefoxBookmarkFolder[];
};

export type FetchFirefoxBookmarksResult = {
  profileDirectory: string;
  bookmarks: readonly FirefoxBookmark[];
  walSidecarsPresent: boolean;
  walMerged: boolean;
};

/**
 * Lists bookmark folders from the resolved Firefox profile.
 */
export const fetchFirefoxBookmarkFolders = async (
  manualProfilePath: string | undefined,
  wasmDirectory: string,
): Promise<FetchFirefoxFoldersResult> => {
  const profileDirectory = resolveProfileDirectory(manualProfilePath);
  const folders = await withPlacesDatabase(profileDirectory, wasmDirectory, (database) =>
    listBookmarkFoldersFromDatabase(database),
  );
  return { profileDirectory, folders };
};

/**
 * Fetches bookmarks recursively from the selected folder GUIDs.
 */
export const fetchFirefoxBookmarks = async (
  manualProfilePath: string | undefined,
  folderGuids: readonly string[],
  wasmDirectory: string,
  debugContext?: FirefoxDebugContext,
): Promise<FetchFirefoxBookmarksResult> => {
  firefoxDebugLog(
    "fetchFirefoxBookmarks: request",
    {
      manualProfilePath: manualProfilePath ?? "(auto)",
      folderGuids: [...folderGuids],
      wasmDirectory,
    },
    debugContext,
  );
  const profileDirectory = resolveProfileDirectory(manualProfilePath);
  firefoxDebugLog("fetchFirefoxBookmarks: resolved profile", { profileDirectory }, debugContext);
  let walSidecarsPresent = false;
  let walMerged = false;
  const bookmarks = await withPlacesDatabase(
    profileDirectory,
    wasmDirectory,
    (database, copyMeta) => {
      walSidecarsPresent = copyMeta.walSidecarsPresent;
      walMerged = copyMeta.walMerged;
      return fetchBookmarksUnderFolderGuids(database, folderGuids, debugContext);
    },
    debugContext,
  );
  firefoxDebugLog(
    "fetchFirefoxBookmarks: response",
    {
      profileDirectory,
      bookmarkCount: bookmarks.length,
      titles: bookmarks.map((bookmark) => bookmark.title),
      walSidecarsPresent,
      walMerged,
    },
    debugContext,
  );
  return { profileDirectory, bookmarks, walSidecarsPresent, walMerged };
};
