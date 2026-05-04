import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App, TFile, Vault } from "obsidian";
import { createMicrosoftOutlookJob } from "@/jobs/microsoft-outlook";
import type { OutlookFlaggedMessage } from "@/services/outlook-mail";
import type { SyncAction, SyncItem } from "@/sync/types";

vi.mock("@/sync/reader", () => {
  const readMarkdownSyncItems = vi.fn() as unknown as (
    file: TFile,
    source: string,
  ) => Promise<SyncItem[]>;
  return { readMarkdownSyncItems };
});

vi.mock("@/sync/actions", () => {
  const generateSyncActions = vi.fn() as unknown as (
    incoming: SyncItem[],
    existing: SyncItem[],
  ) => SyncAction[];
  const filterActions = vi.fn((actions: SyncAction[], predicate: (action: SyncAction) => boolean) =>
    actions.filter(predicate),
  ) as unknown as (
    actions: SyncAction[],
    predicate: (action: SyncAction) => boolean,
  ) => SyncAction[];
  const shouldPreserveCompletedDeletes = vi.fn(
    (action: SyncAction) => action.operation !== "delete" || !action.item.completed,
  ) as unknown as (action: SyncAction) => boolean;
  return { generateSyncActions, filterActions, shouldPreserveCompletedDeletes };
});

vi.mock("@/sync/writer", () => {
  const writeSyncActions = vi.fn() as unknown as (
    file: TFile,
    actions: SyncAction[],
    heading: string,
  ) => Promise<void>;
  return { writeSyncActions };
});

vi.mock("@/services/outlook-mail", () => {
  const fetchFlaggedMessages = vi.fn() as unknown as (
    accessToken: string,
  ) => Promise<readonly OutlookFlaggedMessage[]>;
  const updateOutlookMessageFlag = vi.fn() as unknown as (
    accessToken: string,
    messageId: string,
    completed: boolean,
  ) => Promise<void>;
  return { fetchFlaggedMessages, updateOutlookMessageFlag };
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
    MicrosoftAuth: { refreshAccessToken },
  };
});

import { readMarkdownSyncItems } from "@/sync/reader";
import { generateSyncActions } from "@/sync/actions";
import { writeSyncActions } from "@/sync/writer";
import { fetchFlaggedMessages, updateOutlookMessageFlag } from "@/services/outlook-mail";

const baseConfig = {
  googleClientId: "",
  microsoftClientId: "outlook-client-id",
} as const;

const makeVault = (file: TFile | null) =>
  ({ getFileByPath: vi.fn().mockReturnValue(file) }) as unknown as Vault;

const makeFile = (path = "GTD.md"): TFile =>
  ({
    path,
    name: path,
  }) as unknown as TFile;

const mockApp = {} as unknown as App;

const makeOutlookSettings = () => ({
  credentials: {
    accessToken: "outlook-token",
    refreshToken: "refresh-token",
    expiryDate: Date.now() + 60_000,
    tenantSegment: "common",
  },
  userInfo: { email: "user@example.com", name: "User Example" },
});

describe("createMicrosoftOutlookJob integration", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("keeps markdown in sync with only successful Outlook flag PATCHes", async () => {
    // Arrange
    const settings = {
      microsoftOutlook: makeOutlookSettings(),
      syncDocument: "GTD.md",
      syncHeading: "## Inbox",
      syncCompletionStatus: true,
    };
    const loadSettings = vi.fn().mockResolvedValue(settings);
    const saveSettings = vi.fn();
    const file = makeFile();
    const vault = makeVault(file);
    const notify = vi.fn();

    vi.mocked(fetchFlaggedMessages).mockResolvedValue([
      {
        id: "msg-ok",
        subject: "Keep synced",
        webLink: "https://outlook.office.com/mail/msg-ok",
        from: { emailAddress: { name: "Ada" } },
      },
      {
        id: "msg-fail",
        subject: "Will fail",
        webLink: "https://outlook.office.com/mail/msg-fail",
        from: { emailAddress: { name: "Ada" } },
      },
    ]);

    vi.mocked(readMarkdownSyncItems).mockResolvedValue([
      {
        id: "msg-ok",
        source: "microsoft-outlook",
        title: "Keep synced (Ada)",
        link: "https://outlook.office.com/mail/msg-ok",
        heading: "## Inbox",
        completed: true,
      },
      {
        id: "msg-fail",
        source: "microsoft-outlook",
        title: "Will fail (Ada)",
        link: "https://outlook.office.com/mail/msg-fail",
        heading: "## Inbox",
        completed: true,
      },
    ]);

    vi.mocked(updateOutlookMessageFlag).mockImplementation(async (_token, messageId) => {
      if (messageId === "msg-fail") {
        throw new Error("Graph patch failed");
      }
    });

    let capturedIncoming: SyncItem[] = [];
    vi.mocked(generateSyncActions).mockImplementation((incoming) => {
      capturedIncoming = [...incoming];
      return [];
    });
    vi.mocked(writeSyncActions).mockResolvedValue();

    const job = createMicrosoftOutlookJob(
      loadSettings,
      saveSettings,
      baseConfig,
      vault,
      notify,
      mockApp,
    );

    // Act
    await job.task();

    // Assert
    expect(updateOutlookMessageFlag).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenCalledWith("Failed to sync Outlook flag for message: msg-fail");

    const successful = capturedIncoming.find((item) => item.id === "msg-ok");
    const failed = capturedIncoming.find((item) => item.id === "msg-fail");
    expect(successful?.completed).toBe(true);
    expect(failed?.completed).toBe(false);
  });
});
