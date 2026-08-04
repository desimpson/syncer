import { describe, expect, it, vi } from "vitest";
import type { TFile, Vault } from "obsidian";
import type { SyncItem } from "@/sync/types";
import { parseMarkdownSyncItemsFromContent } from "@/sync/reader";
import { reconcileSyncSourceAtomically } from "@/sync/writer";

const makeSyncItem = (id: string): SyncItem => ({
  id,
  source: "firefox-bookmarks",
  title: `Bookmark ${id}`,
  link: `https://example.com/${id}`,
  heading: "## Inbox",
  completed: false,
});

describe("reconcileSyncSourceAtomically", () => {
  it("plans from vault.process snapshot instead of stale pre-read content", async () => {
    const heading = "## Inbox";
    let currentContent = `${heading}\n`;
    const staleDiskSnapshot = `${heading}\n- [ ] [Old](https://example.com/stale) <!-- {"id":"stale","source":"firefox-bookmarks","title":"Old","link":"https://example.com/stale","heading":"## Inbox"} -->\n`;
    const read = vi.fn(async () => staleDiskSnapshot);
    const process = vi.fn(async (_file: TFile, processor: (content: string) => string) => {
      currentContent = processor(currentContent);
      return currentContent;
    });
    const file = {
      path: "GTD.md",
      vault: { read, process },
    } as unknown as TFile;

    const incoming = [makeSyncItem("a"), makeSyncItem("b"), makeSyncItem("c"), makeSyncItem("d")];
    const result = await reconcileSyncSourceAtomically(
      file,
      incoming,
      "firefox-bookmarks",
      heading,
    );

    const writtenItems = parseMarkdownSyncItemsFromContent(currentContent, "firefox-bookmarks");
    expect(read).not.toHaveBeenCalled();
    expect(result.actions).toHaveLength(4);
    expect(writtenItems.map((item) => item.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("does not partially mutate content when reconcile computation throws", async () => {
    const initialContent = "## Inbox\n- [ ] Existing\n";
    let currentContent = initialContent;
    const process = vi.fn(async (_file: TFile, processor: (content: string) => string) => {
      currentContent = processor(currentContent);
      return currentContent;
    });
    const file = {
      path: "GTD.md",
      vault: { process },
    } as unknown as TFile;

    await expect(
      reconcileSyncSourceAtomically(
        file,
        [makeSyncItem("a")],
        "firefox-bookmarks",
        "## Inbox",
        () => {
          throw new Error("boom");
        },
      ),
    ).rejects.toThrow("boom");

    expect(currentContent).toBe(initialContent);
  });

  it("bubbles vault.process errors", async () => {
    const file = {
      path: "GTD.md",
      vault: {
        process: vi.fn(async () => {
          throw new Error("disk write failed");
        }),
      } as unknown as Vault,
    } as unknown as TFile;

    await expect(
      reconcileSyncSourceAtomically(file, [makeSyncItem("a")], "firefox-bookmarks", "## Inbox"),
    ).rejects.toThrow("disk write failed");
  });
});
