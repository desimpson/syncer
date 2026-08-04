import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TFile, Vault } from "obsidian";
import { createFirefoxBookmarksJob } from "@/jobs/firefox-bookmarks";
import type { SyncAction } from "@/sync/types";

vi.mock("obsidian", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports -- Vitest importOriginal typing
  const actual = await importOriginal<typeof import("obsidian")>();
  return {
    ...actual,
    Platform: { isDesktopApp: true },
  };
});

vi.mock("@/sync/reader", () => ({
  readMarkdownSyncItems: vi.fn(),
}));

vi.mock("@/sync/actions", () => ({
  generateSyncActions: vi.fn(),
  filterActions: vi.fn((actions: SyncAction[], predicate: (action: SyncAction) => boolean) =>
    actions.filter(predicate),
  ),
  shouldPreserveCompletedDeletes: vi.fn(
    (action: SyncAction) => action.operation !== "delete" || !action.item.completed,
  ),
}));

vi.mock("@/sync/writer", () => ({
  writeSyncActions: vi.fn(),
}));

vi.mock("@/services/firefox-bookmarks", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports -- Vitest importOriginal typing
  const actual = await importOriginal<typeof import("@/services/firefox-bookmarks")>();
  return {
    ...actual,
    fetchFirefoxBookmarks: vi.fn(),
  };
});

import { readMarkdownSyncItems } from "@/sync/reader";
import { generateSyncActions } from "@/sync/actions";
import { writeSyncActions } from "@/sync/writer";
import { fetchFirefoxBookmarks, FirefoxBookmarksError } from "@/services/firefox-bookmarks";
import { FIREFOX_NOTICE } from "@/services/firefox-messages";

const baseConfig = {
  googleClientId: "",
  microsoftClientId: "",
  pluginDirectory: "/tmp/syncer-plugin",
} as const;

const makeVault = (file: TFile | null) =>
  ({ getFileByPath: vi.fn().mockReturnValue(file) }) as unknown as Vault;

const makeFile = (path = "GTD.md"): TFile =>
  ({
    path,
    name: path,
  }) as unknown as TFile;

describe("createFirefoxBookmarksJob", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("no-ops when Firefox bookmarks integration is disabled", async () => {
    const loadSettings = vi.fn().mockResolvedValue({
      syncDocument: "GTD.md",
      syncHeading: "## Inbox",
    });
    const job = createFirefoxBookmarksJob(
      loadSettings,
      vi.fn(),
      baseConfig,
      makeVault(makeFile()),
      vi.fn(),
      {} as never,
    );

    await job.task();

    expect(fetchFirefoxBookmarks).not.toHaveBeenCalled();
  });

  it("syncs bookmarks from selected folders", async () => {
    const loadSettings = vi.fn().mockResolvedValue({
      firefoxBookmarks: {
        profilePath: "",
        resolvedProfilePath: "/profile",
        availableFolders: [{ guid: "folder-1", title: "Reading", path: "Toolbar / Reading" }],
        selectedFolderGuids: ["folder-1"],
      },
      syncDocument: "GTD.md",
      syncHeading: "## Inbox",
    });
    const notify = vi.fn();
    const file = makeFile();

    vi.mocked(fetchFirefoxBookmarks).mockResolvedValue({
      profileDirectory: "/profile",
      bookmarks: [{ guid: "bm-1", title: "Example", url: "https://example.com" }],
      walSidecarsPresent: true,
      walMerged: true,
    });
    vi.mocked(readMarkdownSyncItems).mockResolvedValue([]);
    vi.mocked(generateSyncActions).mockReturnValue([]);
    vi.mocked(writeSyncActions).mockResolvedValue();

    const job = createFirefoxBookmarksJob(
      loadSettings,
      vi.fn(),
      baseConfig,
      makeVault(file),
      notify,
      {} as never,
    );

    await job.task();

    expect(fetchFirefoxBookmarks).toHaveBeenCalledWith(
      "",
      ["folder-1"],
      baseConfig.pluginDirectory,
      expect.objectContaining({ correlationId: expect.any(String) }),
    );
    expect(notify).not.toHaveBeenCalledWith(FIREFOX_NOTICE.firefoxWalNotMerged);
    expect(writeSyncActions).toHaveBeenCalled();
  });

  it("warns when Firefox WAL could not be merged", async () => {
    const loadSettings = vi.fn().mockResolvedValue({
      firefoxBookmarks: {
        profilePath: "",
        resolvedProfilePath: "/profile",
        availableFolders: [{ guid: "folder-1", title: "Reading", path: "Toolbar / Reading" }],
        selectedFolderGuids: ["folder-1"],
      },
      syncDocument: "GTD.md",
      syncHeading: "## Inbox",
    });
    const notify = vi.fn();
    const file = makeFile();

    vi.mocked(fetchFirefoxBookmarks).mockResolvedValue({
      profileDirectory: "/profile",
      bookmarks: [{ guid: "bm-1", title: "Example", url: "https://example.com" }],
      walSidecarsPresent: true,
      walMerged: false,
    });
    vi.mocked(readMarkdownSyncItems).mockResolvedValue([]);
    vi.mocked(generateSyncActions).mockReturnValue([]);
    vi.mocked(writeSyncActions).mockResolvedValue();

    const job = createFirefoxBookmarksJob(
      loadSettings,
      vi.fn(),
      baseConfig,
      makeVault(file),
      notify,
      {} as never,
    );

    await job.task();

    expect(notify).toHaveBeenCalledWith(FIREFOX_NOTICE.firefoxWalNotMerged);
  });

  it("warns and no-ops when selected folders are stale", async () => {
    const loadSettings = vi.fn().mockResolvedValue({
      firefoxBookmarks: {
        profilePath: "",
        resolvedProfilePath: "/profile",
        availableFolders: [{ guid: "folder-1", title: "Reading", path: "Toolbar / Reading" }],
        selectedFolderGuids: ["missing-folder"],
      },
      syncDocument: "GTD.md",
      syncHeading: "## Inbox",
    });
    const notify = vi.fn();

    const job = createFirefoxBookmarksJob(
      loadSettings,
      vi.fn(),
      baseConfig,
      makeVault(makeFile()),
      notify,
      {} as never,
    );

    await job.task();

    expect(notify).toHaveBeenCalledWith(
      "Some selected bookmark folders were not found in the current profile.",
    );
    expect(notify).toHaveBeenCalledWith("No valid bookmark folders selected for Firefox sync.");
    expect(fetchFirefoxBookmarks).not.toHaveBeenCalled();
  });

  it("surfaces Firefox service errors as notices", async () => {
    const loadSettings = vi.fn().mockResolvedValue({
      firefoxBookmarks: {
        profilePath: "/missing",
        resolvedProfilePath: "",
        availableFolders: [{ guid: "folder-1", title: "Reading", path: "Toolbar / Reading" }],
        selectedFolderGuids: ["folder-1"],
      },
      syncDocument: "GTD.md",
      syncHeading: "## Inbox",
    });
    const notify = vi.fn();

    vi.mocked(fetchFirefoxBookmarks).mockRejectedValue(
      new FirefoxBookmarksError("Firefox profile path not found."),
    );

    const job = createFirefoxBookmarksJob(
      loadSettings,
      vi.fn(),
      baseConfig,
      makeVault(makeFile()),
      notify,
      {} as never,
    );

    await job.task();

    expect(notify).toHaveBeenCalledWith("Firefox profile path not found.");
    expect(writeSyncActions).not.toHaveBeenCalled();
  });
});
