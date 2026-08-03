import { z } from "zod";
import { getDesktopNodeModules } from "@/utils/desktop-fs";
import { FIREFOX_NOTICE } from "@/services/firefox-messages";
import {
  firefoxDebugError,
  firefoxDebugLog,
  logPlacesDatabaseAttempt,
  logPlacesDatabaseFailure,
} from "@/services/firefox-debug";
import {
  getFirefoxProfilesIniRoots,
  parseProfilesIni,
  selectDefaultProfile,
  type FirefoxBookmark,
  type FirefoxBookmarkFolder,
  type FirefoxProfileCandidate,
} from "@/services/firefox-profiles";
import { openPlacesDatabase } from "@/services/sql-js-loader";
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
};

const readFileToBuffer = (fs: NodeFs, filePath: string): Buffer => {
  const contents = fs.readFileSync(filePath);
  return Buffer.isBuffer(contents) ? contents : Buffer.from(contents);
};

const tryMergeWalDatabaseCopy = (
  fs: NodeFs,
  path: NodePath,
  temporaryDirectory: string,
): Uint8Array | undefined => {
  const globalWindow = globalThis as typeof globalThis & {
    require?: (moduleId: string) => unknown;
  };
  type ChildProcessModule = {
    execFileSync: (
      file: string,
      arguments_: readonly string[],
      options: { stdio: "pipe" },
    ) => Buffer;
  };
  const childProcess = globalWindow.require?.("node:child_process") as
    | ChildProcessModule
    | undefined;
  if (childProcess === undefined) {
    return undefined;
  }

  const sourcePath = path.join(temporaryDirectory, "places.sqlite");
  const mergedPath = path.join(temporaryDirectory, "merged.sqlite");

  try {
    childProcess.execFileSync("sqlite3", [sourcePath, `.backup ${mergedPath}`], {
      stdio: "pipe",
    });
  } catch {
    return undefined;
  }

  if (!fs.existsSync(mergedPath)) {
    return undefined;
  }

  return new Uint8Array(readFileToBuffer(fs, mergedPath));
};

