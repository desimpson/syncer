import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App, TFile, WorkspaceLeaf } from "obsidian";
import { saveSyncDocumentIfDirty } from "@/plugin/save-sync-document";

const makeFile = (path: string): TFile =>
  ({
    path,
    name: path,
  }) as unknown as TFile;

describe("saveSyncDocumentIfDirty", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("saves a dirty Kanban-style TextFileView that is not a markdown leaf", async () => {
    const file = makeFile("GTD.md");
    let diskContent = "## Inbox\n- [ ] old\n";
    const boardContent = "## Inbox\n";
    const save = vi.fn(async () => {
      diskContent = boardContent;
    });
    const kanbanView = {
      file,
      getViewType: () => "kanban",
      getViewData: () => boardContent,
      save,
    };
    const leaf = { view: kanbanView } as unknown as WorkspaceLeaf;

    const app = {
      workspace: {
        iterateAllLeaves: (callback: (leaf: WorkspaceLeaf) => void) => {
          callback(leaf);
        },
        getLeavesOfType: vi.fn().mockReturnValue([]),
      },
      vault: {
        cachedRead: vi.fn(async () => diskContent),
      },
    } as unknown as App;

    await saveSyncDocumentIfDirty(app, "GTD.md", "tick-test");

    expect(save).toHaveBeenCalledTimes(1);
    expect(diskContent).toBe(boardContent);
  });

  it("does not save when the open Kanban view already matches disk", async () => {
    const file = makeFile("GTD.md");
    const content = "## Inbox\n";
    const save = vi.fn(async () => undefined);
    const kanbanView = {
      file,
      getViewType: () => "kanban",
      getViewData: () => content,
      save,
    };
    const leaf = { view: kanbanView } as unknown as WorkspaceLeaf;

    const app = {
      workspace: {
        iterateAllLeaves: (callback: (leaf: WorkspaceLeaf) => void) => {
          callback(leaf);
        },
      },
      vault: {
        cachedRead: vi.fn(async () => content),
      },
    } as unknown as App;

    await saveSyncDocumentIfDirty(app, "GTD.md");

    expect(save).not.toHaveBeenCalled();
  });
});
