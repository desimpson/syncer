import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App, TFile, Vault } from "obsidian";
import { createMicrosoftToDoJob } from "@/jobs/microsoft-todo";
import type { MicrosoftToDoTask } from "@/services/types";
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

vi.mock("@/services/microsoft-todo", async () => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports -- Vitest generic needs module object type
  const actual = await vi.importActual<typeof import("@/services/microsoft-todo")>(
    "@/services/microsoft-todo",
  );
  const fetchMicrosoftToDoTasks = vi.fn() as unknown as (
    accessToken: string,
    listId: string,
    completed?: boolean,
  ) => Promise<readonly MicrosoftToDoTask[]>;
  const updateMicrosoftToDoTaskStatus = vi.fn() as unknown as (
    accessToken: string,
    listId: string,
    taskId: string,
    completed: boolean,
  ) => Promise<void>;
  return { ...actual, fetchMicrosoftToDoTasks, updateMicrosoftToDoTaskStatus };
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
import { fetchMicrosoftToDoTasks, updateMicrosoftToDoTaskStatus } from "@/services/microsoft-todo";
import { MicrosoftAuth, InvalidGrantError } from "@/auth";
import { GraphAuthorizationError, GraphRateLimitError } from "@/services/microsoft-graph-errors";

const baseConfig = {
  googleClientId: "",
  microsoftClientId: "ms-client-id",
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

const makeToDoSettings = () => ({
  credentials: {
    accessToken: "todo-token",
    refreshToken: "refresh-token",
    expiryDate: Date.now() + 60_000,
    scope: "Tasks.ReadWrite",
    tenantSegment: "consumers",
  },
  userInfo: { email: "user@example.com", displayName: "User Example" },
  availableLists: [{ id: "list-1", displayName: "Tasks" }],
  selectedListIds: ["list-1"],
});

describe("createMicrosoftToDoJob", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    modalOpen.mockReset();
  });

  it("no-ops when microsoftToDo is not configured", async () => {
    const loadSettings = vi.fn().mockResolvedValue({
      syncDocument: "GTD.md",
      syncHeading: "## Inbox",
      syncCompletionStatus: false,
    });
    const job = createMicrosoftToDoJob(
      loadSettings,
      vi.fn(),
      baseConfig,
      makeVault(makeFile()),
      vi.fn(),
      mockApp,
    );

    await job.task();

    expect(fetchMicrosoftToDoTasks).not.toHaveBeenCalled();
  });

  it("no-ops when no lists are selected", async () => {
    const settings = {
      microsoftToDo: { ...makeToDoSettings(), selectedListIds: [] },
      syncDocument: "GTD.md",
      syncHeading: "## Inbox",
      syncCompletionStatus: false,
    };
    const job = createMicrosoftToDoJob(
      vi.fn().mockResolvedValue(settings),
      vi.fn(),
      baseConfig,
      makeVault(makeFile()),
      vi.fn(),
      mockApp,
    );

    await job.task();

    expect(fetchMicrosoftToDoTasks).not.toHaveBeenCalled();
  });

  it("shows rate-limit notice and keeps credentials on 429", async () => {
    const settings = {
      microsoftToDo: makeToDoSettings(),
      syncDocument: "GTD.md",
      syncHeading: "## Inbox",
      syncCompletionStatus: false,
    };
    const notify = vi.fn();
    vi.mocked(fetchMicrosoftToDoTasks).mockRejectedValue(
      new GraphRateLimitError(429, "Microsoft To Do list tasks failed: 429"),
    );

    const job = createMicrosoftToDoJob(
      vi.fn().mockResolvedValue(settings),
      vi.fn(),
      baseConfig,
      makeVault(makeFile()),
      notify,
      mockApp,
    );

    await job.task();

    expect(notify).toHaveBeenCalledWith("Microsoft To Do sync hit a rate limit. Try again later.");
    expect(modalOpen).not.toHaveBeenCalled();
  });

  it("clears credentials on Graph 401 during fetch", async () => {
    const settings = {
      microsoftToDo: makeToDoSettings(),
      syncDocument: "GTD.md",
      syncHeading: "## Inbox",
      syncCompletionStatus: false,
    };
    const loadSettings = vi
      .fn()
      .mockResolvedValueOnce(settings)
      .mockResolvedValueOnce({ ...settings, microsoftToDo: undefined });
    const saveSettings = vi.fn();

    vi.mocked(fetchMicrosoftToDoTasks).mockRejectedValue(
      new GraphAuthorizationError(401, "Microsoft To Do list tasks failed: 401"),
    );

    const job = createMicrosoftToDoJob(
      loadSettings,
      saveSettings,
      baseConfig,
      makeVault(makeFile()),
      vi.fn(),
      mockApp,
    );

    await job.task();

    expect(saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({ microsoftToDo: undefined }),
    );
    expect(modalOpen).toHaveBeenCalled();
  });

  it("keeps credentials and shows prefixed sync failure on read errors", async () => {
    const settings = {
      microsoftToDo: makeToDoSettings(),
      syncDocument: "GTD.md",
      syncHeading: "## Inbox",
      syncCompletionStatus: false,
    };
    const notify = vi.fn();
    vi.mocked(fetchMicrosoftToDoTasks).mockRejectedValue(
      new Error("Microsoft To Do list tasks failed: 503"),
    );

    const job = createMicrosoftToDoJob(
      vi.fn().mockResolvedValue(settings),
      vi.fn(),
      baseConfig,
      makeVault(makeFile()),
      notify,
      mockApp,
    );

    await job.task();

    expect(notify).toHaveBeenCalledWith(
      "Microsoft To Do sync failed: Microsoft To Do list tasks failed: 503",
    );
    expect(modalOpen).not.toHaveBeenCalled();
  });

  it("clears credentials on InvalidGrantError during refresh", async () => {
    const toDoSettings = makeToDoSettings();
    toDoSettings.credentials.expiryDate = Date.now() - 1;
    const settings = {
      microsoftToDo: toDoSettings,
      syncDocument: "GTD.md",
      syncHeading: "## Inbox",
      syncCompletionStatus: false,
    };
    const loadSettings = vi
      .fn()
      .mockResolvedValueOnce(settings)
      .mockResolvedValueOnce({ ...settings, microsoftToDo: undefined });
    const saveSettings = vi.fn();

    vi.mocked(MicrosoftAuth.refreshAccessToken).mockRejectedValue(
      new InvalidGrantError("Token has been expired or revoked"),
    );

    const job = createMicrosoftToDoJob(
      loadSettings,
      saveSettings,
      baseConfig,
      makeVault(makeFile()),
      vi.fn(),
      mockApp,
    );

    await job.task();

    expect(saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({ microsoftToDo: undefined }),
    );
    expect(modalOpen).toHaveBeenCalled();
  });

  it("marks To Do task complete when markdown item is checked", async () => {
    const settings = {
      microsoftToDo: makeToDoSettings(),
      syncDocument: "GTD.md",
      syncHeading: "## Inbox",
      syncCompletionStatus: true,
    };
    const file = makeFile();
    vi.mocked(fetchMicrosoftToDoTasks).mockImplementation(async (_token, _listId, completed) =>
      completed === true
        ? [{ id: "task-1", title: "Task 1", status: "completed" as const }]
        : [{ id: "task-1", title: "Task 1", status: "notStarted" as const }],
    );
    vi.mocked(readMarkdownSyncItems).mockResolvedValue([
      {
        id: "task-1",
        source: "microsoft-to-do",
        title: "Task 1",
        link: "https://to-do.live.com/tasks/id/task-1",
        heading: "## Inbox",
        completed: true,
      },
    ]);
    vi.mocked(updateMicrosoftToDoTaskStatus).mockResolvedValue();
    vi.mocked(reconcileSyncSourceAtomically).mockResolvedValue(emptyReconcileResult());

    const job = createMicrosoftToDoJob(
      vi.fn().mockResolvedValue(settings),
      vi.fn(),
      baseConfig,
      makeVault(file),
      vi.fn(),
      mockApp,
    );

    await job.task();

    expect(updateMicrosoftToDoTaskStatus).toHaveBeenCalledWith(
      "todo-token",
      "list-1",
      "task-1",
      true,
    );
    expect(reconcileSyncSourceAtomically).toHaveBeenCalledWith(
      file,
      expect.arrayContaining([
        expect.objectContaining({ id: "task-1", source: "microsoft-to-do" }),
      ]),
      "microsoft-to-do",
      "## Inbox",
      expect.any(Function),
    );
  });
});
