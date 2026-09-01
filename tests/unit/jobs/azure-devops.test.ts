import { beforeEach, describe, expect, it, vi } from "vitest";
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
import { fetchAssignedWorkItems, AzureDevOpsAuthorizationError } from "@/services/azure-devops";

const baseConfig = {
  googleClientId: "",
  googleClientSecret: "",
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

const createReconcileResult = (): AtomicReconcileResult => ({
  actions: [
    {
      operation: "create",
      item: {
        id: "42",
        title: "Fix bug",
        link: "https://dev.azure.com/my-org/My%20Test%20Project/_workitems/edit/42",
        source: "azure-devops",
        heading: "## Inbox",
        completed: false,
      },
    },
  ],
  existingItems: [],
});

const makeSettings = (overrides: Partial<Record<string, unknown>> = {}) => ({
  syncDocument: "GTD.md",
  syncHeading: "## Inbox",
  azureDevOpsOrganization: "my-org",
  azureDevOpsProjectName: "My Test Project",
  azureDevOpsPersonalAccessToken: "pat-token",
  ...overrides,
});

describe("createAzureDevOpsJob (PAT mode)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns early when PAT settings are incomplete", async () => {
    // Arrange
    const loadSettings = vi
      .fn()
      .mockResolvedValue(makeSettings({ azureDevOpsPersonalAccessToken: "" }));
    const job = createAzureDevOpsJob(
      loadSettings,
      vi.fn(),
      baseConfig,
      makeVault(makeFile()),
      vi.fn(),
      mockApp,
    );

    // Act
    await job.task();

    // Assert
    expect(vi.mocked(fetchAssignedWorkItems)).not.toHaveBeenCalled();
  });

  it("syncs assigned work items using PAT auth", async () => {
    // Arrange
    const loadSettings = vi.fn().mockResolvedValue(makeSettings());
    const file = makeFile();
    vi.mocked(fetchAssignedWorkItems).mockResolvedValue([
      {
        id: 42,
        title: "Fix bug",
        url: "https://dev.azure.com/my-org/My%20Test%20Project/_workitems/edit/42",
      },
    ]);
    vi.mocked(reconcileSyncSourceAtomically).mockResolvedValue(createReconcileResult());
    const job = createAzureDevOpsJob(
      loadSettings,
      vi.fn(),
      baseConfig,
      makeVault(file),
      vi.fn(),
      mockApp,
    );

    // Act
    await job.task();

    // Assert
    expect(vi.mocked(fetchAssignedWorkItems)).toHaveBeenCalledWith(
      { kind: "pat", personalAccessToken: "pat-token" },
      "my-org",
      "My Test Project",
    );
    expect(vi.mocked(reconcileSyncSourceAtomically)).toHaveBeenCalledWith(
      file,
      [
        expect.objectContaining({
          id: "42",
          source: "azure-devops",
          title: "Fix bug",
        }),
      ],
      "azure-devops",
      "## Inbox",
      expect.any(Function),
    );
  });

  it("notifies and returns on PAT authorization failure", async () => {
    // Arrange
    const loadSettings = vi.fn().mockResolvedValue(makeSettings());
    const notify = vi.fn();
    vi.mocked(fetchAssignedWorkItems).mockRejectedValue(
      new AzureDevOpsAuthorizationError(401, "Unauthorized"),
    );
    const job = createAzureDevOpsJob(
      loadSettings,
      vi.fn(),
      baseConfig,
      makeVault(makeFile()),
      notify,
      mockApp,
    );

    // Act
    await job.task();

    // Assert
    expect(notify).toHaveBeenCalledWith(
      "Azure DevOps PAT authorization failed. Verify PAT scopes and organisation/project values.",
    );
  });
});
