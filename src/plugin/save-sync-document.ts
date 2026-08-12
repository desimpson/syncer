import type { App, TFile, WorkspaceLeaf } from "obsidian";
import {
  prepareSyncDocumentDebugLog,
  prepareSyncDocumentDebugWarn,
} from "@/sync/prepare-sync-document-debug";

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
  tickId?: string,
): Promise<void> => {
  const leaves = collectOpenLeaves(app);
  const openLeafSummary = leaves.map((leaf) => {
    const { view } = leaf;
    const saveable = isSaveableSyncDocumentView(view);
    return {
      viewType: leaf.view.getViewType(),
      path: saveable ? (view.file?.path ?? undefined) : undefined,
      saveable,
    };
  });

  prepareSyncDocumentDebugLog("saveIfDirty: start", {
    tickId,
    path: syncDocumentPath,
    openLeafCount: leaves.length,
    openLeaves: openLeafSummary,
  });

  let matchingViews = 0;
  let savedViews = 0;
  let skippedCleanViews = 0;

  for (const leaf of leaves) {
    const { view } = leaf;
    if (!isSaveableSyncDocumentView(view)) {
      continue;
    }
    const { file } = view;
    if (file?.path !== syncDocumentPath) {
      continue;
    }

    matchingViews += 1;
    const viewType = view.getViewType();
    const editorContent = view.getViewData();
    const diskContent = await app.vault.cachedRead(file);
    const dirty = editorContent !== diskContent;

    prepareSyncDocumentDebugLog("saveIfDirty: compared open view", {
      tickId,
      path: syncDocumentPath,
      viewType,
      dirty,
      editorLen: editorContent.length,
      diskLen: diskContent.length,
      lenDelta: editorContent.length - diskContent.length,
    });

    if (!dirty) {
      skippedCleanViews += 1;
      prepareSyncDocumentDebugLog("saveIfDirty: skipped (already saved)", {
        tickId,
        path: syncDocumentPath,
        viewType,
      });
      continue;
    }

    prepareSyncDocumentDebugWarn("saveIfDirty: saving open view", {
      tickId,
      path: syncDocumentPath,
      viewType,
      editorLen: editorContent.length,
      diskLen: diskContent.length,
    });
    const saveStartedAt = Date.now();
    await view.save();
    savedViews += 1;

    const diskAfter = await app.vault.cachedRead(file);
    const editorAfter = view.getViewData();
    prepareSyncDocumentDebugLog("saveIfDirty: save complete", {
      tickId,
      path: syncDocumentPath,
      viewType,
      elapsedMs: Date.now() - saveStartedAt,
      diskLenAfter: diskAfter.length,
      editorLenAfter: editorAfter.length,
      stillDirty: editorAfter !== diskAfter,
      diskMatchedEditor: diskAfter === editorContent,
    });
  }

  if (matchingViews === 0) {
    prepareSyncDocumentDebugWarn("saveIfDirty: no open saveable view for sync document", {
      tickId,
      path: syncDocumentPath,
      openLeaves: openLeafSummary,
    });
  }

  prepareSyncDocumentDebugLog("saveIfDirty: done", {
    tickId,
    path: syncDocumentPath,
    matchingViews,
    savedViews,
    skippedCleanViews,
  });
};
