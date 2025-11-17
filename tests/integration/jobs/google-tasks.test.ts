import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { TFile, Vault } from "obsidian";
import { createGoogleTasksJob } from "@/jobs/google-tasks";
import type { SyncAction, SyncItem } from "@/sync/types";
import type { GoogleTask } from "@/services/types";

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

vi.mock("@/services", () => {
  const createGoogleTasksFetcher = vi.fn() as unknown as (
    accessToken: string,
  ) => (listId: string) => Promise<readonly GoogleTask[]>;
  return {
    GoogleTasksService: { createGoogleTasksFetcher },
  };
});

vi.mock("@/services/google-tasks", () => {
  const updateGoogleTaskStatus = vi.fn() as unknown as (
    accessToken: string,
    listId: string,
    taskId: string,
    completed: boolean,
  ) => Promise<void>;
  const fetchGoogleTasks = vi.fn() as unknown as (
    accessToken: string,
    listId: string,
    showCompleted?: boolean,
  ) => Promise<readonly GoogleTask[]>;
  return { updateGoogleTaskStatus, fetchGoogleTasks };
});

vi.mock("@/auth", () => {
  const refreshAccessToken = vi.fn() as unknown as (
    clientId: string,
    refreshToken: string,
  ) => Promise<{ accessToken: string; expiryDate: number }>;
  return {
    GoogleAuth: { refreshAccessToken },
  };
});

// No need to mock Obsidian Notice here; we inject a notifier callback instead.

// Bring mocked fns into scope with types
import { readMarkdownSyncItems } from "@/sync/reader";
import { generateSyncActions } from "@/sync/actions";
import { writeSyncActions } from "@/sync/writer";
import { GoogleTasksService } from "@/services";
import { GoogleAuth } from "@/auth";
import { updateGoogleTaskStatus, fetchGoogleTasks } from "@/services/google-tasks";

