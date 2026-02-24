import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import SyncerPlugin from "@/plugin";
import type { App, PluginManifest, TFile, TAbstractFile } from "obsidian";
import type { GoogleTask } from "@/services/types";

// Mock scheduler and jobs to avoid initialization issues
vi.mock("@/sync/scheduler", () => {
  return {
    createScheduler: vi.fn(() => ({
      start: vi.fn(),
      stop: vi.fn(),
      restart: vi.fn(),
    })),
  };
});

vi.mock("@/jobs/google-tasks", () => {
  return {
    createGoogleTasksJob: vi.fn(() => ({
      name: "google-tasks",
      task: vi.fn(),
    })),
  };
});

// Mock modules
vi.mock("@/services/google-tasks", () => {
  const fetchGoogleTasks = vi.fn();
  const deleteGoogleTask = vi.fn();
  return {
    fetchGoogleTasks,
    deleteGoogleTask,
    GoogleTasksService: {
      createGoogleTasksFetcher: vi.fn(),
      fetchGoogleTasksLists: vi.fn(),
      updateGoogleTaskStatus: vi.fn(),
      deleteGoogleTask,
    },
  };
});

vi.mock("@/auth", () => {
  const refreshAccessToken = vi.fn();
  return {
    GoogleAuth: { refreshAccessToken },
  };
});

// Store modal instances for test control
let modalInstances: {
  resolveConfirmation: (confirmed: boolean) => void;
  promise: Promise<boolean>;
}[] = [];

vi.mock("@/plugin/modals/delete-confirmation-modal", () => {
  class MockDeleteTaskConfirmationModal {
    private resolvePromise: ((confirmed: boolean) => void) | undefined;
    public promise: Promise<boolean>;

    public constructor(
      _app: unknown,
      public taskTitle: string,
    ) {
      this.promise = new Promise<boolean>((resolve) => {
        this.resolvePromise = resolve;
      });
      // Store instance for test control
      modalInstances.push({
        resolveConfirmation: (confirmed: boolean) => {
          this.resolvePromise?.(confirmed);
        },
        promise: this.promise,
      });
    }

    public open(): void {
      // Modal opened - test can resolve promise via modalInstances
    }

    public waitForConfirmation(): Promise<boolean> {
      return this.promise;
    }
  }

  return {
    DeleteTaskConfirmationModal: MockDeleteTaskConfirmationModal,
  };
});

// Import mocked functions
import { fetchGoogleTasks, deleteGoogleTask } from "@/services/google-tasks";
import { GoogleAuth } from "@/auth";
import { DeleteTaskConfirmationModal } from "@/plugin/modals/delete-confirmation-modal";
import { createScheduler } from "@/sync/scheduler";
import { createGoogleTasksJob } from "@/jobs/google-tasks";
import type { SyncJob } from "@/jobs/types";

