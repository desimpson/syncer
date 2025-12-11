import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import ObsidianSyncerPlugin from "@/plugin";
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
  let plugin: ObsidianSyncerPlugin;

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
      id: "obsidian-syncer",
      name: "Obsidian Syncer",
      version: "0.0.0",
    } as PluginManifest;
    plugin = new ObsidianSyncerPlugin(mockApp, manifest);

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
    expect(GoogleAuth.refreshAccessToken).toHaveBeenCalledWith("test-client-id", "refresh-123");
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
    (mockVault.getFileByPath as ReturnType<typeof vi.fn>).mockReturnValue(null);
    await Promise.all(modifyCallbacks.map((callback) => callback(otherFile)));

    // Wait for async operations
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Assert
    expect(modalOpenSpy).not.toHaveBeenCalled();
    expect(fetchGoogleTasks).not.toHaveBeenCalled();
  });
});
