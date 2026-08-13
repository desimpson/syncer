import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App, TFile, Vault } from "obsidian";
import { createTodoistJob } from "@/jobs/todoist";
import type { TodoistTask } from "@/services/types";
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

vi.mock("@/services/todoist", async () => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports -- Vitest generic needs module object type
  const actual = await vi.importActual<typeof import("@/services/todoist")>("@/services/todoist");
  const fetchTodoistTasks = vi.fn() as unknown as (
    accessToken: string,
    projectId: string,
    completed?: boolean,
  ) => Promise<readonly TodoistTask[]>;
  const updateTodoistTaskStatus = vi.fn() as unknown as (
    accessToken: string,
    taskId: string,
    completed: boolean,
  ) => Promise<void>;
  return { ...actual, fetchTodoistTasks, updateTodoistTaskStatus };
});

vi.mock("@/auth", async () => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports -- Vitest generic needs module object type
  const actual = await vi.importActual<typeof import("@/auth")>("@/auth");
  const refreshAccessToken = vi.fn() as unknown as (
    clientId: string,
    token: { refreshToken: string },
  ) => Promise<{ accessToken: string; expiryDate: number }>;
  return {
    ...actual,
    TodoistAuth: { refreshAccessToken },
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
import { fetchTodoistTasks, updateTodoistTaskStatus } from "@/services/todoist";
import { TodoistAuth, InvalidGrantError } from "@/auth";
import { TodoistAuthorizationError, TodoistRateLimitError } from "@/services/todoist-errors";

const baseConfig = {
  googleClientId: "",
  microsoftClientId: "",
  todoistClientId: "todoist-client-id",
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

const makeTodoistSettings = () => ({
  credentials: {
    accessToken: "todoist-token",
    refreshToken: "refresh-token",
    expiryDate: Date.now() + 60_000,
    scope: "data:read_write",
  },
  userInfo: { email: "user@example.com", displayName: "User Example" },
  availableProjects: [{ id: "project-1", name: "Inbox" }],
  selectedProjectIds: ["project-1"],
});

describe("createTodoistJob", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    modalOpen.mockReset();
  });

  it("no-ops when todoist is not configured", async () => {
    const loadSettings = vi.fn().mockResolvedValue({
      syncDocument: "GTD.md",
      syncHeading: "## Inbox",
      syncCompletionStatus: false,
    });
    const job = createTodoistJob(
      loadSettings,
      vi.fn(),
      baseConfig,
      makeVault(makeFile()),
      vi.fn(),
      mockApp,
    );

    await job.task();

    expect(fetchTodoistTasks).not.toHaveBeenCalled();
  });

  it("no-ops when no projects are selected", async () => {
    const settings = {
      todoist: { ...makeTodoistSettings(), selectedProjectIds: [] },
      syncDocument: "GTD.md",
      syncHeading: "## Inbox",
      syncCompletionStatus: false,
    };
    const job = createTodoistJob(
      vi.fn().mockResolvedValue(settings),
      vi.fn(),
      baseConfig,
      makeVault(makeFile()),
      vi.fn(),
      mockApp,
    );

    await job.task();

    expect(fetchTodoistTasks).not.toHaveBeenCalled();
  });

  it("shows rate-limit notice and keeps credentials on 429", async () => {
    const settings = {
      todoist: makeTodoistSettings(),
      syncDocument: "GTD.md",
      syncHeading: "## Inbox",
      syncCompletionStatus: false,
    };
    const notify = vi.fn();
    vi.mocked(fetchTodoistTasks).mockRejectedValue(
      new TodoistRateLimitError(429, "Todoist list tasks failed: 429"),
    );

    const job = createTodoistJob(
      vi.fn().mockResolvedValue(settings),
      vi.fn(),
      baseConfig,
      makeVault(makeFile()),
      notify,
      mockApp,
    );

    await job.task();

    expect(notify).toHaveBeenCalledWith("Todoist sync hit a rate limit. Try again later.");
    expect(modalOpen).not.toHaveBeenCalled();
  });

  it("clears credentials on Todoist 401 during fetch", async () => {
    const settings = {
      todoist: makeTodoistSettings(),
      syncDocument: "GTD.md",
      syncHeading: "## Inbox",
      syncCompletionStatus: false,
    };
    const loadSettings = vi
      .fn()
      .mockResolvedValueOnce(settings)
      .mockResolvedValueOnce({ ...settings, todoist: undefined });
    const saveSettings = vi.fn();

    vi.mocked(fetchTodoistTasks).mockRejectedValue(
      new TodoistAuthorizationError(401, "Todoist list tasks failed: 401"),
    );

    const job = createTodoistJob(
      loadSettings,
      saveSettings,
      baseConfig,
      makeVault(makeFile()),
      vi.fn(),
      mockApp,
    );

    await job.task();

    expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({ todoist: undefined }));
    expect(modalOpen).toHaveBeenCalled();
  });

  it("continues syncing when one selected project fails with a non-auth error", async () => {
    const settings = {
      todoist: {
        ...makeTodoistSettings(),
        selectedProjectIds: ["project-1", "project-bad"],
      },
      syncDocument: "GTD.md",
      syncHeading: "## Inbox",
      syncCompletionStatus: false,
    };
    const file = makeFile();
    vi.mocked(fetchTodoistTasks).mockImplementation(async (_token, projectId) => {
      if (projectId === "project-bad") {
        throw new Error("Todoist list tasks failed: 404");
      }
      return [{ id: "task-1", content: "Task 1", checked: false }];
    });
    vi.mocked(readMarkdownSyncItems).mockResolvedValue([]);
    vi.mocked(reconcileSyncSourceAtomically).mockResolvedValue(emptyReconcileResult());

    const job = createTodoistJob(
      vi.fn().mockResolvedValue(settings),
      vi.fn(),
      baseConfig,
      makeVault(file),
      vi.fn(),
      mockApp,
    );

    await job.task();

    expect(reconcileSyncSourceAtomically).toHaveBeenCalled();
  });

  it("refreshes expired tokens before fetching", async () => {
    const settings = {
      todoist: {
        ...makeTodoistSettings(),
        credentials: {
          ...makeTodoistSettings().credentials,
          expiryDate: Date.now() - 1000,
        },
      },
      syncDocument: "GTD.md",
      syncHeading: "## Inbox",
      syncCompletionStatus: false,
    };
    const saveSettings = vi.fn();
    vi.mocked(TodoistAuth.refreshAccessToken).mockResolvedValue({
      accessToken: "fresh-token",
      expiryDate: Date.now() + 60_000,
    });
    vi.mocked(fetchTodoistTasks).mockResolvedValue([]);
    vi.mocked(readMarkdownSyncItems).mockResolvedValue([]);
    vi.mocked(reconcileSyncSourceAtomically).mockResolvedValue(emptyReconcileResult());

    const job = createTodoistJob(
      vi.fn().mockResolvedValue(settings),
      saveSettings,
      baseConfig,
      makeVault(makeFile()),
      vi.fn(),
      mockApp,
    );

    await job.task();

    expect(TodoistAuth.refreshAccessToken).toHaveBeenCalled();
    expect(fetchTodoistTasks).toHaveBeenCalledWith("fresh-token", "project-1", false);
  });

  it("clears credentials on invalid grant during refresh", async () => {
    const settings = {
      todoist: {
        ...makeTodoistSettings(),
        credentials: {
          ...makeTodoistSettings().credentials,
          expiryDate: Date.now() - 1000,
        },
      },
      syncDocument: "GTD.md",
      syncHeading: "## Inbox",
      syncCompletionStatus: false,
    };
    const loadSettings = vi
      .fn()
      .mockResolvedValueOnce(settings)
      .mockResolvedValueOnce({ ...settings, todoist: undefined });
    const saveSettings = vi.fn();
    vi.mocked(TodoistAuth.refreshAccessToken).mockRejectedValue(
      new InvalidGrantError("Token has been expired or revoked"),
    );

    const job = createTodoistJob(
      loadSettings,
      saveSettings,
      baseConfig,
      makeVault(makeFile()),
      vi.fn(),
      mockApp,
    );

    await job.task();

    expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({ todoist: undefined }));
    expect(modalOpen).toHaveBeenCalled();
    expect(fetchTodoistTasks).not.toHaveBeenCalled();
  });

  it("writes completion changes back to Todoist when enabled", async () => {
    const settings = {
      todoist: makeTodoistSettings(),
      syncDocument: "GTD.md",
      syncHeading: "## Inbox",
      syncCompletionStatus: true,
    };
    const file = makeFile();
    vi.mocked(fetchTodoistTasks).mockImplementation(async (_token, _projectId, completed) => {
      if (completed === true) {
        return [];
      }
      return [{ id: "task-1", content: "Task 1", checked: false }];
    });
    vi.mocked(readMarkdownSyncItems).mockResolvedValue([
      {
        id: "task-1",
        source: "todoist",
        title: "Task 1",
        link: "https://app.todoist.com/app/task/task-1",
        heading: "## Inbox",
        completed: true,
      },
    ]);
    vi.mocked(updateTodoistTaskStatus).mockResolvedValue(undefined);
    vi.mocked(reconcileSyncSourceAtomically).mockResolvedValue(emptyReconcileResult());

    const job = createTodoistJob(
      vi.fn().mockResolvedValue(settings),
      vi.fn(),
      baseConfig,
      makeVault(file),
      vi.fn(),
      mockApp,
    );

    await job.task();

    expect(updateTodoistTaskStatus).toHaveBeenCalledWith("todoist-token", "task-1", true);
    expect(reconcileSyncSourceAtomically).toHaveBeenCalled();
  });

  it("reopens a locally unchecked task missing from the active feed", async () => {
    const settings = {
      todoist: makeTodoistSettings(),
      syncDocument: "GTD.md",
      syncHeading: "## Inbox",
      syncCompletionStatus: true,
    };
    const file = makeFile();
    vi.mocked(fetchTodoistTasks).mockResolvedValue([]);
    vi.mocked(readMarkdownSyncItems).mockResolvedValue([
      {
        id: "task-old",
        source: "todoist",
        title: "Old task",
        link: "https://app.todoist.com/app/task/task-old",
        heading: "## Inbox",
        completed: false,
      },
    ]);
    vi.mocked(updateTodoistTaskStatus).mockResolvedValue(undefined);
    vi.mocked(reconcileSyncSourceAtomically).mockResolvedValue(emptyReconcileResult());

    const job = createTodoistJob(
      vi.fn().mockResolvedValue(settings),
      vi.fn(),
      baseConfig,
      makeVault(file),
      vi.fn(),
      mockApp,
    );

    await job.task();

    expect(updateTodoistTaskStatus).toHaveBeenCalledWith("todoist-token", "task-old", false);
  });
});
