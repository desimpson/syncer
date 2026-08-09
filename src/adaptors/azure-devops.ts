import type { SyncAdaptor } from "./types";
import type { AzureDevOpsWorkItem } from "@/services/azure-devops";
import { AZURE_DEVOPS_SOURCE } from "@/sync/types";

const workItemTitle = (workItem: AzureDevOpsWorkItem): string => {
  const trimmed = workItem.title.trim();
  return trimmed.length > 0 ? trimmed : `Work item #${workItem.id}`;
};

/**
 * Maps an Azure DevOps work item to a `SyncItem` for Markdown sync.
 * Completion is local-only in #35 (always `completed: false`).
 */
export const mapAzureDevOpsWorkItemToSyncItem: SyncAdaptor<AzureDevOpsWorkItem> =
  (heading) => (workItem) => ({
    source: AZURE_DEVOPS_SOURCE,
    id: String(workItem.id),
    title: workItemTitle(workItem),
    link: workItem.url,
    heading,
    completed: false,
  });