const copyPlacesDatabase = (
  fs: NodeFs,
  path: NodePath,
  os: NodeOs,
  profileDirectory: string,
): PlacesCopyResult => {
  const placesPath = path.join(profileDirectory, "places.sqlite");
  if (!fs.existsSync(placesPath)) {
    throw new FirefoxBookmarksError(FIREFOX_NOTICE.placesMissingOrUnreadable);
  }

  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "syncer-firefox-"));
  try {
    const walPath = `${placesPath}-wal`;
    const shmPath = `${placesPath}-shm`;
    const walSidecarsPresent = fs.existsSync(walPath) || fs.existsSync(shmPath);

    fs.copyFileSync(placesPath, path.join(temporaryDirectory, "places.sqlite"));
    if (fs.existsSync(walPath)) {
      fs.copyFileSync(walPath, path.join(temporaryDirectory, "places.sqlite-wal"));
    }
    if (fs.existsSync(shmPath)) {
      fs.copyFileSync(shmPath, path.join(temporaryDirectory, "places.sqlite-shm"));
    }

    if (walSidecarsPresent) {
      const mergedBuffer = tryMergeWalDatabaseCopy(fs, path, temporaryDirectory);
      if (mergedBuffer !== undefined) {
        return { buffer: mergedBuffer, walSidecarsPresent: true };
      }
    }

    const copiedPlacesPath = path.join(temporaryDirectory, "places.sqlite");
    const buffer = readFileToBuffer(fs, copiedPlacesPath);
    return { buffer: new Uint8Array(buffer), walSidecarsPresent };
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

const getTagsRootId = (database: Database): number | undefined => {
  const rows = queryAll<{ folder_id: number }>(
    database,
    "SELECT folder_id FROM moz_bookmarks_roots WHERE root_name = 'tags'",
  );
  return rows[0]?.folder_id;
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
    const parentRows: { parent: number | null }[] = queryAll<{ parent: number | null }>(
      database,
      "SELECT parent FROM moz_bookmarks WHERE id = ?",
      [currentId],
    );
    const parent = parentRows[0]?.parent;
    currentId = parent ?? undefined;
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
  const folderRows = queryAll<{ id: number; guid: string; title: string | null }>(
    database,
    "SELECT id, guid, title FROM moz_bookmarks WHERE type = ? ORDER BY title",
    [FOLDER_TYPE],
  );

  const titleById = new Map<number, string>();
  const parentById = new Map<number, number | undefined>();
  for (const row of folderRows) {
    titleById.set(row.id, row.title?.trim() ?? "(Untitled folder)");
    const parentRows = queryAll<{ parent: number | null }>(
      database,
      "SELECT parent FROM moz_bookmarks WHERE id = ?",
      [row.id],
    );
    const parent = parentRows[0]?.parent;
    parentById.set(row.id, parent ?? undefined);
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
): FirefoxBookmark[] => {
  const tagsRootId = getTagsRootId(database);
  const bookmarks: FirefoxBookmark[] = [];
  const seenGuids = new Set<string>();

  for (const folderGuid of folderGuids) {
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
      )
      SELECT t.guid, t.title, h.url, t.parent
      FROM tree t
      LEFT JOIN moz_places h ON t.fk = h.id
      WHERE t.type = ?
      `,
      [folderGuid, BOOKMARK_TYPE],
    );

    for (const row of rows) {
      if (row.url === null || row.url.length === 0 || row.url.startsWith(PLACE_PREFIX)) {
        continue;
      }
      if (isUnderTagsRoot(database, row.parent, tagsRootId)) {
        continue;
      }
      if (seenGuids.has(row.guid)) {
        continue;
      }
      seenGuids.add(row.guid);
      bookmarks.push({
        guid: row.guid,
        title: row.title?.trim() ?? row.url,
        url: row.url,
      });
    }
  }

  return bookmarks;
};

const withPlacesDatabase = async <T>(
  profileDirectory: string,
  wasmDirectory: string,
  operation: (database: Database, walSidecarsPresent: boolean) => T,
): Promise<T> => {
  firefoxDebugLog("withPlacesDatabase: start", { profileDirectory, wasmDirectory });

  const nodeModules = getDesktopNodeModules();
  if (nodeModules === undefined) {
    firefoxDebugError("withPlacesDatabase: getDesktopNodeModules() returned undefined");
    throw new FirefoxBookmarksError(FIREFOX_NOTICE.couldNotOpenDatabase);
  }

  const { fs, path, os } = nodeModules;
  let buffer: Uint8Array;
  let walSidecarsPresent = false;

  try {
    const copyResult = copyPlacesDatabase(fs, path, os, profileDirectory);
    buffer = copyResult.buffer;
    walSidecarsPresent = copyResult.walSidecarsPresent;
    firefoxDebugLog("withPlacesDatabase: copied places.sqlite", {
      profileDirectory,
      bufferByteLength: buffer.byteLength,
      walSidecarsPresent,
    });
  } catch (error) {
    firefoxDebugError("withPlacesDatabase: copy failed", {
      profileDirectory,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    if (error instanceof FirefoxBookmarksError) {
      throw error;
    }
    throw new FirefoxBookmarksError(FIREFOX_NOTICE.placesMissingOrUnreadable, error);
  }

  logPlacesDatabaseAttempt({
    profileDirectory,
    wasmDirectory,
    bufferByteLength: buffer.byteLength,
    walSidecarsPresent,
  });

  let database: Database | undefined;
  try {
    database = await openPlacesDatabase(buffer, wasmDirectory);
    firefoxDebugLog("withPlacesDatabase: sql.js open succeeded");
    return operation(database, walSidecarsPresent);
  } catch (error) {
    logPlacesDatabaseFailure({ wasmDirectory, error });
    if (error instanceof Error && error.message.includes("sql-wasm.wasm")) {
      throw new FirefoxBookmarksError(FIREFOX_NOTICE.wasmNotFound, error);
    }
    console.error("Failed to open Firefox places database:", error);
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
      console.warn(`Failed to parse Firefox profiles.ini at ${iniPath}:`, error);
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
): Promise<FetchFirefoxBookmarksResult> => {
  const profileDirectory = resolveProfileDirectory(manualProfilePath);
  let walSidecarsPresent = false;
  const bookmarks = await withPlacesDatabase(
    profileDirectory,
    wasmDirectory,
    (database, sidecarsPresent) => {
      walSidecarsPresent = sidecarsPresent;
      return fetchBookmarksUnderFolderGuids(database, folderGuids);
    },
  );
  return { profileDirectory, bookmarks, walSidecarsPresent };
};

export const firefoxProfilesIniSchema = z.object({
  profilesDirectory: z.string(),
  profiles: z.array(
    z.object({
      name: z.string(),
      path: z.string(),
      isDefault: z.boolean(),
    }),
  ),
});
