import { getDesktopNodeModules } from "@/utils/desktop-fs";
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

const readFileToBuffer = (fs: NodeFs, filePath: string): Buffer => {
  const contents = fs.readFileSync(filePath);
  return Buffer.isBuffer(contents) ? contents : Buffer.from(contents);
};

const describeFileSnapshot = (fs: NodeFs, filePath: string): Record<string, unknown> => {
  if (!fs.existsSync(filePath)) {
    return { path: filePath, exists: false };
  }
  const stats = fs.statSync(filePath);
  return {
    path: filePath,
    exists: true,
    size: stats.size,
    mtimeMs: stats.mtimeMs,
  };
};

const getChildProcessModule = (): ChildProcessModule | undefined => {
  const globalWindow = globalThis as typeof globalThis & {
    require?: (moduleId: string) => unknown;
  };
  return globalWindow.require?.("node:child_process") as ChildProcessModule | undefined;
};

/**
 * Checkpoint a copied places DB (+ WAL) into a single file sql.js can read.
 * Prefers the sqlite3 CLI; falls back to Python's sqlite3 module (common on Linux).
 */
const tryMergeWalDatabaseCopy = (
  fs: NodeFs,
  path: NodePath,
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
      source: describeFileSnapshot(fs, sourcePath),
      wal: describeFileSnapshot(fs, `${sourcePath}-wal`),
      shm: describeFileSnapshot(fs, `${sourcePath}-shm`),
    },
    debugContext,
  );

  const mergeAttempts: readonly { label: string; run: () => void }[] = [
    {
      label: "sqlite3",
      run: () => {
        childProcess.execFileSync("sqlite3", [sourcePath, `.backup ${mergedPath}`], {
          stdio: "pipe",
        });
      },
    },
    {
      label: "python3",
      run: () => {
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
        childProcess.execFileSync("python3", ["-c", script, sourcePath, mergedPath], {
          stdio: "pipe",
        });
      },
    },
  ];

  for (const attempt of mergeAttempts) {
    try {
      if (fs.existsSync(mergedPath)) {
        fs.rmSync(mergedPath, { recursive: false, force: true });
      }
      const startedAt = Date.now();
      attempt.run();
      if (fs.existsSync(mergedPath)) {
        const mergedBuffer = new Uint8Array(readFileToBuffer(fs, mergedPath));
        firefoxDebugLog(
          "tryMergeWalDatabaseCopy: merge succeeded",
          {
            via: attempt.label,
            elapsedMs: Date.now() - startedAt,
            merged: describeFileSnapshot(fs, mergedPath),
            mergedBufferByteLength: mergedBuffer.byteLength,
          },
          debugContext,
        );
        return mergedBuffer;
      }
      firefoxDebugWarn(
        "tryMergeWalDatabaseCopy: merged file missing after attempt",
        {
          via: attempt.label,
        },
        debugContext,
      );
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
  const placesPath = path.join(profileDirectory, "places.sqlite");
  if (!fs.existsSync(placesPath)) {
    throw new FirefoxBookmarksError(FIREFOX_NOTICE.placesMissingOrUnreadable);
  }

  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "syncer-firefox-"));
  try {
    const walPath = `${placesPath}-wal`;
    const shmPath = `${placesPath}-shm`;
    const copiedPlacesPath = path.join(temporaryDirectory, "places.sqlite");
    const copiedWalPath = path.join(temporaryDirectory, "places.sqlite-wal");
    const walSidecarsPresent = fs.existsSync(walPath);
    firefoxDebugLog(
      "copyPlacesDatabase: source snapshot",
      {
        profileDirectory,
        temporaryDirectory,
        walSidecarsPresent,
        places: describeFileSnapshot(fs, placesPath),
        wal: describeFileSnapshot(fs, walPath),
        shm: describeFileSnapshot(fs, shmPath),
      },
      debugContext,
    );

    // Hot-copy policy: main + WAL only (see listPlacesHotCopyRelativeNames).
    const copyStartedAt = Date.now();
    for (const relativeName of listPlacesHotCopyRelativeNames(walSidecarsPresent)) {
      const source =
        relativeName === "places.sqlite" ? placesPath : path.join(profileDirectory, relativeName);
      const destination = path.join(temporaryDirectory, relativeName);
      fs.copyFileSync(source, destination);
    }
    if (walSidecarsPresent) {
      // Re-copy WAL after the main DB so frames written during the main copy are included.
      fs.copyFileSync(walPath, copiedWalPath);
    }
    firefoxDebugLog(
      "copyPlacesDatabase: hot-copy complete",
      {
        elapsedMs: Date.now() - copyStartedAt,
        copiedPlaces: describeFileSnapshot(fs, copiedPlacesPath),
        copiedWal: describeFileSnapshot(fs, copiedWalPath),
        liveWalAfterCopy: describeFileSnapshot(fs, walPath),
      },
      debugContext,
    );

    if (walSidecarsPresent) {
      const mergedBuffer = tryMergeWalDatabaseCopy(fs, path, temporaryDirectory, debugContext);
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

    const buffer = readFileToBuffer(fs, copiedPlacesPath);
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
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
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
    if (error instanceof Error && error.message.includes("sql-wasm.wasm")) {
      throw new FirefoxBookmarksError(FIREFOX_NOTICE.wasmNotFound, error);
    }
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

  const { fs, os } = nodeModules;
  const roots = getFirefoxProfilesIniRoots(os.homedir(), process.platform);
  const candidates: FirefoxProfileCandidate[] = [];

  for (const root of roots) {
    const iniPath = `${root}/profiles.ini`;
    if (!fs.existsSync(iniPath)) {
      continue;
    }

    try {
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
    if (nodeModules?.fs.existsSync(trimmedManual) !== true) {
      throw new FirefoxBookmarksError(FIREFOX_NOTICE.profilePathNotFound);
    }
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
