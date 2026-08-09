import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App, TFile, Vault } from "obsidian";
import { createGmailStarredJob } from "@/jobs/gmail-starred";
import type { GmailStarredMessage } from "@/services/gmail-starred";
import type { SyncAction, SyncItem } from "@/sync/types";
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
    actionPredicate?: (action: SyncAction) => boolean,
  ) => Promise<AtomicReconcileResult>;
  return { reconcileSyncSourceAtomically };
});

vi.mock("@/services/gmail-starred", async () => {
  const actual =
    // eslint-disable-next-line @typescript-eslint/consistent-type-imports -- Vitest generic needs module object type
    await vi.importActual<typeof import("@/services/gmail-starred")>("@/services/gmail-starred");
  const fetchStarredMessages = vi.fn() as unknown as (
    accessToken: string,
  ) => Promise<{ messages: readonly GmailStarredMessage[]; truncated: boolean }>;
  const updateGmailMessageStarred = vi.fn() as unknown as (
    accessToken: string,
    messageId: string,
    starred: boolean,
  ) => Promise<void>;
  return { ...actual, fetchStarredMessages, updateGmailMessageStarred };
});

vi.mock("@/auth", async () => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports -- Vitest generic needs module object type
  const actual = await vi.importActual<typeof import("@/auth")>("@/auth");
  const refreshAccessToken = vi.fn() as unknown as (
    clientId: string,
    refreshToken: string,
  ) => Promise<{ accessToken: string; expiryDate: number }>;
  return {
    ...actual,
    GoogleAuth: { refreshAccessToken },
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

import { readMarkdownSyncItems } from "@/sync/reader";
import { reconcileSyncSourceAtomically } from "@/sync/writer";
import {
  fetchStarredMessages,
  updateGmailMessageStarred,
  GmailAuthorizationError,
  GmailRateLimitError,
} from "@/services/gmail-starred";
import { GoogleAuth } from "@/auth";

const baseConfig = {
  googleClientId: "google-client-id",
  microsoftClientId: "",
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

const makeGmailStarredSettings = () => ({
  credentials: {
    accessToken: "gmail-token",
    refreshToken: "refresh-token",
    expiryDate: Date.now() + 60_000,
    scope: "https://www.googleapis.com/auth/gmail.modify openid email profile",
  },
  userInfo: { email: "user@example.com" },
});

const makeMessage = (id: string): GmailStarredMessage => ({
  id,
  threadId: `thread-${id}`,
  internalDate: "100",
  payload: {
    headers: [
      { name: "Subject", value: `Subject ${id}` },
      { name: "From", value: "Ada <ada@example.com>" },
    ],
  },
});

describe("createGmailStarredJob completion sync", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    modalOpen.mockReset();
  });

  it("unstars Gmail message when markdown item is checked", async () => {
    const settings = {
      gmailStarred: makeGmailStarredSettings(),
      syncDocument: "GTD.md",
      syncHeading: "## Inbox",
      syncCompletionStatus: true,
    };
    const loadSettings = vi.fn().mockResolvedValue(settings);
    const saveSettings = vi.fn();
    const file = makeFile();
    const vault = makeVault(file);

    vi.mocked(fetchStarredMessages).mockResolvedValue({
      messages: [makeMessage("msg-1")],
      truncated: false,
    });

    vi.mocked(readMarkdownSyncItems).mockResolvedValue([
      {
        id: "msg-1",
        source: "gmail-starred",
        title: "Subject msg-1 (Ada)",
        link: "https://mail.google.com/mail/u/0/#all/thread-msg-1",
        heading: "## Inbox",
        completed: true,
      },
    ]);

    vi.mocked(reconcileSyncSourceAtomically).mockResolvedValue(emptyReconcileResult());

    const job = createGmailStarredJob(
      loadSettings,
      saveSettings,
      baseConfig,
      vault,
      vi.fn(),
      mockApp,
    );

    await job.task();

    expect(updateGmailMessageStarred).toHaveBeenCalledWith("gmail-token", "msg-1", false);
  });

  it("re-stars Gmail message when markdown item is unchecked and absent from fetch", async () => {
    const settings = {
      gmailStarred: makeGmailStarredSettings(),
      syncDocument: "GTD.md",
      syncHeading: "## Inbox",
      syncCompletionStatus: true,
    };
    const loadSettings = vi.fn().mockResolvedValue(settings);
    const saveSettings = vi.fn();
    const file = makeFile();
    const vault = makeVault(file);

    vi.mocked(fetchStarredMessages).mockResolvedValue({ messages: [], truncated: false });

    vi.mocked(readMarkdownSyncItems).mockResolvedValue([
      {
        id: "msg-2",
        source: "gmail-starred",
        title: "Subject msg-2 (Ada)",
        link: "https://mail.google.com/mail/u/0/#all/thread-msg-2",
        heading: "## Inbox",
        completed: false,
      },
    ]);

    let capturedIncoming: SyncItem[] = [];
    vi.mocked(reconcileSyncSourceAtomically).mockImplementation(async (_file, incomingItems) => {
      capturedIncoming = [...incomingItems];
      return emptyReconcileResult();
    });

    const job = createGmailStarredJob(
      loadSettings,
      saveSettings,
      baseConfig,
      vault,
      vi.fn(),
      mockApp,
    );

    await job.task();

    expect(updateGmailMessageStarred).toHaveBeenCalledWith("gmail-token", "msg-2", true);
    expect(capturedIncoming.find((item) => item.id === "msg-2")).toEqual(
      expect.objectContaining({ completed: false }),
    );
  });

  it("notifies and skips reconcile on sync/read failure without clearing credentials", async () => {
    const settings = {
      gmailStarred: makeGmailStarredSettings(),
      syncDocument: "GTD.md",
      syncHeading: "## Inbox",
      syncCompletionStatus: false,
    };
    const loadSettings = vi.fn().mockResolvedValue(settings);
    const saveSettings = vi.fn();
    const notify = vi.fn();
    const file = makeFile();
    const vault = makeVault(file);

    vi.mocked(fetchStarredMessages).mockRejectedValue(new Error("Gmail list messages failed: 500"));

    const job = createGmailStarredJob(
      loadSettings,
      saveSettings,
      baseConfig,
      vault,
      notify,
      mockApp,
    );

    await job.task();

    expect(notify).toHaveBeenCalledWith(expect.stringContaining("Gmail Starred sync failed"));
    expect(saveSettings).not.toHaveBeenCalled();
    expect(reconcileSyncSourceAtomically).not.toHaveBeenCalled();
    expect(modalOpen).not.toHaveBeenCalled();
  });

  it("notifies on rate limit without clearing credentials", async () => {
    const settings = {
      gmailStarred: makeGmailStarredSettings(),
      syncDocument: "GTD.md",
      syncHeading: "## Inbox",
      syncCompletionStatus: false,
    };
    const loadSettings = vi.fn().mockResolvedValue(settings);
    const saveSettings = vi.fn();
    const notify = vi.fn();
    const file = makeFile();
    const vault = makeVault(file);

    vi.mocked(fetchStarredMessages).mockRejectedValue(
      new GmailRateLimitError("Gmail list messages failed: 429"),
    );

    const job = createGmailStarredJob(
      loadSettings,
      saveSettings,
      baseConfig,
      vault,
      notify,
      mockApp,
    );

    await job.task();

    expect(notify).toHaveBeenCalledWith(expect.stringContaining("rate limit"));
    expect(saveSettings).not.toHaveBeenCalled();
    expect(modalOpen).not.toHaveBeenCalled();
  });

  it("reconciles truncated feed after notice", async () => {
    const settings = {
      gmailStarred: makeGmailStarredSettings(),
      syncDocument: "GTD.md",
      syncHeading: "## Inbox",
      syncCompletionStatus: false,
    };
    const loadSettings = vi.fn().mockResolvedValue(settings);
    const saveSettings = vi.fn();
    const notify = vi.fn();
    const file = makeFile();
    const vault = makeVault(file);

    vi.mocked(fetchStarredMessages).mockResolvedValue({
      messages: [makeMessage("msg-1")],
      truncated: true,
    });
    vi.mocked(readMarkdownSyncItems).mockResolvedValue([]);
    vi.mocked(reconcileSyncSourceAtomically).mockResolvedValue(emptyReconcileResult());

    const job = createGmailStarredJob(
      loadSettings,
      saveSettings,
      baseConfig,
      vault,
      notify,
      mockApp,
    );

    await job.task();

    expect(notify).toHaveBeenCalledWith(expect.stringContaining("limited window"));
    expect(reconcileSyncSourceAtomically).toHaveBeenCalled();
  });

  it("clears credentials and opens modal when Gmail fetch returns 401", async () => {
    const settings = {
      gmailStarred: makeGmailStarredSettings(),
      syncDocument: "GTD.md",
      syncHeading: "## Inbox",
      syncCompletionStatus: false,
    };
    const loadSettings = vi
      .fn()
      .mockResolvedValueOnce(settings)
      .mockResolvedValueOnce({ ...settings, gmailStarred: undefined });
    const saveSettings = vi.fn();
    const file = makeFile();
    const vault = makeVault(file);

    vi.mocked(fetchStarredMessages).mockRejectedValue(
      new GmailAuthorizationError(401, "Gmail list messages failed: 401 Unauthorized"),
    );

    const job = createGmailStarredJob(
      loadSettings,
      saveSettings,
      baseConfig,
      vault,
      vi.fn(),
      mockApp,
    );

    await job.task();

    expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({ gmailStarred: undefined }));
    expect(modalOpen).toHaveBeenCalled();
    expect(reconcileSyncSourceAtomically).not.toHaveBeenCalled();
  });

  it("keeps credentials and notifies when Gmail fetch returns 403", async () => {
    const settings = {
      gmailStarred: makeGmailStarredSettings(),
      syncDocument: "GTD.md",
      syncHeading: "## Inbox",
      syncCompletionStatus: false,
    };
    const loadSettings = vi.fn().mockResolvedValue(settings);
    const saveSettings = vi.fn();
    const notify = vi.fn();
    const file = makeFile();
    const vault = makeVault(file);

    vi.mocked(fetchStarredMessages).mockRejectedValue(
      new GmailAuthorizationError(
        403,
        'Gmail list messages failed: 403 {"error":{"message":"Gmail API has not been used in project"}}',
      ),
    );

    const job = createGmailStarredJob(
      loadSettings,
      saveSettings,
      baseConfig,
      vault,
      notify,
      mockApp,
    );

    await job.task();

    expect(notify).toHaveBeenCalledWith(expect.stringContaining("403"));
    expect(saveSettings).not.toHaveBeenCalled();
    expect(modalOpen).not.toHaveBeenCalled();
    expect(reconcileSyncSourceAtomically).not.toHaveBeenCalled();
  });

  it("reloads settings before persisting a refreshed access token", async () => {
    const gmailSettings = makeGmailStarredSettings();
    gmailSettings.credentials.expiryDate = Date.now() - 1;

    const settings = {
      gmailStarred: gmailSettings,
      syncDocument: "GTD.md",
      syncHeading: "## Inbox",
      syncCompletionStatus: false,
    };
    const loadSettings = vi
      .fn()
      .mockResolvedValueOnce(settings)
      .mockResolvedValueOnce({ ...settings, gmailStarred: gmailSettings });
    const saveSettings = vi.fn();
    const file = makeFile();
    const vault = makeVault(file);

    vi.mocked(GoogleAuth.refreshAccessToken).mockResolvedValue({
      accessToken: "new-token",
      expiryDate: Date.now() + 60_000,
    });
    vi.mocked(fetchStarredMessages).mockResolvedValue({ messages: [], truncated: false });
    vi.mocked(readMarkdownSyncItems).mockResolvedValue([]);
    vi.mocked(reconcileSyncSourceAtomically).mockResolvedValue(emptyReconcileResult());

    const job = createGmailStarredJob(
      loadSettings,
      saveSettings,
      baseConfig,
      vault,
      vi.fn(),
      mockApp,
    );

    await job.task();

    expect(loadSettings).toHaveBeenCalledTimes(2);
    expect(saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        gmailStarred: expect.objectContaining({
          credentials: expect.objectContaining({ accessToken: "new-token" }),
        }),
      }),
    );
  });
});
