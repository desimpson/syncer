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
