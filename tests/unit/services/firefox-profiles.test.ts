import { describe, expect, it } from "vitest";
import {
  collapseDescendantFolderMatches,
  getFirefoxProfilesIniRoots,
  parseProfilesIni,
  searchFirefoxBookmarkFolders,
  selectDefaultProfile,
} from "@/services/firefox-profiles";

describe("parseProfilesIni", () => {
  it("parses relative profile paths against the profiles directory", () => {
    const content = `[Install4F96D1932A9F858E]
Default=Profiles/abc123.default-release
Locked=1

[Profile0]
Name=default-release
IsRelative=1
Path=Profiles/abc123.default-release
Default=1
`;

    const parsed = parseProfilesIni(content, "/home/user/.mozilla/firefox");

    expect(parsed.profiles).toEqual([
      {
        name: "default-release",
        path: "/home/user/.mozilla/firefox/Profiles/abc123.default-release",
        isDefault: true,
      },
    ]);
  });

  it("parses absolute profile paths when IsRelative=0", () => {
    const content = `[Profile0]
Name=portable
IsRelative=0
Path=/opt/firefox/profile
Default=1
`;

    const parsed = parseProfilesIni(content, "/ignored");

    expect(parsed.profiles[0]?.path).toBe("/opt/firefox/profile");
  });

  it("returns empty profiles for malformed content", () => {
    const parsed = parseProfilesIni("not an ini file", "/home/user/.mozilla/firefox");
    expect(parsed.profiles).toEqual([]);
  });

  it("prefers Install-section Default over Profile Default=1", () => {
    const content = `[InstallABC]
Default=active.default-esr
Locked=1

[Profile1]
Name=legacy
IsRelative=1
Path=legacy.default
Default=1

[Profile0]
Name=active-esr
IsRelative=1
Path=active.default-esr
`;

    const parsed = parseProfilesIni(content, "/home/user/.mozilla/firefox");
    const selected = selectDefaultProfile(parsed.profiles);

    expect(selected?.path).toBe("/home/user/.mozilla/firefox/active.default-esr");
  });
});

describe("selectDefaultProfile", () => {
  it("prefers a profile marked default", () => {
    const selected = selectDefaultProfile([
      { name: "other", path: "/a", isDefault: false },
      { name: "main", path: "/b", isDefault: true },
    ]);

    expect(selected?.path).toBe("/b");
  });

  it("falls back to the first profile when none are default", () => {
    const selected = selectDefaultProfile([
      { name: "first", path: "/a", isDefault: false },
      { name: "second", path: "/b", isDefault: false },
    ]);

    expect(selected?.path).toBe("/a");
  });
});

describe("getFirefoxProfilesIniRoots", () => {
  it("returns Linux roots including Snap and Flatpak", () => {
    const roots = getFirefoxProfilesIniRoots("/home/user", "linux");
    expect(roots).toContain("/home/user/.mozilla/firefox");
    expect(roots).toContain("/home/user/.config/mozilla/firefox");
    expect(roots).toContain("/home/user/snap/firefox/common/.mozilla/firefox");
    expect(roots).toContain("/home/user/.var/app/org.mozilla.firefox/.mozilla/firefox");
  });

  it("prefers the legacy Mozilla home over the XDG config root", () => {
    // Arrange
    const homeDirectory = "/home/user";

    // Act
    const roots = getFirefoxProfilesIniRoots(homeDirectory, "linux");

    // Assert
    expect(roots.indexOf(`${homeDirectory}/.mozilla/firefox`)).toBeLessThan(
      roots.indexOf(`${homeDirectory}/.config/mozilla/firefox`),
    );
  });

  it("returns macOS root", () => {
    const roots = getFirefoxProfilesIniRoots("/Users/me", "darwin");
    expect(roots).toContain("/Users/me/Library/Application Support/Firefox");
  });

  it("returns the Windows Mozilla Firefox root when APPDATA is set", () => {
    // Arrange
    const previousAppData = process.env["APPDATA"];
    process.env["APPDATA"] = String.raw`C:\Users\me\AppData\Roaming`;

    try {
      // Act
      const roots = getFirefoxProfilesIniRoots(String.raw`C:\Users\me`, "win32");

      // Assert
      expect(roots).toContain(String.raw`C:\Users\me\AppData\Roaming\Mozilla\Firefox`);
    } finally {
      if (previousAppData === undefined) {
        delete process.env["APPDATA"];
      } else {
        process.env["APPDATA"] = previousAppData;
      }
    }
  });

  it("returns no Windows roots when APPDATA is unset", () => {
    // Arrange
    const previousAppData = process.env["APPDATA"];
    delete process.env["APPDATA"];

    try {
      // Act
      const roots = getFirefoxProfilesIniRoots(String.raw`C:\Users\me`, "win32");

      // Assert
      expect(roots).toEqual([]);
    } finally {
      if (previousAppData === undefined) {
        delete process.env["APPDATA"];
      } else {
        process.env["APPDATA"] = previousAppData;
      }
    }
  });
});

describe("collapseDescendantFolderMatches", () => {
  it("keeps a parent and drops nested children", () => {
    const collapsed = collapseDescendantFolderMatches([
      { guid: "parent", title: "Recent", path: "toolbar / Recent" },
      { guid: "child", title: "Uni", path: "toolbar / Recent / Uni" },
      { guid: "deep", title: "A1", path: "toolbar / Recent / Uni / A1" },
      { guid: "sibling", title: "Other", path: "toolbar / Other" },
    ]);

    expect(collapsed.map((folder) => folder.guid)).toEqual(["parent", "sibling"]);
  });
});

describe("searchFirefoxBookmarkFolders", () => {
  const folders = [
    { guid: "reading", title: "Reading", path: "toolbar / Reading" },
    { guid: "recent", title: "Recent", path: "toolbar / Recent" },
    { guid: "uni", title: "Uni", path: "toolbar / Recent / Uni" },
    { guid: "comp", title: "COMP3310", path: "toolbar / Recent / Uni / COMP3310" },
    { guid: "menu-uni", title: "Uni", path: "menu / Uni" },
    { guid: "a2", title: "A2", path: "menu / Uni / MATH2301 / A2" },
  ];

  it("returns no matches for an empty query", () => {
    expect(searchFirefoxBookmarkFolders(folders, "   ")).toEqual({
      matches: [],
      totalMatches: 0,
      truncated: false,
      rawMatchCount: 0,
    });
  });

  it("surfaces Recent and hides nested matches under it", () => {
    const result = searchFirefoxBookmarkFolders(folders, "Recent");

    expect(result.rawMatchCount).toBeGreaterThan(1);
    expect(result.matches.map((folder) => folder.guid)).toEqual(["recent"]);
    expect(result.totalMatches).toBe(1);
  });

  it("prefers the parent Uni folder over nested descendants", () => {
    const result = searchFirefoxBookmarkFolders(folders, "uni");

    expect(result.matches.map((folder) => folder.guid)).toEqual(
      expect.arrayContaining(["menu-uni", "uni"]),
    );
    expect(result.matches).toHaveLength(2);
    expect(result.matches.some((folder) => folder.guid === "a2")).toBe(false);
    expect(result.matches.some((folder) => folder.guid === "comp")).toBe(false);
  });

  it("still finds a deep folder when the query is specific", () => {
    const result = searchFirefoxBookmarkFolders(folders, "COMP3310");
    expect(result.matches.map((folder) => folder.guid)).toEqual(["comp"]);
  });
});
