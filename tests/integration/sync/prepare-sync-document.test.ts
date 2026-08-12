import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TFile, Vault } from "obsidian";
import type { SyncItem } from "@/sync/types";
import { reconcileSyncSourceAtomically } from "@/sync/writer";
import { prepareSyncDocumentForRun, UnstableSyncDocumentError } from "@/sync/prepare-sync-document";

const heading = "## Inbox";

const makeSyncItem = (id: string): SyncItem => ({
  id,
  source: "microsoft-outlook",
  title: `Message ${id}`,
  link: `https://outlook.example.com/${id}`,
  heading,
  completed: false,
});

const itemLine = (id: string) =>
  `- [ ] [Message ${id}](https://outlook.example.com/${id}) <!-- {"id":"${id}","source":"microsoft-outlook","title":"Message ${id}","link":"https://outlook.example.com/${id}","heading":"${heading}"} -->`;

const makeVault = (
  initialDiskContent: string,
  onModify?: (content: string) => void,
): { vault: Vault; file: TFile; setDiskContent: (content: string) => void } => {
  let diskContent = initialDiskContent;
  let mtime = 1_700_000_000_000;
  const setDiskContent = (content: string) => {
    diskContent = content;
    mtime += 1;
    onModify?.(content);
  };
  const file = {
    path: "GTD.md",
    vault: {
      read: vi.fn(async () => diskContent),
      cachedRead: vi.fn(async () => diskContent),
      process: vi.fn(async (_target: TFile, processor: (content: string) => string) => {
        diskContent = processor(diskContent);
        return diskContent;
      }),
      adapter: {
        stat: vi.fn(async () => ({ mtime })),
      },
    },
  } as unknown as TFile;

  const vault = {
    getFileByPath: vi.fn(() => file),
    read: file.vault.read,
    cachedRead: file.vault.cachedRead,
    adapter: file.vault.adapter,
  } as unknown as Vault;

  return { vault, file, setDiskContent };
};

describe("prepareSyncDocumentForRun stale snapshot regression", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("without prepare, reconcile no-ops when disk still has a deleted item", async () => {
    const staleDisk = `${heading}\n${itemLine("msg-1")}\n`;
    const { file } = makeVault(staleDisk);
    const incoming = [makeSyncItem("msg-1")];

    const result = await reconcileSyncSourceAtomically(
      file,
      incoming,
      "microsoft-outlook",
      heading,
    );

    expect(result.actions).toHaveLength(0);
  });

  it("with prepare, flushed editor deletion allows reconcile to create the remote item again", async () => {
    const staleDisk = `${heading}\n${itemLine("msg-1")}\n`;
    const flushedDisk = `${heading}\n`;
    const { vault, file, setDiskContent } = makeVault(staleDisk);
    const incoming = [makeSyncItem("msg-1")];

    await prepareSyncDocumentForRun({
      vault,
      syncDocument: "GTD.md",
      syncHeading: heading,
      saveIfDirty: async () => {
        setDiskContent(flushedDisk);
      },
    });

    const result = await reconcileSyncSourceAtomically(
      file,
      incoming,
      "microsoft-outlook",
      heading,
    );

    expect(result.actions).toEqual([
      expect.objectContaining({
        operation: "create",
        item: expect.objectContaining({ id: "msg-1" }),
      }),
    ]);
  });

  it("throws UnstableSyncDocumentError when the sync document never stabilises", async () => {
    vi.useFakeTimers();
    let reads = 0;
    const changingContent = () => {
      reads += 1;
      return `${heading}\n- [ ] state-${reads}\n`;
    };
    const { vault } = makeVault(changingContent());
    const readSpy = vi.fn(async () => changingContent());
    (vault as unknown as { read: typeof readSpy }).read = readSpy;

    const preparePromise = prepareSyncDocumentForRun({
      vault,
      syncDocument: "GTD.md",
      syncHeading: heading,
    });
    const assertion = expect(preparePromise).rejects.toBeInstanceOf(UnstableSyncDocumentError);

    await vi.runAllTimersAsync();
    await assertion;
    vi.useRealTimers();
  });
});
