import { describe, it, expect, vi, beforeEach } from "vitest";
import type { App, TFile, Vault } from "obsidian";
import { createAzureDevOpsJob } from "@/jobs/azure-devops";
import type { AzureDevOpsApiAuth, AzureDevOpsWorkItem } from "@/services/azure-devops";
import type { AtomicReconcileResult } from "@/sync/writer";

vi.mock("@/sync/writer", () => {
  const reconcileSyncSourceAtomically = vi.fn() as unknown as (
    file: TFile,
    incomingItems: readonly unknown[],
    syncSource: string,
    heading: string,
    actionPredicate?: (action: unknown) => boolean,
  ) => Promise<AtomicReconcileResult>;
  return { reconcileSyncSourceAtomically };
});

vi.mock("@/services/azure-devops", async () => {
  const actual =
    // eslint-disable-next-line @typescript-eslint/consistent-type-imports -- Vitest generic needs module object type
    await vi.importActual<typeof import("@/services/azure-devops")>("@/services/azure-devops");
  const fetchAssignedWorkItems = vi.fn() as unknown as (
    auth: AzureDevOpsApiAuth,
    organization: string,
    projectName: string,
  ) => Promise<readonly AzureDevOpsWorkItem[]>;
  return { ...actual, fetchAssignedWorkItems };
});

import { reconcileSyncSourceAtomically } from "@/sync/writer";
import { fetchAssignedWorkItems } from "@/services/azure-devops";

const baseConfig = {
  googleClientId: "id",
  microsoftClientId: "",
  todoistClientId: "",
  pluginDirectory: "/tmp/syncer-plugin",
} as const;

const makeVault = (file: TFile | null) =>
  ({ getFileByPath: vi.fn().mockReturnValue(file) }) as unknown as Vault;

const makeFile = (path = "GTD.md"): TFile =>
  ({
    path,
    name: path,
  }) as unknown as TFile;

const mockApp = {} as unknown as App;
const emptyReconcileResult = (): AtomicReconcileResult => ({
  actions: [],
  existingItems: [],
});

describe("createAzureDevOpsJob integration", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("shows a notice and returns early when sync document is missing", async () => {
    // Arrange
    const loadSettings = vi.fn().mockResolvedValue({
      azureDevOpsOrganization: "my-org",
      azureDevOpsProjectName: "My Test Project",
      azureDevOpsPersonalAccessToken: "pat-token",
      syncDocument: "GTD.md",
      syncHeading: "## Inbox",
    });
    const saveSettings = vi.fn();
    // eslint-disable-next-line unicorn/no-null -- Obsidian vault.getFileByPath returns null when missing
    const vault = makeVault(null);
    const notify = vi.fn();
    vi.useFakeTimers();
    const job = createAzureDevOpsJob(
      loadSettings,
      saveSettings,
      baseConfig,
      vault,
      notify,
      mockApp,
    );

    // Act
    const jobPromise = job.task();
    await vi.advanceTimersByTimeAsync(500);
    await jobPromise;
    vi.useRealTimers();

    // Assert
    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining('Sync document "GTD.md" not found'),
    );
    expect(vi.mocked(fetchAssignedWorkItems)).not.toHaveBeenCalled();
  });

  it("syncs assigned work items in PAT mode", async () => {
    // Arrange
    const loadSettings = vi.fn().mockResolvedValue({
      azureDevOpsOrganization: "my-org",
      azureDevOpsProjectName: "Contoso",
      azureDevOpsPersonalAccessToken: "pat-token",
      syncDocument: "GTD.md",
      syncHeading: "## Inbox",
    });
    const file = makeFile();
    const vault = makeVault(file);
    vi.mocked(fetchAssignedWorkItems).mockResolvedValue([
      {
        id: 99,
        title: "Ship feature",
        url: "https://dev.azure.com/my-org/Contoso/_workitems/edit/99",
      },
    ]);
    vi.mocked(reconcileSyncSourceAtomically).mockResolvedValue(emptyReconcileResult());
    const job = createAzureDevOpsJob(loadSettings, vi.fn(), baseConfig, vault, vi.fn(), mockApp);

    // Act
    await job.task();

    // Assert
    expect(vi.mocked(fetchAssignedWorkItems)).toHaveBeenCalledWith(
      { kind: "pat", personalAccessToken: "pat-token" },
      "my-org",
      "Contoso",
    );
    expect(vi.mocked(reconcileSyncSourceAtomically)).toHaveBeenCalled();
  });
});
