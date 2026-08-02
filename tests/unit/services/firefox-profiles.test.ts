import { describe, expect, it } from "vitest";
import {
  getFirefoxProfilesIniRoots,
  parseProfilesIni,
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
    expect(roots).toContain("/home/user/snap/firefox/common/.mozilla/firefox");
  });

  it("returns macOS root", () => {
    const roots = getFirefoxProfilesIniRoots("/Users/me", "darwin");
    expect(roots).toContain("/Users/me/Library/Application Support/Firefox");
  });
});
