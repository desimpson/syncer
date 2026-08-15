import type { App, TFile, WorkspaceLeaf } from "obsidian";
import { formatPrepareSyncDocumentFailureNotice } from "@/sync/prepare-sync-document";

type FileBearingView = {
  file: TFile | null;
};

const isFileBearingView = (view: unknown): view is FileBearingView => {
  // Duck-type: MarkdownView, Kanban, and other file views expose `.file`.
  // Avoid `instanceof MarkdownView` — it fails in tests and misses plugin views.
  if (view === null || typeof view !== "object") {
    return false;
  }
  const candidate = view as { file?: { path?: unknown } | null };
  return (
    candidate.file !== undefined &&
    (candidate.file === null || typeof candidate.file.path === "string")
  );
};

const collectOpenLeaves = (app: App): WorkspaceLeaf[] => {
  const leaves: WorkspaceLeaf[] = [];
  app.workspace.iterateAllLeaves((leaf) => {
    leaves.push(leaf);
  });
  return leaves;
};

const notifyMissing = (syncDocumentPath: string, notify: (message: string) => void): void => {
  notify(formatPrepareSyncDocumentFailureNotice(syncDocumentPath, "not found"));
};

/**
 * Opens the configured sync document, revealing an existing leaf when the
 * note is already open (including Kanban and other non-markdown file views).
 */
export const openSyncDocument = async (
  app: App,
  syncDocumentPath: string,
  notify: (message: string) => void,
): Promise<void> => {
  if (syncDocumentPath.trim() === "") {
    notifyMissing(syncDocumentPath, notify);
    return;
  }

  const file = app.vault.getFileByPath(syncDocumentPath);
  if (file === null) {
    notifyMissing(syncDocumentPath, notify);
    return;
  }

  const existing = collectOpenLeaves(app).find((leaf) => {
    const { view } = leaf;
    return isFileBearingView(view) && view.file?.path === syncDocumentPath;
  });
  if (existing !== undefined) {
    await app.workspace.revealLeaf(existing);
    return;
  }

  const currentLeaf: WorkspaceLeaf | null = app.workspace.getLeaf(false);
  const leaf = currentLeaf ?? app.workspace.getLeaf(true);
  await leaf.openFile(file);
};
