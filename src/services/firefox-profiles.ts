import { z } from "zod";

export const firefoxBookmarkFolderSchema = z.object({
  guid: z.string(),
  title: z.string(),
  path: z.string(),
});

export const firefoxBookmarkSchema = z.object({
  guid: z.string(),
  title: z.string(),
  url: z.string(),
});

export type FirefoxBookmarkFolder = z.infer<typeof firefoxBookmarkFolderSchema>;
export type FirefoxBookmark = z.infer<typeof firefoxBookmarkSchema>;

/** Max folder matches shown in the settings search results. */
export const FIREFOX_FOLDER_SEARCH_RESULT_LIMIT = 25;

export type FirefoxFolderSearchResult = {
  matches: readonly FirefoxBookmarkFolder[];
  totalMatches: number;
  truncated: boolean;
  /** Raw matches before descendant collapsing (for UI copy). */
  rawMatchCount: number;
};

const folderDepth = (folderPath: string): number =>
  folderPath.length === 0 ? 0 : folderPath.split(" / ").length;

const isDescendantPath = (candidatePath: string, ancestorPath: string): boolean =>
  candidatePath === ancestorPath || candidatePath.startsWith(`${ancestorPath} / `);

/**
 * Rank higher = better. Prefer exact title, then title contains, then shallow paths.
 */
const scoreFolderMatch = (folder: FirefoxBookmarkFolder, normalisedQuery: string): number => {
  const title = folder.title.toLowerCase();
  const folderPath = folder.path.toLowerCase();
  const depth = folderDepth(folder.path);

  let score = 0;
  if (title === normalisedQuery) {
    score += 1000;
  } else if (title.includes(normalisedQuery)) {
    score += 500;
  }

  if (folderPath === normalisedQuery) {
    score += 400;
  } else if (folderPath.endsWith(` / ${normalisedQuery}`) || folderPath.endsWith(normalisedQuery)) {
    score += 300;
  } else if (folderPath.includes(normalisedQuery)) {
    score += 100;
  }

  // Prefer shallower folders so "Recent" beats deep grandchildren.
  score += Math.max(0, 50 - depth);
  return score;
};

const compareByRelevance = (
  left: FirefoxBookmarkFolder,
  right: FirefoxBookmarkFolder,
  normalisedQuery: string,
): number => {
  const scoreDelta =
    scoreFolderMatch(right, normalisedQuery) - scoreFolderMatch(left, normalisedQuery);
  if (scoreDelta !== 0) {
    return scoreDelta;
  }
  const depthDelta = folderDepth(left.path) - folderDepth(right.path);
  if (depthDelta !== 0) {
    return depthDelta;
  }
  return left.path.localeCompare(right.path);
};

const compareByDepthThenPath = (
  left: FirefoxBookmarkFolder,
  right: FirefoxBookmarkFolder,
): number => {
  const depthDelta = folderDepth(left.path) - folderDepth(right.path);
  if (depthDelta !== 0) {
    return depthDelta;
  }
  return left.path.localeCompare(right.path);
};

// ES2021 lib has no Array#toSorted; copy then sort in place.
const sortedFolders = (
  folders: readonly FirefoxBookmarkFolder[],
  compare: (left: FirefoxBookmarkFolder, right: FirefoxBookmarkFolder) => number,
): FirefoxBookmarkFolder[] =>
  // eslint-disable-next-line unicorn/no-array-sort -- Array#toSorted needs ES2023 lib
  [...folders].sort(compare);

/**
 * Drop matches that are under another match — selecting a parent already syncs subfolders.
 * Input should be sorted shallowest-first for stable collapsing.
 */
export const collapseDescendantFolderMatches = (
  folders: readonly FirefoxBookmarkFolder[],
): FirefoxBookmarkFolder[] => {
  const kept: FirefoxBookmarkFolder[] = [];
  for (const folder of folders) {
    const coveredByKept = kept.some((ancestor) => isDescendantPath(folder.path, ancestor.path));
    if (!coveredByKept) {
      kept.push(folder);
    }
  }
  return kept;
};

/**
 * Filters bookmark folders by title/path query for the settings picker.
 * Empty query returns no matches — callers should show selected folders separately.
 *
 * Results prefer the folder the user likely means (title/shallow path) and hide
 * descendants of other matches, since sync already includes subfolders recursively.
 */