const baseConfig = {
  googleClientId: "id",
} as const;

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
    // Default mock: fetchGoogleTasks returns empty array for completed tasks
    vi.mocked(fetchGoogleTasks).mockResolvedValue([]);
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
        credentials: {
          accessToken: "tok",
          refreshToken: "ref",
          expiryDate: Date.now() + 60_000,
          scope: "scope",
        },
        availableLists: [],
        selectedListIds: [],
        userInfo: { email: "e@x.com" },
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
        credentials: {
          accessToken: "tok",
          refreshToken: "ref",
          expiryDate: Date.now() + 60_000,
          scope: "scope",
        },
        availableLists: [],
        selectedListIds: ["list-1"],
        userInfo: { email: "e@x.com" },
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
        credentials: {
          accessToken: "tok",
          refreshToken: "ref",
          expiryDate: Date.now() + 60_000,
          scope: "scope",
        },
        availableLists: [],
        selectedListIds: ["A"],
        userInfo: { email: "e@x.com" },
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
        credentials: {
          accessToken: "old",
          refreshToken: "ref",
          expiryDate: expired,
          scope: "scope",
        },
        availableLists: [],
        selectedListIds: ["A"],
        userInfo: { email: "e@x.com" },
      },
      syncDocument: "GTD.md",
      syncHeading: "## Inbox",
    };

    const loadSettings = vi.fn().mockResolvedValue({ ...settings });
    const saveSettings = vi.fn();
    const file = makeFile();
    const vault = makeVault(file);

    vi.mocked(GoogleAuth.refreshAccessToken).mockResolvedValue({
      accessToken: "new-token",
      expiryDate: newExpiry,
    });
    vi.mocked(GoogleTasksService.createGoogleTasksFetcher).mockReturnValue(async (listId) => [
      { id: `${listId}-1`, title: "T", webViewLink: "https://x" } as GoogleTask,
    ]);
    vi.mocked(readMarkdownSyncItems).mockResolvedValue([]);
    vi.mocked(generateSyncActions).mockReturnValue([]);
    vi.mocked(writeSyncActions).mockResolvedValue();

    const job = createGoogleTasksJob(loadSettings, saveSettings, baseConfig, vault, vi.fn());

    // Act
    await job.task();

    // Assert token refresh & persistence
    expect(GoogleAuth.refreshAccessToken).toHaveBeenCalledWith("id", "ref");
    expect(saveSettings).toHaveBeenCalledTimes(1);
    const savedSettingsArgument = saveSettings.mock.calls[0]?.[0];
    expect(savedSettingsArgument.googleTasks.credentials.accessToken).toBe("new-token");
    expect(savedSettingsArgument.googleTasks.credentials.expiryDate).toBe(newExpiry);

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
        credentials: {
          accessToken: "tok",
          refreshToken: "ref",
          expiryDate: Date.now() + 60_000,
          scope: "scope",
        },
        availableLists: [],
        selectedListIds: ["A", "B"],
        userInfo: { email: "e@x.com" },
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
    const existing: SyncItem[] = [
      {
        id: "A-1",
        title: "Old",
        link: "",
        source: "google-tasks",
        heading: "## Inbox",
        completed: false,
      },
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
          completed: false,
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
          completed: false,
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
    expect(readMarkdownSyncItems).toHaveBeenCalledWith(file, "google-tasks");
    expect(generateSyncActions).toHaveBeenCalledWith(
      [
        {
          id: "A-1",
          title: "T1",
          link: "https://x1",
          source: "google-tasks",
          heading: "## Inbox",
          completed: false,
        },
        {
          id: "B-1",
          title: "T1",
          link: "https://x1",
          source: "google-tasks",
          heading: "## Inbox",
          completed: false,
        },
      ],
      existing,
    );
    expect(writeSyncActions).toHaveBeenCalledWith(file, actions, "## Inbox");
  });

  it("excludes failed updates from incoming items to prevent desync", async () => {
    // Arrange: Set up a scenario where we have completion changes
    const settings = {
      googleTasks: {
        credentials: {
          accessToken: "tok",
          refreshToken: "ref",
          expiryDate: Date.now() + 60_000,
          scope: "scope",
        },
        availableLists: [],
        selectedListIds: ["list-1"],
        userInfo: { email: "e@x.com" },
      },
      syncDocument: "GTD.md",
      syncHeading: "## Inbox",
    };

    const loadSettings = vi.fn().mockResolvedValue(settings);
    const saveSettings = vi.fn();
    const file = makeFile();
    const vault = makeVault(file);

    // Incoming tasks from Google (all incomplete)
    const incomingTasks: GoogleTask[] = [
      { id: "task-1", title: "Task 1", webViewLink: "https://x1" },
      { id: "task-2", title: "Task 2", webViewLink: "https://x2" },
      { id: "task-3", title: "Task 3", webViewLink: "https://x3" },
    ];

    vi.mocked(GoogleTasksService.createGoogleTasksFetcher).mockReturnValue(
      async () => incomingTasks,
    );

    // Existing tasks in Obsidian (some are completed)
    const existing: SyncItem[] = [
      {
        id: "task-1",
        title: "Task 1",
        link: "https://x1",
        source: "google-tasks",
        heading: "## Inbox",
        completed: true, // Completed in Obsidian, but incomplete in Google
      },
      {
        id: "task-2",
        title: "Task 2",
        link: "https://x2",
        source: "google-tasks",
        heading: "## Inbox",
        completed: true, // Completed in Obsidian, but incomplete in Google
      },
      {
        id: "task-3",
        title: "Task 3",
        link: "https://x3",
        source: "google-tasks",
        heading: "## Inbox",
        completed: false, // No change needed
      },
    ];

    vi.mocked(readMarkdownSyncItems).mockResolvedValue(existing);

    // Mock updateGoogleTaskStatus to fail for task-1 but succeed for task-2
    vi.mocked(updateGoogleTaskStatus).mockImplementation(
      async (_accessToken, listId, taskId, _completed) => {
        if (taskId === "task-1") {
          // Simulate a failure (e.g., network error, 404, etc.)
          throw new Error(`Failed to update task ${taskId} for list ${listId}: 404`);
        }
        // task-2 succeeds
        return;
      },
    );

    // Mock generateSyncActions to capture what incoming items it receives
    let capturedIncoming: SyncItem[] = [];
    vi.mocked(generateSyncActions).mockImplementation((incoming, _existing) => {
      capturedIncoming = [...incoming];
      return [];
    });

    vi.mocked(writeSyncActions).mockResolvedValue();

    const notify = vi.fn();
    const job = createGoogleTasksJob(loadSettings, saveSettings, baseConfig, vault, notify);

    // Act
    await job.task();

    // Assert: The bug is that updateIncomingItemsWithCompletionChanges is called
    // with ALL completion changes, even though task-1 failed to update in Google
    // This causes desync: Obsidian shows task-1 as completed, but Google still has it incomplete

    // Verify that updateGoogleTaskStatus was called for both tasks
    expect(updateGoogleTaskStatus).toHaveBeenCalledTimes(2);
    expect(updateGoogleTaskStatus).toHaveBeenCalledWith("tok", "list-1", "task-1", true);
    expect(updateGoogleTaskStatus).toHaveBeenCalledWith("tok", "list-1", "task-2", true);

    // Verify that notify was called for the failed task
    expect(notify).toHaveBeenCalledWith("Failed to sync completion status for task: task-1");

    // FIXED: Only successful updates should be applied to incoming items
    const task1InIncoming = capturedIncoming.find((item) => item.id === "task-1");
    const task2InIncoming = capturedIncoming.find((item) => item.id === "task-2");

    // task-1 update failed, so it should remain incomplete (matching Google's state)
    expect(task1InIncoming?.completed).toBe(false); // Fixed: Should be false since update failed
    // task-2 update succeeded, so it should be marked as completed
    expect(task2InIncoming?.completed).toBe(true); // This is correct since update succeeded

    // This prevents desync: Obsidian will show task-1 as incomplete (matching Google),
    // and task-2 as completed (matching Google)
  });

  it("preserves uncompleted tasks in Obsidian when uncompleting them in Google", async () => {
    // Arrange: Task is incomplete in Obsidian but completed in Google
    const settings = {
      googleTasks: {
        credentials: {
          accessToken: "tok",
          refreshToken: "ref",
          expiryDate: Date.now() + 60_000,
          scope: "scope",
        },
        availableLists: [],
        selectedListIds: ["list-1"],
        userInfo: { email: "e@x.com" },
      },
      syncDocument: "GTD.md",
      syncHeading: "## Inbox",
    };

    const loadSettings = vi.fn().mockResolvedValue(settings);
    const saveSettings = vi.fn();
    const file = makeFile();
    const vault = makeVault(file);

    // Incoming: only incomplete tasks (the task we want to uncomplete is not here)
    const incomingTasks: GoogleTask[] = [
      { id: "task-other", title: "Other Task", webViewLink: "https://x1" },
    ];
    vi.mocked(GoogleTasksService.createGoogleTasksFetcher).mockReturnValue(
      async () => incomingTasks,
    );

    // Mock fetchGoogleTasks to return the completed task when showCompleted=true
    vi.mocked(fetchGoogleTasks).mockImplementation(async (_token, listId, showCompleted) => {
      if ((showCompleted ?? false) && listId === "list-1") {
        return [{ id: "task-uncomplete", title: "Task to Uncomplete", webViewLink: "https://x2" }];
      }
      return [];
    });

    // Existing: task is incomplete in Obsidian
    const existing: SyncItem[] = [
      {
        id: "task-uncomplete",
        title: "Task to Uncomplete",
        link: "https://x2",
        source: "google-tasks",
        heading: "## Inbox",
        completed: false, // Incomplete in Obsidian
      },
    ];
    vi.mocked(readMarkdownSyncItems).mockResolvedValue(existing);
    vi.mocked(updateGoogleTaskStatus).mockResolvedValue();
    vi.mocked(generateSyncActions).mockReturnValue([]);
    vi.mocked(writeSyncActions).mockResolvedValue();

    // Capture the actions passed to writeSyncActions
    let capturedActions: SyncAction[] = [];
    vi.mocked(writeSyncActions).mockImplementation((_file, actions, _heading) => {
      capturedActions = [...actions];
      return Promise.resolve();
    });

    const notify = vi.fn();
    const job = createGoogleTasksJob(loadSettings, saveSettings, baseConfig, vault, notify);

    // Act
    await job.task();

    // Assert: Should call updateGoogleTaskStatus to uncomplete the task
    expect(updateGoogleTaskStatus).toHaveBeenCalledWith("tok", "list-1", "task-uncomplete", false);

    // Assert: Task should not be deleted (it should be added to incoming after uncompleting)
    const deleteActions = capturedActions.filter((action) => action.operation === "delete");
    const uncompletedTaskDeleteAction = deleteActions.find(
      (action) => action.item.id === "task-uncomplete",
    );
    expect(uncompletedTaskDeleteAction).toBeUndefined();
  });
});
