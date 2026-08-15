import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App, TFile, WorkspaceLeaf } from "obsidian";
import { openSyncDocument } from "@/plugin/open-sync-document";

const makeFile = (path: string): TFile =>
  ({
    path,
    name: path,
  }) as unknown as TFile;

const makeLeaf = (file?: TFile, viewType = "markdown"): WorkspaceLeaf =>
  ({
    view: {
      file,
      getViewType: () => viewType,
    },
    openFile: vi.fn(async () => undefined),
  }) as unknown as WorkspaceLeaf;

describe("openSyncDocument", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("notifies and does not open when the file is missing", async () => {
    // eslint-disable-next-line unicorn/no-null -- Obsidian vault.getFileByPath returns null when missing
    const getFileByPath = vi.fn().mockReturnValue(null);
    const openFile = vi.fn();
    const create = vi.fn();
    const notify = vi.fn();
    const app = {
      workspace: {
        iterateAllLeaves: vi.fn(),
        revealLeaf: vi.fn(),
        getLeaf: vi.fn(() => ({ openFile })),
      },
      vault: {
        getFileByPath,
        create,
      },
    } as unknown as App;

    await openSyncDocument(app, "Missing.md", notify);

    expect(notify).toHaveBeenCalledWith(
      'Sync document "Missing.md" not found. Please update settings or create the file.',
    );
    expect(getFileByPath).toHaveBeenCalledWith("Missing.md");
    expect(openFile).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("notifies and skips vault lookup when the path is blank", async () => {
    const getFileByPath = vi.fn();
    const openFile = vi.fn();
    const create = vi.fn();
    const notify = vi.fn();
    const app = {
      workspace: {
        iterateAllLeaves: vi.fn(),
        revealLeaf: vi.fn(),
        getLeaf: vi.fn(() => ({ openFile })),
      },
      vault: {
        getFileByPath,
        create,
      },
    } as unknown as App;

    await openSyncDocument(app, "   ", notify);

    expect(notify).toHaveBeenCalledWith(
      'Sync document "   " not found. Please update settings or create the file.',
    );
    expect(getFileByPath).not.toHaveBeenCalled();
    expect(openFile).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("reveals an inactive Kanban leaf instead of opening a new view", async () => {
    const file = makeFile("GTD.md");
    const kanbanLeaf = makeLeaf(file, "kanban");
    const revealLeaf = vi.fn(async () => undefined);
    const getLeaf = vi.fn();
    const notify = vi.fn();
    const app = {
      workspace: {
        iterateAllLeaves: (callback: (leaf: WorkspaceLeaf) => void) => {
          callback(kanbanLeaf);
        },
        revealLeaf,
        getLeaf,
      },
      vault: {
        getFileByPath: vi.fn().mockReturnValue(file),
      },
    } as unknown as App;

    await openSyncDocument(app, "GTD.md", notify);

    expect(revealLeaf).toHaveBeenCalledTimes(1);
    expect(revealLeaf).toHaveBeenCalledWith(kanbanLeaf);
    expect(getLeaf).not.toHaveBeenCalled();
    expect(kanbanLeaf.openFile).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("opens the file in the current leaf when it is not already open", async () => {
    const file = makeFile("GTD.md");
    const currentLeaf = makeLeaf(makeFile("Other.md"));
    const getLeaf = vi.fn((newLeaf?: boolean) => {
      expect(newLeaf).toBe(false);
      return currentLeaf;
    });
    const notify = vi.fn();
    const app = {
      workspace: {
        iterateAllLeaves: vi.fn(),
        revealLeaf: vi.fn(),
        getLeaf,
      },
      vault: {
        getFileByPath: vi.fn().mockReturnValue(file),
      },
    } as unknown as App;

    await openSyncDocument(app, "GTD.md", notify);

    expect(getLeaf).toHaveBeenCalledWith(false);
    expect(currentLeaf.openFile).toHaveBeenCalledWith(file);
    expect(notify).not.toHaveBeenCalled();
  });

  it("creates a leaf when the workspace has none", async () => {
    const file = makeFile("GTD.md");
    const createdLeaf = makeLeaf();
    const getLeaf = vi.fn((newLeaf?: boolean) => {
      if (newLeaf === true) {
        return createdLeaf;
      }
      // eslint-disable-next-line unicorn/no-null -- getLeaf(false) can be null when the workspace has no leaves
      return null;
    });
    const notify = vi.fn();
    const app = {
      workspace: {
        iterateAllLeaves: vi.fn(),
        revealLeaf: vi.fn(),
        getLeaf,
      },
      vault: {
        getFileByPath: vi.fn().mockReturnValue(file),
      },
    } as unknown as App;

    await openSyncDocument(app, "GTD.md", notify);

    expect(getLeaf).toHaveBeenCalledWith(false);
    expect(getLeaf).toHaveBeenCalledWith(true);
    expect(createdLeaf.openFile).toHaveBeenCalledWith(file);
    expect(notify).not.toHaveBeenCalled();
  });

  it("reveals the first matching leaf when the file is open in several panes", async () => {
    const file = makeFile("GTD.md");
    const firstLeaf = makeLeaf(file, "markdown");
    const secondLeaf = makeLeaf(file, "kanban");
    const revealLeaf = vi.fn(async () => undefined);
    const getLeaf = vi.fn();
    const notify = vi.fn();
    const app = {
      workspace: {
        iterateAllLeaves: (callback: (leaf: WorkspaceLeaf) => void) => {
          callback(firstLeaf);
          callback(secondLeaf);
        },
        revealLeaf,
        getLeaf,
      },
      vault: {
        getFileByPath: vi.fn().mockReturnValue(file),
      },
    } as unknown as App;

    await openSyncDocument(app, "GTD.md", notify);

    expect(revealLeaf).toHaveBeenCalledTimes(1);
    expect(revealLeaf).toHaveBeenCalledWith(firstLeaf);
    expect(getLeaf).not.toHaveBeenCalled();
  });

  it("reveals an existing leaf when another note is active", async () => {
    const syncFile = makeFile("GTD.md");
    const otherLeaf = makeLeaf(makeFile("Daily.md"));
    const syncLeaf = makeLeaf(syncFile);
    const revealLeaf = vi.fn(async () => undefined);
    const getLeaf = vi.fn();
    const notify = vi.fn();
    const app = {
      workspace: {
        iterateAllLeaves: (callback: (leaf: WorkspaceLeaf) => void) => {
          callback(otherLeaf);
          callback(syncLeaf);
        },
        revealLeaf,
        getLeaf,
      },
      vault: {
        getFileByPath: vi.fn().mockReturnValue(syncFile),
      },
    } as unknown as App;

    await openSyncDocument(app, "GTD.md", notify);

    expect(revealLeaf).toHaveBeenCalledTimes(1);
    expect(revealLeaf).toHaveBeenCalledWith(syncLeaf);
    expect(getLeaf).not.toHaveBeenCalled();
    expect(otherLeaf.openFile).not.toHaveBeenCalled();
    expect(syncLeaf.openFile).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });
});
