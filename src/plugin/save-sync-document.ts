import type { App, TFile, WorkspaceLeaf } from "obsidian";

type SaveableSyncDocumentView = {
  file: TFile | null;
  getViewType: () => string;
  getViewData: () => string;
  save: (clear?: boolean) => Promise<void>;
};

const isSaveableSyncDocumentView = (view: unknown): view is SaveableSyncDocumentView => {
  // Duck-type: MarkdownView, Kanban, and other TextFileView-like boards expose this surface.
  // Avoid `instanceof TextFileView` — it fails in tests and can miss plugin views.
  if (view === null || typeof view !== "object") {
    return false;
  }
  const candidate = view as {
    file?: { path?: unknown } | null;
    getViewType?: unknown;
    getViewData?: unknown;
    save?: unknown;
  };
  return (
    typeof candidate.getViewType === "function" &&
    typeof candidate.getViewData === "function" &&
    typeof candidate.save === "function" &&
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

/**
 * Persists unsaved editor/board content when the sync document is open
 * (MarkdownView, Kanban TextFileView, or any saveable file view).
 */
export const saveSyncDocumentIfDirty = async (
  app: App,
  syncDocumentPath: string,
): Promise<void> => {
  const leaves = collectOpenLeaves(app);

  for (const leaf of leaves) {
    const { view } = leaf;
    if (!isSaveableSyncDocumentView(view)) {
      continue;
    }
    const { file } = view;
    if (file?.path !== syncDocumentPath) {
      continue;
    }

    const editorContent = view.getViewData();
    const diskContent = await app.vault.cachedRead(file);
    if (editorContent === diskContent) {
      continue;
    }

    await view.save();
  }
};