export const searchFirefoxBookmarkFolders = (
  folders: readonly FirefoxBookmarkFolder[],
  query: string,
  limit: number = FIREFOX_FOLDER_SEARCH_RESULT_LIMIT,
): FirefoxFolderSearchResult => {
  const normalised = query.trim().toLowerCase();
  if (normalised.length === 0) {
    return { matches: [], totalMatches: 0, truncated: false, rawMatchCount: 0 };
  }

  const rawMatches = sortedFolders(
    folders.filter((folder) => {
      const title = folder.title.toLowerCase();
      const folderPath = folder.path.toLowerCase();
      return title.includes(normalised) || folderPath.includes(normalised);
    }),
    (left, right) => compareByRelevance(left, right, normalised),
  );

  // Collapse shallowest-first so parents win over children, then re-rank for display.
  const shallowFirst = sortedFolders(rawMatches, compareByDepthThenPath);
  const collapsed = sortedFolders(collapseDescendantFolderMatches(shallowFirst), (left, right) =>
    compareByRelevance(left, right, normalised),
  );

  return {
    matches: collapsed.slice(0, limit),
    totalMatches: collapsed.length,
    truncated: collapsed.length > limit,
    rawMatchCount: rawMatches.length,
  };
};

export type FirefoxProfileCandidate = {
  name: string;
  path: string;
  isDefault: boolean;
};

export type ParsedProfilesIni = {
  profilesDirectory: string;
  profiles: readonly FirefoxProfileCandidate[];
};

const installSectionPrefix = "Install";
const profileSectionPrefix = "Profile";

const parseIniSections = (content: string): Map<string, Map<string, string>> => {
  const sections = new Map<string, Map<string, string>>();
  let currentSection = "";

  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith(";") || line.startsWith("#")) {
      continue;
    }

    const sectionMatch = /^\[(.+)\]$/u.exec(line);
    if (sectionMatch !== null) {
      currentSection = sectionMatch[1] ?? "";
      if (!sections.has(currentSection)) {
        sections.set(currentSection, new Map());
      }
      continue;
    }

    const keyValueMatch = /^([^=]+)=(.*)$/u.exec(line);
    if (keyValueMatch === null || currentSection.length === 0) {
      continue;
    }

    const key = keyValueMatch[1]?.trim() ?? "";
    const value = keyValueMatch[2]?.trim() ?? "";
    const section = sections.get(currentSection);
    if (section !== undefined) {
      section.set(key, value);
    }
  }

  return sections;
};

const resolveProfilePath = (
  profilesDirectory: string,
  pathValue: string,
  isRelative: boolean,
): string => {
  if (!isRelative) {
    return pathValue;
  }
  return `${profilesDirectory.replace(/\/$/u, "")}/${pathValue.replace(/^\//u, "")}`;
};

/**
 * Parses Firefox `profiles.ini` content into profile candidates.
 */
export const parseProfilesIni = (content: string, profilesDirectory: string): ParsedProfilesIni => {
  const sections = parseIniSections(content);
  const defaultPaths = new Set<string>();

  for (const [sectionName, values] of sections.entries()) {
    if (!sectionName.startsWith(installSectionPrefix)) {
      continue;
    }
    const defaultPath = values.get("Default");
    if (defaultPath !== undefined && defaultPath.length > 0) {
      defaultPaths.add(defaultPath);
    }
  }

  const profiles: FirefoxProfileCandidate[] = [];

  for (const [sectionName, values] of sections.entries()) {
    if (!sectionName.startsWith(profileSectionPrefix)) {
      continue;
    }

    const pathValue = values.get("Path");
    if (pathValue === undefined || pathValue.length === 0) {
      continue;
    }

    const isRelative = values.get("IsRelative") !== "0";
    const resolvedPath = resolveProfilePath(profilesDirectory, pathValue, isRelative);
    const name = values.get("Name") ?? sectionName;
    const isInstallDefault = defaultPaths.has(pathValue);
    const isProfileDefault = values.get("Default") === "1";
    const isDefault = defaultPaths.size > 0 ? isInstallDefault : isProfileDefault;

    profiles.push({ name, path: resolvedPath, isDefault });
  }

  return { profilesDirectory, profiles };
};

/**
 * Picks the default profile from parsed candidates, or the first profile if none marked default.
 */
export const selectDefaultProfile = (
  profiles: readonly FirefoxProfileCandidate[],
): FirefoxProfileCandidate | undefined => {
  if (profiles.length === 0) {
    return undefined;
  }
  return profiles.find((profile) => profile.isDefault) ?? profiles[0];
};

/**
 * Returns typical Firefox install roots that contain `profiles.ini`.
 */
export const getFirefoxProfilesIniRoots = (
  homeDirectory: string,
  platform: NodeJS.Platform,
): string[] => {
  if (platform === "darwin") {
    return [`${homeDirectory}/Library/Application Support/Firefox`];
  }

  if (platform === "win32") {
    const appData = process.env["APPDATA"];
    return appData === undefined ? [] : [`${appData}\\Mozilla\\Firefox`];
  }

  return [
    `${homeDirectory}/.mozilla/firefox`,
    `${homeDirectory}/snap/firefox/common/.mozilla/firefox`,
    `${homeDirectory}/.var/app/org.mozilla.firefox/.mozilla/firefox`,
  ];
};
