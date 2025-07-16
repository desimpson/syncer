import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { TFile, Vault } from "obsidian";
import { createGoogleTasksJob } from "@/integrations/google-tasks/job";
import type { SyncAction, SyncItem } from "@/sync/types";
import type { GoogleTask } from "@/services/google/types";

// Module mocks
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
  return { generateSyncActions };
});

vi.mock("@/sync/writer", () => {
  const writeSyncActions = vi.fn() as unknown as (
    file: TFile,
    actions: SyncAction[],
    heading: string,
  ) => Promise<void>;
  return { writeSyncActions };
});

vi.mock("@/integrations/google-tasks/adaptor", () => {
  const mapGoogleTaskToSyncItem = vi.fn() as unknown as (
    heading: string,
  ) => (task: GoogleTask) => SyncItem;
  return { mapGoogleTaskToSyncItem };
});

vi.mock("services", () => {
  const refreshAccessToken = vi.fn() as unknown as (
    clientId: string,
    clientSecret: string,
    refreshToken: string,
  ) => Promise<{ accessToken: string; expiresIn: number }>;
  const createGoogleTasksFetcher = vi.fn() as unknown as (
    accessToken: string,
  ) => (listId: string) => Promise<readonly GoogleTask[]>;
  return {
    GoogleOAuth2Service: { refreshAccessToken },
    GoogleTasksService: { createGoogleTasksFetcher },
  };
});

// No need to mock Obsidian Notice here; we inject a notifier callback instead.

// Bring mocked fns into scope with types
import { readMarkdownSyncItems } from "@/sync/reader";
import { generateSyncActions } from "@/sync/actions";
import { writeSyncActions } from "@/sync/writer";
import { mapGoogleTaskToSyncItem } from "@/integrations/google-tasks/adaptor";
import { GoogleOAuth2Service, GoogleTasksService } from "services";

const baseConfig = { googleClientId: "id", googleClientSecret: "secret" } as const;

const makeVault = (file: TFile | null) =>
  ({ getFileByPath: vi.fn().mockReturnValue(file) }) as unknown as Vault;

const makeFile = (path = "GTD.md"): TFile =>
  ({
    path,
    name: path,
    // only fields used by tests
  }) as unknown as TFile;

