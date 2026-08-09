import { describe, it, expect, vi, beforeEach } from "vitest";
import type { App, TFile, Vault } from "obsidian";
import { createAzureDevOpsJob } from "@/jobs/azure-devops";
import type { AzureDevOpsWorkItem } from "@/services/azure-devops";
import type { SyncItem } from "@/sync/types";
import type { AtomicReconcileResult } from "@/sync/writer";

vi.mock("@/sync/reader", () => {
  const readMarkdownSyncItems = vi.fn() as unknown as (
    file: TFile,
    source: string,
  ) => Promise<SyncItem[]>;
  return { readMarkdownSyncItems };
});

vi.mock("@/sync/writer", () => {
  const reconcileSyncSourceAtomically = vi.fn() as unknown as (
    file: TFile,
    incomingItems: readonly SyncItem[],
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
    accessToken: string,
    organization: string,
    projectName: string,
  ) => Promise<readonly AzureDevOpsWorkItem[]>;
  return { ...actual, fetchAssignedWorkItems };
});

vi.mock("@/auth", async () => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports -- Vitest generic needs module object type
  const actual = await vi.importActual<typeof import("@/auth")>("@/auth");
  const refreshAccessToken = vi.fn() as unknown as (
    clientId: string,
    token: { refreshToken: string; tenantSegment: string },
  ) => Promise<{ accessToken: string; expiryDate: number }>;
  return {
    ...actual,
    AzureDevOpsAuth: { refreshAccessToken },
  };
});

const { modalOpen } = vi.hoisted(() => ({
  modalOpen: vi.fn(),
}));

vi.mock("@/plugin/modals/authorization-expired-modal", () => ({
  AuthorizationExpiredModal: class {
    public open = modalOpen;
  },
}));

import { reconcileSyncSourceAtomically } from "@/sync/writer";
import { fetchAssignedWorkItems } from "@/services/azure-devops";
import { AzureDevOpsAuth, InvalidGrantError } from "@/auth";

const baseConfig = {
  googleClientId: "id",
  outlookClientId: "",
  azureDevOpsClientId: "azure-devops-client-id",
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

const makeAzureDevOpsSettings = () => ({
  credentials: {
    accessToken: "ado-token",
    refreshToken: "refresh-token",
    expiryDate: Date.now() + 60_000,
    scope: "scope",
    tenantSegment: "organizations",
  },
  userInfo: { email: "user@example.com" },
  organization: "my-org",
  availableProjects: [{ id: "proj-1", name: "Contoso" }],
  selectedProjectId: "proj-1",
});

describe("createAzureDevOpsJob integration", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    modalOpen.mockReset();
  });

  it("shows a notice and returns early when sync document is missing", async () => {
    // Arrange
    const loadSettings = vi.fn().mockResolvedValue({
      azureDevOps: makeAzureDevOpsSettings(),
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

  it("persists refreshed token then syncs assigned work items", async () => {
    // Arrange
    const settings = {
      azureDevOps: {
        ...makeAzureDevOpsSettings(),
        credentials: {
          ...makeAzureDevOpsSettings().credentials,
          expiryDate: Date.now() - 1000,
        },
      },
      syncDocument: "GTD.md",
      syncHeading: "## Inbox",
    };
    const loadSettings = vi
      .fn()
      .mockResolvedValueOnce(settings)
      .mockResolvedValueOnce(settings)
      .mockResolvedValueOnce(settings);
    const saveSettings = vi.fn();
    const file = makeFile();
    const vault = makeVault(file);
    vi.mocked(AzureDevOpsAuth.refreshAccessToken).mockResolvedValue({
      accessToken: "fresh-token",
      expiryDate: Date.now() + 60_000,
    });
    vi.mocked(fetchAssignedWorkItems).mockResolvedValue([
      {
        id: 99,
        title: "Ship feature",
        url: "https://dev.azure.com/my-org/Contoso/_workitems/edit/99",
      },
    ]);
    vi.mocked(reconcileSyncSourceAtomically).mockResolvedValue(emptyReconcileResult());
    const job = createAzureDevOpsJob(
      loadSettings,
      saveSettings,
      baseConfig,
      vault,
      vi.fn(),
      mockApp,
    );

    // Act
    await job.task();

    // Assert
    expect(saveSettings).toHaveBeenCalled();
    expect(vi.mocked(fetchAssignedWorkItems)).toHaveBeenCalledWith(
      "fresh-token",
      "my-org",
      "Contoso",
    );
    expect(vi.mocked(reconcileSyncSourceAtomically)).toHaveBeenCalled();
  });

  it("clears credentials when refresh token is revoked", async () => {
    // Arrange
    const settings = {
      azureDevOps: {
        ...makeAzureDevOpsSettings(),
        credentials: {
          ...makeAzureDevOpsSettings().credentials,
          expiryDate: Date.now() - 1000,
        },
      },
      syncDocument: "GTD.md",
      syncHeading: "## Inbox",
    };
    const loadSettings = vi.fn().mockResolvedValue(settings);
    const saveSettings = vi.fn();
    const vault = makeVault(makeFile());
    vi.mocked(AzureDevOpsAuth.refreshAccessToken).mockRejectedValue(
      new InvalidGrantError("revoked"),
    );
    const job = createAzureDevOpsJob(
      loadSettings,
      saveSettings,
      baseConfig,
      vault,
      vi.fn(),
      mockApp,
    );

    // Act
    await job.task();

    // Assert
    expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({ azureDevOps: undefined }));
    expect(modalOpen).toHaveBeenCalled();
    expect(vi.mocked(fetchAssignedWorkItems)).not.toHaveBeenCalled();
  });
});