describe("Task deletion confirmation", () => {
  let mockApp: App;
  let mockVault: {
    getFileByPath: (path: string) => TFile | null;
    cachedRead: (file: TFile) => Promise<string>;
    on: (
      event: "modify",
      callback: (file: TAbstractFile) => void | Promise<void>,
    ) => {
      off: () => void;
    };
  };
  let modifyCallbacks: ((file: TAbstractFile) => void | Promise<void>)[];
  let mockFile: TFile;
  let plugin: SyncerPlugin;

  const syncDocument = "test-tasks.md";
  const syncHeading = "## Google Tasks";
  const taskId = "task-123";
  const listId = "list-456";
  const taskTitle = "Test Task";

  beforeEach(() => {
    vi.resetAllMocks();
    modalInstances = [];
    modifyCallbacks = [];

    // Setup required env var
    process.env["GOOGLE_CLIENT_ID"] = process.env["GOOGLE_CLIENT_ID"] ?? "test-client-id";

    // Mock file
    mockFile = {
      path: syncDocument,
      vault: mockVault as unknown,
    } as TFile;

    // Mock vault with event emitter
    mockVault = {
      // eslint-disable-next-line unicorn/no-null
      getFileByPath: vi.fn((path: string) => (path === syncDocument ? mockFile : null)),
      cachedRead: vi.fn(),
      on: vi.fn((event: "modify", callback: (file: TAbstractFile) => void | Promise<void>) => {
        if (event === "modify") {
          modifyCallbacks.push(callback);
        }
        return {
          off: vi.fn(),
        };
      }),
    };

    // Mock file (must be created after mockVault)
    mockFile = {
      path: syncDocument,
      vault: mockVault as unknown,
    } as TFile;

    // Mock app
    mockApp = {
      vault: mockVault as unknown,
    } as unknown as App;

    // Mock console methods to avoid noise
    vi.spyOn(console, "info").mockImplementation(() => {
      /* empty */
    });
    vi.spyOn(console, "debug").mockImplementation(() => {
      /* empty */
    });
    vi.spyOn(console, "error").mockImplementation(() => {
      /* empty */
    });
  });

  afterEach(async () => {
    plugin.onunload();
    vi.restoreAllMocks();
  });

  const createPluginWithSettings = async (
    settings: {
      syncDocument: string;
      syncHeading: string;
      googleTasks?: {
        credentials: { accessToken: string; refreshToken: string; expiryDate: number };
        selectedListIds: string[];
      };
    },
    initialFileContent?: string,
  ) => {
    // Ensure manifest is properly set
    const manifest = {
      id: "syncer",
      name: "Syncer",
      version: "0.0.0",
    } as PluginManifest;
    plugin = new SyncerPlugin(mockApp, manifest);

    // Mock loadSettings to return our test settings
    vi.spyOn(plugin, "loadSettings").mockResolvedValue({
      syncDocument: settings.syncDocument,
      syncHeading: settings.syncHeading,
      syncIntervalMinutes: 60,
      syncCompletionStatus: true,
      enableDeleteSync: true,
      confirmDeleteSync: true,
      manuallyDeletedTaskIds: [],
      googleTasks: settings.googleTasks
        ? {
            userInfo: { email: "test@example.com" },
            credentials: settings.googleTasks.credentials,
            availableLists: [],
            selectedListIds: settings.googleTasks.selectedListIds,
          }
        : undefined,
    });

    // Mock saveSettings to no-op
    vi.spyOn(plugin, "saveSettings").mockResolvedValue();

    // Set up initial file content for cache initialization
    if (initialFileContent !== undefined) {
      (mockVault.cachedRead as ReturnType<typeof vi.fn>).mockResolvedValueOnce(initialFileContent);
    }

    await plugin.onload();
  };

  const createTaskLine = (taskId: string, title: string, completed = false) => {
    const checkbox = completed ? "[x]" : "[ ]";
    const metadata = JSON.stringify({
      id: taskId,
      source: "google-tasks",
      title,
      link: `https://tasks.google.com/task/${taskId}`,
      heading: syncHeading,
    });
    return `- ${checkbox} [${title}](https://tasks.google.com/task/${taskId}) <!-- ${metadata} -->`;
  };

  const triggerFileModification = async (newContent: string) => {
    // Verify modify callback is registered
    expect(modifyCallbacks.length).toBeGreaterThan(0);

    // Set up cachedRead to return new content when called during modification handler
    (mockVault.cachedRead as ReturnType<typeof vi.fn>).mockResolvedValue(newContent);

    // Trigger all registered modify callbacks
    for (const callback of modifyCallbacks) {
      await callback(mockFile);
    }
  };

  it("prompts for confirmation when task is manually deleted in Obsidian", async () => {
    // Arrange
    const previousContent = `${syncHeading}\n${createTaskLine(taskId, taskTitle)}`;
    const newContent = `${syncHeading}\n`;

    await createPluginWithSettings(
      {
        syncDocument,
        syncHeading,
        googleTasks: {
          credentials: {
            accessToken: "token-123",
            refreshToken: "refresh-123",
            expiryDate: Date.now() + 3_600_000,
          },
          selectedListIds: [listId],
        },
      },
      previousContent,
    );

    // Mock that task exists in Google Tasks
    (fetchGoogleTasks as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: taskId, title: taskTitle, status: "needsAction" } as GoogleTask,
    ]);

    // Mock modal to confirm deletion
    vi.spyOn(DeleteTaskConfirmationModal.prototype, "open").mockImplementation(function () {
      // Auto-confirm after a tick
      setTimeout(() => {
        // TODO: Change 'lib' compiler option to 'es2022' or later and use .at(-1) here and elsewhere
        // eslint-disable-next-line unicorn/prefer-at
        const instance = modalInstances[modalInstances.length - 1];
        instance?.resolveConfirmation(true);
      }, 0);
    });

    // Act: Delete the task (trigger file modification with new content)
    await triggerFileModification(newContent);

    // Wait for async operations
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Assert
    expect(fetchGoogleTasks).toHaveBeenCalledWith("token-123", listId, true);
    expect(deleteGoogleTask).toHaveBeenCalledWith("token-123", listId, taskId);
  });

  it("does not prompt when task was already deleted in Google Tasks (sync-initiated)", async () => {
    // Arrange
    const previousContent = `${syncHeading}\n${createTaskLine(taskId, taskTitle)}`;
    const newContent = `${syncHeading}\n`;

    await createPluginWithSettings(
      {
        syncDocument,
        syncHeading,
        googleTasks: {
          credentials: {
            accessToken: "token-123",
            refreshToken: "refresh-123",
            expiryDate: Date.now() + 3_600_000,
          },
          selectedListIds: [listId],
        },
      },
      previousContent,
    );

    // Mock that task does NOT exist in Google Tasks (already deleted)
    (fetchGoogleTasks as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const modalOpenSpy = vi.spyOn(DeleteTaskConfirmationModal.prototype, "open");

    // Act: Delete the task (trigger file modification with new content)
    await triggerFileModification(newContent);

    // Wait for async operations to complete
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Assert
    expect(fetchGoogleTasks).toHaveBeenCalledWith("token-123", listId, true);
    expect(modalOpenSpy).not.toHaveBeenCalled();
    expect(deleteGoogleTask).not.toHaveBeenCalled();
  });

  it("does not delete when user cancels confirmation", async () => {
    // Arrange
    const previousContent = `${syncHeading}\n${createTaskLine(taskId, taskTitle)}`;
    const newContent = `${syncHeading}\n`;

    await createPluginWithSettings(
      {
        syncDocument,
        syncHeading,
        googleTasks: {
          credentials: {
            accessToken: "token-123",
            refreshToken: "refresh-123",
            expiryDate: Date.now() + 3_600_000,
          },
          selectedListIds: [listId],
        },
      },
      previousContent,
    );

    // Mock that task exists in Google Tasks
    (fetchGoogleTasks as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: taskId, title: taskTitle, status: "needsAction" } as GoogleTask,
    ]);

    // Mock modal to cancel deletion
    vi.spyOn(DeleteTaskConfirmationModal.prototype, "open").mockImplementation(function () {
      // Auto-cancel after a tick
      setTimeout(() => {
        // eslint-disable-next-line unicorn/prefer-at
        const instance = modalInstances[modalInstances.length - 1];
        instance?.resolveConfirmation(false);
      }, 0);
    });

    // Act: Delete the task (trigger file modification with new content)
    await triggerFileModification(newContent);

    // Wait for async operations to complete
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Assert
    expect(fetchGoogleTasks).toHaveBeenCalledWith("token-123", listId, true);
    expect(deleteGoogleTask).not.toHaveBeenCalled();
  });

  it("refreshes token if expired before checking task existence", async () => {
    // Arrange
    const previousContent = `${syncHeading}\n${createTaskLine(taskId, taskTitle)}`;
    const newContent = `${syncHeading}\n`;

    const expiredToken = {
      accessToken: "expired-token",
      refreshToken: "refresh-123",
      expiryDate: Date.now() - 1000, // Expired
    };

    await createPluginWithSettings(
      {
        syncDocument,
        syncHeading,
        googleTasks: {
          credentials: expiredToken,
          selectedListIds: [listId],
        },
      },
      previousContent,
    );

    // Mock token refresh
    (GoogleAuth.refreshAccessToken as ReturnType<typeof vi.fn>).mockResolvedValue({
      accessToken: "new-token",
      expiryDate: Date.now() + 3_600_000,
    });

    // Mock that task exists in Google Tasks
    (fetchGoogleTasks as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: taskId, title: taskTitle, status: "needsAction" } as GoogleTask,
    ]);

    // Mock modal to confirm deletion
    vi.spyOn(DeleteTaskConfirmationModal.prototype, "open").mockImplementation(function () {
      setTimeout(() => {
        // eslint-disable-next-line unicorn/prefer-at
        const instance = modalInstances[modalInstances.length - 1];
        instance?.resolveConfirmation(true);
      }, 0);
    });

    // Act: Delete the task (trigger file modification with new content)
    await triggerFileModification(newContent);

    // Wait for async operations to complete
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Assert
    // Use expect.any(String) for client ID because CI masks environment variables as "***"
    expect(GoogleAuth.refreshAccessToken).toHaveBeenCalledWith(expect.any(String), "refresh-123");
    expect(fetchGoogleTasks).toHaveBeenCalledWith("new-token", listId, true);
    expect(deleteGoogleTask).toHaveBeenCalledWith("new-token", listId, taskId);
  });

  it("ignores deletions in non-sync documents", async () => {
    // Arrange
    const otherDocument = "other-file.md";
    const otherFile = {
      path: otherDocument,
      vault: {} as unknown,
    } as TFile;

    await createPluginWithSettings({
      syncDocument,
      syncHeading,
      googleTasks: {
        credentials: {
          accessToken: "token-123",
          refreshToken: "refresh-123",
          expiryDate: Date.now() + 3_600_000,
        },
        selectedListIds: [listId],
      },
    });

    const modalOpenSpy = vi.spyOn(DeleteTaskConfirmationModal.prototype, "open");

    // Act: Modify a different file
    // eslint-disable-next-line unicorn/no-null
    (mockVault.getFileByPath as ReturnType<typeof vi.fn>).mockReturnValue(null);
    await Promise.all(modifyCallbacks.map((callback) => callback(otherFile)));

    // Wait for async operations
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Assert
    expect(modalOpenSpy).not.toHaveBeenCalled();
    expect(fetchGoogleTasks).not.toHaveBeenCalled();
  });

  it("does not track deletion when enableDeleteSync is disabled", async () => {
    // Arrange
    const taskId = "task-123";
    const taskTitle = "Test Task";
    const listId = "list-456";
    const syncDocument = "test-tasks.md";

    const initialFileContent = `## Tasks
- [ ] [${taskTitle}](https://tasks.google.com/task/${taskId}) <!-- {"id":"${taskId}","source":"google-tasks","title":"${taskTitle}","link":"https://tasks.google.com/task/${taskId}","heading":"## Tasks"} -->
`;

    const updatedFileContent = `## Tasks
`;

    await createPluginWithSettings(
      {
        syncDocument,
        syncHeading: "## Tasks",
        googleTasks: {
          credentials: {
            accessToken: "token-123",
            refreshToken: "refresh-123",
            expiryDate: Date.now() + 3_600_000,
          },
          selectedListIds: [listId],
        },
      },
      initialFileContent,
    );

    // Mock loadSettings to return enableDeleteSync: false
    vi.spyOn(plugin, "loadSettings").mockResolvedValue({
      syncDocument,
      syncHeading: "## Tasks",
      syncIntervalMinutes: 60,
      syncCompletionStatus: true,
      enableDeleteSync: false,
      confirmDeleteSync: true,
      manuallyDeletedTaskIds: [],
      googleTasks: {
        userInfo: { email: "test@example.com" },
        credentials: {
          accessToken: "token-123",
          refreshToken: "refresh-123",
          expiryDate: Date.now() + 3_600_000,
        },
        availableLists: [],
        selectedListIds: [listId],
      },
    });

    const updateSettingsSpy = vi.spyOn(plugin, "updateSettings");

    await plugin.onload();

    // Simulate file modification (task deletion)
    mockFile.vault.cachedRead = vi.fn().mockResolvedValue(updatedFileContent);
    const modifyCallback = (mockVault.on as ReturnType<typeof vi.fn>).mock.calls.find(
      (call: unknown[]) => call[0] === "modify",
    )?.[1];
    if (modifyCallback !== undefined) {
      await modifyCallback(mockFile);
    }

    // Wait for async operations
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Assert: Task should not be tracked since enableDeleteSync is false
    expect(updateSettingsSpy).not.toHaveBeenCalled();
  });

  it("does not track task if already in manuallyDeletedTaskIds", async () => {
    // Arrange
    const taskId = "task-123";
    const taskTitle = "Test Task";
    const listId = "list-456";
    const syncDocument = "test-tasks.md";

    const initialFileContent = `## Tasks
- [ ] [${taskTitle}](https://tasks.google.com/task/${taskId}) <!-- {"id":"${taskId}","source":"google-tasks","title":"${taskTitle}","link":"https://tasks.google.com/task/${taskId}","heading":"## Tasks"} -->
`;

    const updatedFileContent = `## Tasks
`;

    await createPluginWithSettings(
      {
        syncDocument,
        syncHeading: "## Tasks",
        googleTasks: {
          credentials: {
            accessToken: "token-123",
            refreshToken: "refresh-123",
            expiryDate: Date.now() + 3_600_000,
          },
          selectedListIds: [listId],
        },
      },
      initialFileContent,
    );

    // Mock loadSettings to return task already in manuallyDeletedTaskIds
    vi.spyOn(plugin, "loadSettings").mockResolvedValue({
      syncDocument,
      syncHeading: "## Tasks",
      syncIntervalMinutes: 60,
      syncCompletionStatus: true,
      enableDeleteSync: true,
      confirmDeleteSync: true,
      manuallyDeletedTaskIds: [taskId], // Already tracked
      googleTasks: {
        userInfo: { email: "test@example.com" },
        credentials: {
          accessToken: "token-123",
          refreshToken: "refresh-123",
          expiryDate: Date.now() + 3_600_000,
        },
        availableLists: [],
        selectedListIds: [listId],
      },
    });

    const updateSettingsSpy = vi.spyOn(plugin, "updateSettings");

    await plugin.onload();

    // Mock modal to cancel deletion
    vi.spyOn(DeleteTaskConfirmationModal.prototype, "open").mockImplementation(function () {
      setTimeout(() => {
        // eslint-disable-next-line unicorn/prefer-at
        const instance = modalInstances[modalInstances.length - 1];
        instance?.resolveConfirmation(false);
      }, 0);
    });

    // Mock fetchGoogleTasks to return task exists
    vi.mocked(fetchGoogleTasks).mockResolvedValue([
      { id: taskId, title: taskTitle, status: "needsAction" } as GoogleTask,
    ]);

    // Simulate file modification (task deletion)
    mockFile.vault.cachedRead = vi.fn().mockResolvedValue(updatedFileContent);
    const modifyCallback = (mockVault.on as ReturnType<typeof vi.fn>).mock.calls.find(
      (call: unknown[]) => call[0] === "modify",
    )?.[1];
    if (modifyCallback !== undefined) {
      await modifyCallback(mockFile);
    }

    // Wait for async operations
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Assert: updateSettings should not be called since task is already tracked
    const callsWithManuallyDeletedTaskIds = updateSettingsSpy.mock.calls.find(
      (call: unknown[]) =>
        (call[0] as { manuallyDeletedTaskIds?: unknown[] })?.manuallyDeletedTaskIds !== undefined,
    );
    expect(callsWithManuallyDeletedTaskIds).toBeUndefined();
  });

  it("tracks all cancelled deletions when multiple tasks are deleted at once", async () => {
    // Arrange: Create a file with multiple tasks
    const taskIds = ["task-A", "task-B", "task-C"];
    const taskTitles = ["Task A", "Task B", "Task C"];
    const listId = "list-456";
    const syncDocument = "test-tasks.md";

    const initialFileContent = `${syncHeading}\n${taskIds
      .map((id, index) => {
        const title = taskTitles[index];
        if (title === undefined) {
          throw new Error(`Missing title for task ${id} at index ${index}`);
        }
        return createTaskLine(id, title);
      })
      .join("\n")}\n`;

    const updatedFileContent = `${syncHeading}\n`;

    // Track settings state to simulate progressive updates
    let currentManuallyDeletedTaskIds: string[] = [];

    await createPluginWithSettings(
      {
        syncDocument,
        syncHeading,
        googleTasks: {
          credentials: {
            accessToken: "token-123",
            refreshToken: "refresh-123",
            expiryDate: Date.now() + 3_600_000,
          },
          selectedListIds: [listId],
        },
      },
      initialFileContent,
    );

    // Mock loadSettings to return progressively updated settings
    // This simulates the fix where we reload settings before tracking each task
    vi.spyOn(plugin, "loadSettings").mockImplementation(async () => {
      const baseSettings = {
        syncDocument,
        syncHeading,
        syncIntervalMinutes: 60,
        syncCompletionStatus: true,
        enableDeleteSync: true,
        confirmDeleteSync: true,
        manuallyDeletedTaskIds: [...currentManuallyDeletedTaskIds],
        googleTasks: {
          userInfo: { email: "test@example.com" },
          credentials: {
            accessToken: "token-123",
            refreshToken: "refresh-123",
            expiryDate: Date.now() + 3_600_000,
          },
          availableLists: [],
          selectedListIds: [listId],
        },
      };
      return baseSettings;
    });

    // Mock updateSettings to update our tracked state
    vi.spyOn(plugin, "updateSettings").mockImplementation(async (partial) => {
      if (partial.manuallyDeletedTaskIds !== undefined) {
        currentManuallyDeletedTaskIds = [...partial.manuallyDeletedTaskIds];
      }
    });

    // Mock that all tasks exist in Google Tasks
    (fetchGoogleTasks as ReturnType<typeof vi.fn>).mockResolvedValue(
      taskIds.map((id, index) => ({
        id,
        title: taskTitles[index],
        status: "needsAction",
      })) as GoogleTask[],
    );

    // Mock modal to cancel deletion for each task sequentially
    vi.spyOn(DeleteTaskConfirmationModal.prototype, "open").mockImplementation(function () {
      setTimeout(() => {
        // Cancel deletion for each task
        // eslint-disable-next-line unicorn/prefer-at
        const instance = modalInstances[modalInstances.length - 1];
        instance?.resolveConfirmation(false);
      }, 0);
    });

    // Act: Delete all tasks at once (trigger file modification with new content)
    await triggerFileModification(updatedFileContent);

    // Wait for all async operations to complete
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Assert: All three tasks should be tracked in manuallyDeletedTaskIds
    expect(currentManuallyDeletedTaskIds).toHaveLength(3);
    expect(currentManuallyDeletedTaskIds).toContain("task-A");
    expect(currentManuallyDeletedTaskIds).toContain("task-B");
    expect(currentManuallyDeletedTaskIds).toContain("task-C");

    // Verify updateSettings was called for each task
    const updateCalls = (plugin.updateSettings as ReturnType<typeof vi.fn>).mock.calls.filter(
      (call: unknown[]) =>
        (call[0] as { manuallyDeletedTaskIds?: unknown[] })?.manuallyDeletedTaskIds !== undefined,
    );
    expect(updateCalls.length).toBeGreaterThanOrEqual(3);

    // Verify each call includes the previous tasks plus the new one
    const firstCall = updateCalls[0]?.[0] as { manuallyDeletedTaskIds?: string[] };
    expect(firstCall?.manuallyDeletedTaskIds).toHaveLength(1);

    // eslint-disable-next-line unicorn/prefer-at
    const lastCall = updateCalls[updateCalls.length - 1]?.[0] as {
      manuallyDeletedTaskIds?: string[];
    };
    expect(lastCall?.manuallyDeletedTaskIds).toHaveLength(3);
    expect(lastCall?.manuallyDeletedTaskIds).toEqual(expect.arrayContaining(taskIds));
  });

  it("does not trigger delete confirmation when tasks are removed during sync (e.g. list deselected)", async () => {
    // Arrange: File has a task that will be removed when the sync runs
    // (simulating what happens when a list is deselected)
    const previousContent = `${syncHeading}\n${createTaskLine(taskId, taskTitle)}`;
    const postSyncContent = `${syncHeading}\n`;

    await createPluginWithSettings(
      {
        syncDocument,
        syncHeading,
        googleTasks: {
          credentials: {
            accessToken: "token-123",
            refreshToken: "refresh-123",
            expiryDate: Date.now() + 3_600_000,
          },
          selectedListIds: [listId],
        },
      },
      previousContent,
    );

    // Get the wrapped job that onload() passed to the scheduler
    const wrappedJobs = vi.mocked(createScheduler).mock.calls[0]?.[0] as SyncJob[];
    const wrappedJob = wrappedJobs[0];
    expect(wrappedJob).toBeDefined();

    // Get the inner (unwrapped) job task mock
    const innerJob = vi.mocked(createGoogleTasksJob).mock.results[0]?.value as SyncJob;
    expect(innerJob).toBeDefined();

    // The inner task simulates writeSyncActions removing tasks from a deselected list,
    // which triggers the vault "modify" event during the sync
    vi.mocked(innerJob.task).mockImplementation(async () => {
      await triggerFileModification(postSyncContent);
    });

    const modalOpenSpy = vi.spyOn(DeleteTaskConfirmationModal.prototype, "open");

    // Act: Run the wrapped sync job (isSyncInProgress is set around the inner task)
    await wrappedJob?.task();
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Assert: No deletion modal or Google Tasks API calls
    expect(modalOpenSpy).not.toHaveBeenCalled();
    expect(fetchGoogleTasks).not.toHaveBeenCalled();
    expect(deleteGoogleTask).not.toHaveBeenCalled();
  });

  it("updates file content cache after sync so delayed modify events do not falsely detect deletions", async () => {
    // Arrange: File has a task that will be removed by the sync.
    // This tests the second defence: if the modify event arrives AFTER the
    // sync completes (e.g. Obsidian batches/delays events), the cache should
    // already reflect the post-sync content, so no deletions are detected.
    const previousContent = `${syncHeading}\n${createTaskLine(taskId, taskTitle)}`;
    const postSyncContent = `${syncHeading}\n`;

    await createPluginWithSettings(
      {
        syncDocument,
        syncHeading,
        googleTasks: {
          credentials: {
            accessToken: "token-123",
            refreshToken: "refresh-123",
            expiryDate: Date.now() + 3_600_000,
          },
          selectedListIds: [listId],
        },
      },
      previousContent,
    );

    // Get the wrapped job and inner task
    const wrappedJobs = vi.mocked(createScheduler).mock.calls[0]?.[0] as SyncJob[];
    const wrappedJob = wrappedJobs[0];
    expect(wrappedJob).toBeDefined();

    const innerJob = vi.mocked(createGoogleTasksJob).mock.results[0]?.value as SyncJob;
    // Inner task is a no-op (the file was modified externally by the sync engine)
    vi.mocked(innerJob.task).mockResolvedValue(undefined);

    // Set cachedRead to return post-sync content (as if the sync had already written the file)
    (mockVault.cachedRead as ReturnType<typeof vi.fn>).mockResolvedValue(postSyncContent);

    // Run the wrapped job — initialiseFileContentCache updates the cache to post-sync content
    await wrappedJob?.task();

    const modalOpenSpy = vi.spyOn(DeleteTaskConfirmationModal.prototype, "open");

    // Simulate a delayed modify event arriving after sync has completed
    // (isSyncInProgress is now false, but the cache is up to date)
    await triggerFileModification(postSyncContent);
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Assert: No modal because the cache reflects post-sync content
    expect(modalOpenSpy).not.toHaveBeenCalled();
    expect(fetchGoogleTasks).not.toHaveBeenCalled();
    expect(deleteGoogleTask).not.toHaveBeenCalled();
  });

  it("prompts for confirmation when deleting task from unselected list", async () => {
    // Arrange: Reproduce the bug where deletion sync misses tasks in unselected lists
    // 1. Create List A with Item 1 in Google Tasks
    // 2. Select List A and sync in Obsidian
    // 3. Deselect List A
    // 4. Delete Item 1
    // 5. Observe that the prompt should appear (but currently doesn't because we only search selected lists)
    const listAId = "list-a";
    const listBId = "list-b";
    const taskId = "task-from-list-a";
    const taskTitle = "Item 1";

    const previousContent = `${syncHeading}\n${createTaskLine(taskId, taskTitle)}`;
    const newContent = `${syncHeading}\n`;

    await createPluginWithSettings(
      {
        syncDocument,
        syncHeading,
        googleTasks: {
          credentials: {
            accessToken: "token-123",
            refreshToken: "refresh-123",
            expiryDate: Date.now() + 3_600_000,
          },
          selectedListIds: [listBId], // List A is NOT selected
        },
      },
      previousContent,
    );

    // Mock loadSettings to include availableLists with List A (even though it's not selected)
    vi.spyOn(plugin, "loadSettings").mockResolvedValue({
      syncDocument,
      syncHeading,
      syncIntervalMinutes: 60,
      syncCompletionStatus: true,
      enableDeleteSync: true,
      confirmDeleteSync: true,
      manuallyDeletedTaskIds: [],
      googleTasks: {
        userInfo: { email: "test@example.com" },
        credentials: {
          accessToken: "token-123",
          refreshToken: "refresh-123",
          expiryDate: Date.now() + 3_600_000,
        },
        availableLists: [
          { id: listAId, title: "List A" },
          { id: listBId, title: "List B" },
        ],
        selectedListIds: [listBId], // Only List B is selected
      },
    });

    // Mock that task exists in List A (unselected list)
    // When checking selected lists (List B), return empty
    // When checking List A, return the task
    (fetchGoogleTasks as ReturnType<typeof vi.fn>).mockImplementation(
      (_accessToken: string, listId: string) => {
        if (listId === listAId) {
          return Promise.resolve([
            { id: taskId, title: taskTitle, status: "needsAction" } as GoogleTask,
          ]);
        }
        return Promise.resolve([]); // List B is empty
      },
    );

    // Mock modal to confirm deletion
    vi.spyOn(DeleteTaskConfirmationModal.prototype, "open").mockImplementation(function () {
      setTimeout(() => {
        // eslint-disable-next-line unicorn/prefer-at
        const instance = modalInstances[modalInstances.length - 1];
        instance?.resolveConfirmation(true);
      }, 0);
    });

    // Act: Delete the task (trigger file modification with new content)
    await triggerFileModification(newContent);

    // Wait for async operations
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Assert: Should find the task in List A (unselected) and prompt for deletion
    // With the fix, checkTaskExistsInGoogle searches all availableLists, not just selectedListIds
    expect(fetchGoogleTasks).toHaveBeenCalledWith("token-123", listAId, true);
    expect(deleteGoogleTask).toHaveBeenCalledWith("token-123", listAId, taskId);
  });
});