describe("createGoogleTasksJob", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns early when Google Tasks not configured", async () => {
    // Arrange
    const loadSettings = vi.fn().mockResolvedValue({
      googleTasks: undefined,
      syncDocument: "GTD.md",
      syncHeading: "## Inbox",
    });
    const saveSettings = vi.fn();
    const vault = makeVault(makeFile());

    const job = createGoogleTasksJob(loadSettings, saveSettings, baseConfig, vault, vi.fn());

    // Act
    await job.task();

    // Assert
    expect(vi.mocked(GoogleTasksService.createGoogleTasksFetcher)).not.toHaveBeenCalled();
    expect(vi.mocked(readMarkdownSyncItems)).not.toHaveBeenCalled();
    expect(vi.mocked(writeSyncActions)).not.toHaveBeenCalled();
  });

  it("returns early when no lists selected", async () => {
    // Arrange
    const loadSettings = vi.fn().mockResolvedValue({
      googleTasks: {
        token: { accessToken: "tok", refreshToken: "ref", expiresIn: Date.now() + 60_000 },
        availableLists: [],
        selectedListIds: [],
        userInfo: { userId: "u", email: "e@x.com" },
      },
      syncDocument: "GTD.md",
      syncHeading: "## Inbox",
    });
    const saveSettings = vi.fn();
    const vault = makeVault(makeFile());

    const job = createGoogleTasksJob(loadSettings, saveSettings, baseConfig, vault, vi.fn());

    // Act
    await job.task();

    // Assert
    expect(vi.mocked(GoogleTasksService.createGoogleTasksFetcher)).not.toHaveBeenCalled();
    expect(vi.mocked(readMarkdownSyncItems)).not.toHaveBeenCalled();
    expect(vi.mocked(writeSyncActions)).not.toHaveBeenCalled();
  });

  it("shows a notice and returns early when sync document is missing", async () => {
    // Arrange
    const loadSettings = vi.fn().mockResolvedValue({
      googleTasks: {
        token: { accessToken: "tok", refreshToken: "ref", expiresIn: Date.now() + 60_000 },
        availableLists: [],
        selectedListIds: ["list-1"],
        userInfo: { userId: "u", email: "e@x.com" },
      },
      syncDocument: "Missing.md",
      syncHeading: "## Inbox",
    });
    const saveSettings = vi.fn();
    // eslint-disable-next-line unicorn/no-null
    const vault = makeVault(null);

    const notify = vi.fn();
    const job = createGoogleTasksJob(loadSettings, saveSettings, baseConfig, vault, notify);

    // Act
    await job.task();

    // Assert: Notice shown and downstream not called
    expect(notify).toHaveBeenCalledTimes(1);
    const noticeArgument = notify.mock.calls[0]?.[0];
    expect(String(noticeArgument)).toContain("Missing.md");
    expect(vi.mocked(readMarkdownSyncItems)).not.toHaveBeenCalled();
    expect(vi.mocked(writeSyncActions)).not.toHaveBeenCalled();
  });

  it("shows a notice and returns when file disappears mid-sync (ENOENT)", async () => {
    // Arrange
    const settings = {
      googleTasks: {
        token: { accessToken: "tok", refreshToken: "ref", expiresIn: Date.now() + 60_000 },
        availableLists: [],
        selectedListIds: ["A"],
        userInfo: { userId: "u", email: "e@x.com" },
      },
      syncDocument: "GTD.md",
      syncHeading: "## Inbox",
    };
    const loadSettings = vi.fn().mockResolvedValue(settings);
    const saveSettings = vi.fn();
    const file = makeFile();
    const vault = makeVault(file);

    vi.mocked(GoogleTasksService.createGoogleTasksFetcher).mockReturnValue(async () => [
      { id: "A-1", title: "T", webViewLink: "https://x" } as GoogleTask,
    ]);
    vi.mocked(mapGoogleTaskToSyncItem).mockReturnValue((task) => ({
      id: task.id,
      title: task.title,
      link: task.webViewLink,
      source: "google-tasks",
      heading: "## Inbox",
    }));
    vi.mocked(readMarkdownSyncItems).mockRejectedValue(
      new Error("ENOENT: no such file or directory"),
    );

    const notify = vi.fn();
    const job = createGoogleTasksJob(loadSettings, saveSettings, baseConfig, vault, notify);

    // Act
    await job.task();

    // Assert
    expect(notify).toHaveBeenCalledTimes(1);
    const noticeArgument = notify.mock.calls[0]?.[0];
    expect(String(noticeArgument)).toContain("missing on disk");
    expect(vi.mocked(writeSyncActions)).not.toHaveBeenCalled();
  });

  it("refreshes token when expired and persists it, then syncs", async () => {
    // Arrange
    const expired = Date.now() - 1000;
    const newExpiry = Date.now() + 3_600_000;
    const settings = {
      googleTasks: {
        token: { accessToken: "old", refreshToken: "ref", expiresIn: expired },
        availableLists: [],
        selectedListIds: ["A"],
        userInfo: { userId: "u", email: "e@x.com" },
      },
      syncDocument: "GTD.md",
      syncHeading: "## Inbox",
    };

    const loadSettings = vi.fn().mockResolvedValue({ ...settings });
    const saveSettings = vi.fn();
    const file = makeFile();
    const vault = makeVault(file);

    vi.mocked(GoogleOAuth2Service.refreshAccessToken).mockResolvedValue({
      accessToken: "new-token",
      expiresIn: newExpiry,
    });
    vi.mocked(GoogleTasksService.createGoogleTasksFetcher).mockReturnValue(async (listId) => [
      { id: `${listId}-1`, title: "T", webViewLink: "https://x" } as GoogleTask,
    ]);
    vi.mocked(mapGoogleTaskToSyncItem).mockReturnValue((task) => ({
      id: task.id,
      title: task.title,
      link: task.webViewLink,
      source: "google-tasks",
      heading: "## Inbox",
    }));
    vi.mocked(readMarkdownSyncItems).mockResolvedValue([]);
    vi.mocked(generateSyncActions).mockReturnValue([]);
    vi.mocked(writeSyncActions).mockResolvedValue();

    const job = createGoogleTasksJob(loadSettings, saveSettings, baseConfig, vault, vi.fn());

    // Act
    await job.task();

    // Assert token refresh & persistence
    expect(GoogleOAuth2Service.refreshAccessToken).toHaveBeenCalledWith("id", "secret", "ref");
    expect(saveSettings).toHaveBeenCalledTimes(1);
    const savedSettingsArgument = saveSettings.mock.calls[0]?.[0];
    expect(savedSettingsArgument.googleTasks.token.accessToken).toBe("new-token");
    expect(savedSettingsArgument.googleTasks.token.expiresIn).toBe(newExpiry);

    // Subsequent fetch and write
    expect(GoogleTasksService.createGoogleTasksFetcher).toHaveBeenCalledWith("new-token");
    expect(readMarkdownSyncItems).toHaveBeenCalledWith(file, "google-tasks");
    expect(generateSyncActions).toHaveBeenCalled();
    expect(writeSyncActions).toHaveBeenCalledWith(file, expect.any(Array), "## Inbox");
  });

  it("performs a full sync when configured and token valid", async () => {
    // Arrange
    const settings = {
      googleTasks: {
        token: { accessToken: "tok", refreshToken: "ref", expiresIn: Date.now() + 60_000 },
        availableLists: [],
        selectedListIds: ["A", "B"],
        userInfo: { userId: "u", email: "e@x.com" },
      },
      syncDocument: "GTD.md",
      syncHeading: "## Inbox",
    };

    const loadSettings = vi.fn().mockResolvedValue(settings);
    const saveSettings = vi.fn();
    const file = makeFile();
    const vault = makeVault(file);

    vi.mocked(GoogleTasksService.createGoogleTasksFetcher).mockReturnValue(async (listId) => [
      { id: `${listId}-1`, title: "T1", webViewLink: "https://x1" } as GoogleTask,
    ]);
    vi.mocked(mapGoogleTaskToSyncItem).mockReturnValue((task) => ({
      id: task.id,
      title: task.title,
      link: task.webViewLink,
      source: "google-tasks",
      heading: "## Inbox",
    }));
    const existing: SyncItem[] = [
      { id: "A-1", title: "Old", link: "", source: "google-tasks", heading: "## Inbox" },
    ];
    vi.mocked(readMarkdownSyncItems).mockResolvedValue(existing);
    const actions: SyncAction[] = [
      {
        operation: "update",
        item: {
          id: "A-1",
          title: "T1",
          link: "https://x1",
          source: "google-tasks",
          heading: "## Inbox",
        },
      },
      {
        operation: "create",
        item: {
          id: "B-1",
          title: "T1",
          link: "https://x1",
          source: "google-tasks",
          heading: "## Inbox",
        },
      },
    ];
    vi.mocked(generateSyncActions).mockReturnValue(actions);
    vi.mocked(writeSyncActions).mockResolvedValue();

    const job = createGoogleTasksJob(loadSettings, saveSettings, baseConfig, vault, vi.fn());

    // Act
    await job.task();

    // Assert
    expect(GoogleTasksService.createGoogleTasksFetcher).toHaveBeenCalledWith("tok");
    expect(mapGoogleTaskToSyncItem).toHaveBeenCalledWith("## Inbox");
    expect(readMarkdownSyncItems).toHaveBeenCalledWith(file, "google-tasks");
    expect(generateSyncActions).toHaveBeenCalledWith(
      [
        { id: "A-1", title: "T1", link: "https://x1", source: "google-tasks", heading: "## Inbox" },
        { id: "B-1", title: "T1", link: "https://x1", source: "google-tasks", heading: "## Inbox" },
      ],
      existing,
    );
    expect(writeSyncActions).toHaveBeenCalledWith(file, actions, "## Inbox");
  });
});
