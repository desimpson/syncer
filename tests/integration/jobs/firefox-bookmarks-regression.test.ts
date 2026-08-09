import { describe, expect, it, vi } from "vitest";
import { createFirefoxBookmarksJob } from "@/jobs/firefox-bookmarks";
import { parseMarkdownSyncItemsFromContent } from "@/sync/reader";
import { FIREFOX_BOOKMARKS_SOURCE } from "@/sync/types";
import type { TFile, Vault } from "obsidian";

vi.mock("obsidian", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports -- Vitest importOriginal typing
  const actual = await importOriginal<typeof import("obsidian")>();
  return {
    ...actual,
    Platform: { isDesktopApp: true },
  };
});

vi.mock("@/services/firefox-bookmarks", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports -- Vitest importOriginal typing
  const actual = await importOriginal<typeof import("@/services/firefox-bookmarks")>();
  return {
    ...actual,
    fetchFirefoxBookmarks: vi.fn(),
  };
});

import { fetchFirefoxBookmarks } from "@/services/firefox-bookmarks";

const baseConfig = {
  googleClientId: "",
  microsoftClientId: "",
  pluginDirectory: "/tmp/syncer-plugin",
} as const;

const markdownFirefoxItemLine = (
  id: string,
  title: string,
  link: string,
  heading: string,
): string =>
  `- [ ] [${title}](${link}) <!-- ${JSON.stringify({
    id,
    source: FIREFOX_BOOKMARKS_SOURCE,
    title,
    link,
    heading,
  })} -->`;

describe("Firefox bookmarks stale read regression", () => {
  it("should write all incoming bookmarks when pre-read state is stale", async () => {
    const heading = "## Inbox";
    const staleExisting = markdownFirefoxItemLine(
      "bm-4",
      "Martin Fowler",
      "https://martinfowler.com",
      heading,
    );

    let currentContent = `${heading}\n`;
    let readCount = 0;

    const file = { path: "GTD.md", name: "GTD.md" } as TFile;
    const vault = {
      getFileByPath: vi.fn().mockReturnValue(file),
      read: vi.fn(async () => {
        readCount += 1;
        if (readCount === 1) {
          return `${heading}\n${staleExisting}\n`;
        }
        return currentContent;
      }),
      process: vi.fn(async (_file: TFile, processor: (content: string) => string) => {
        currentContent = processor(currentContent);
        return currentContent;
      }),
    } as unknown as Vault;
    (file as TFile & { vault: Vault }).vault = vault;

    vi.mocked(fetchFirefoxBookmarks).mockResolvedValue({
      profileDirectory: "/profile",
      walSidecarsPresent: true,
      walMerged: true,
      bookmarks: [
        { guid: "bm-1", title: "One", url: "https://example.com/1" },
        { guid: "bm-2", title: "Two", url: "https://example.com/2" },
        { guid: "bm-3", title: "Three", url: "https://example.com/3" },
        { guid: "bm-4", title: "Martin Fowler", url: "https://martinfowler.com" },
      ],
    });

    const loadSettings = vi.fn().mockResolvedValue({
      syncDocument: "GTD.md",
      syncHeading: heading,
      firefoxBookmarks: {
        profilePath: "",
        resolvedProfilePath: "/profile",
        availableFolders: [{ guid: "folder-1", title: "Inbox", path: "Toolbar / Inbox" }],
        selectedFolderGuids: ["folder-1"],
      },
    });

    const job = createFirefoxBookmarksJob(
      loadSettings,
      vi.fn(),
      baseConfig,
      vault,
      vi.fn(),
      {} as never,
    );
    await job.task();

    const synced = parseMarkdownSyncItemsFromContent(currentContent, FIREFOX_BOOKMARKS_SOURCE);
    expect(synced.map((item) => item.id)).toEqual(["bm-1", "bm-2", "bm-3", "bm-4"]);
  });
});
