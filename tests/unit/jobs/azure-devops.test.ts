import { beforeEach, describe, expect, it, vi } from "vitest";
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
import { fetchAssignedWorkItems, AzureDevOpsAuthorizationError } from "@/services/azure-devops";
import { AzureDevOpsAuth, InvalidGrantError } from "@/auth";

const baseConfig = {
  googleClientId: "",
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
  userInfo: { email: "user@example.com", displayName: "User Example" },
  organization: "my-org",
  availableProjects: [{ id: "proj-1", name: "Contoso" }],
  selectedProjectId: "proj-1",
});

describe("createAzureDevOpsJob", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    modalOpen.mockReset();
  });

  it("returns early when Azure DevOps is not configured", async () => {
    // Arrange
    const loadSettings = vi.fn().mockResolvedValue({
      azureDevOps: undefined,
      syncDocument: "GTD.md",
      syncHeading: "## Inbox",
    });
    const saveSettings = vi.fn();
    const vault = makeVault(makeFile());
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
    expect(vi.mocked(fetchAssignedWorkItems)).not.toHaveBeenCalled();
    expect(vi.mocked(reconcileSyncSourceAtomically)).not.toHaveBeenCalled();
  });

  it("returns early when no project is selected", async () => {
    // Arrange
    const loadSettings = vi.fn().mockResolvedValue({
      azureDevOps: {
        ...makeAzureDevOpsSettings(),
        selectedProjectId: "",
      },
      syncDocument: "GTD.md",
      syncHeading: "## Inbox",
    });
    const saveSettings = vi.fn();
    const vault = makeVault(makeFile());
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
    expect(vi.mocked(fetchAssignedWorkItems)).not.toHaveBeenCalled();
  });

  it("returns early when Azure DevOps client ID is missing from build", async () => {
    // Arrange
    const loadSettings = vi.fn().mockResolvedValue({
      azureDevOps: makeAzureDevOpsSettings(),
      syncDocument: "GTD.md",
      syncHeading: "## Inbox",
    });
    const saveSettings = vi.fn();
    const vault = makeVault(makeFile());
    const job = createAzureDevOpsJob(
      loadSettings,
      saveSettings,
      { ...baseConfig, azureDevOpsClientId: "" },
      vault,
      vi.fn(),
      mockApp,
    );

    // Act
    await job.task();

    // Assert
    expect(vi.mocked(fetchAssignedWorkItems)).not.toHaveBeenCalled();
  });

  it("syncs assigned work items into markdown", async () => {
    // Arrange
    const settings = {
      azureDevOps: makeAzureDevOpsSettings(),
      syncDocument: "GTD.md",
      syncHeading: "## Inbox",
    };
    const loadSettings = vi.fn().mockResolvedValue(settings);
    const saveSettings = vi.fn();
    const file = makeFile();
    const vault = makeVault(file);
    vi.mocked(fetchAssignedWorkItems).mockResolvedValue([
      {
        id: 42,
        title: "Fix bug",
        url: "https://dev.azure.com/my-org/Contoso/_workitems/edit/42",
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
    expect(vi.mocked(fetchAssignedWorkItems)).toHaveBeenCalledWith(
      "ado-token",
      "my-org",
      "Contoso",
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

  it("reconciles empty incoming set when no assignments remain", async () => {
    // Arrange
    const settings = {
      azureDevOps: makeAzureDevOpsSettings(),
      syncDocument: "GTD.md",
      syncHeading: "## Inbox",
    };
    const loadSettings = vi.fn().mockResolvedValue(settings);
    const saveSettings = vi.fn();
    const file = makeFile();
    const vault = makeVault(file);
    vi.mocked(fetchAssignedWorkItems).mockResolvedValue([]);
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
    expect(vi.mocked(reconcileSyncSourceAtomically)).toHaveBeenCalledWith(
      file,
      [],
      "azure-devops",
      "## Inbox",
      expect.any(Function),
    );
  });

  it("refreshes expired token and persists before sync", async () => {
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
    vi.mocked(fetchAssignedWorkItems).mockResolvedValue([]);
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
    expect(saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        azureDevOps: expect.objectContaining({
          credentials: expect.objectContaining({ accessToken: "fresh-token" }),
        }),
      }),
    );
    expect(vi.mocked(fetchAssignedWorkItems)).toHaveBeenCalledWith(
      "fresh-token",
      "my-org",
      "Contoso",
    );
  });

  it("clears credentials and opens modal on InvalidGrantError during refresh", async () => {
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
  });

  it("clears credentials on AzureDevOpsAuthorizationError from fetch", async () => {
    // Arrange
    const settings = {
      azureDevOps: makeAzureDevOpsSettings(),
      syncDocument: "GTD.md",
      syncHeading: "## Inbox",
    };
    const loadSettings = vi.fn().mockResolvedValue(settings);
    const saveSettings = vi.fn();
    const vault = makeVault(makeFile());
    vi.mocked(fetchAssignedWorkItems).mockRejectedValue(
      new AzureDevOpsAuthorizationError(401, "Unauthorized"),
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
  });
});
