import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RequestUrlResponse } from "obsidian";
import { requestUrl } from "obsidian";
import {
  fetchTodoistProjects,
  fetchTodoistTasks,
  updateTodoistTaskStatus,
} from "@/services/todoist";
import { TodoistAuthorizationError, TodoistRateLimitError } from "@/services/todoist-errors";

const safeJson = (text: string): unknown => {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
};

const todoistResponse = (
  status: number,
  text: string,
  headers: Record<string, string> = {},
): RequestUrlResponse => ({
  status,
  text,
  headers,
  arrayBuffer: new ArrayBuffer(0),
  json: safeJson(text),
});

describe("todoist service", () => {
  beforeEach(() => {
    vi.mocked(requestUrl).mockReset();
  });

  it("fetchTodoistProjects walks next_cursor pagination", async () => {
    vi.mocked(requestUrl)
      .mockResolvedValueOnce(
        todoistResponse(
          200,
          JSON.stringify({
            results: [{ id: "p1", name: "Inbox" }],
            next_cursor: "cursor-2",
          }),
        ),
      )
      .mockResolvedValueOnce(
        todoistResponse(
          200,
          JSON.stringify({
            results: [{ id: "p2", name: "Work" }],
          }),
        ),
      );

    const result = await fetchTodoistProjects("token");

    expect(result).toEqual([
      { id: "p1", name: "Inbox" },
      { id: "p2", name: "Work" },
    ]);
    expect(requestUrl).toHaveBeenCalledTimes(2);
  });

  it("fetchTodoistTasks paginates active tasks for a project", async () => {
    vi.mocked(requestUrl)
      .mockResolvedValueOnce(
        todoistResponse(
          200,
          JSON.stringify({
            results: [{ id: "t1", content: "One", checked: false }],
            next_cursor: "cursor-2",
          }),
        ),
      )
      .mockResolvedValueOnce(
        todoistResponse(
          200,
          JSON.stringify({
            results: [{ id: "t2", content: "Two", checked: false }],
          }),
        ),
      );

    const result = await fetchTodoistTasks("token", "project-1", false);

    expect(result.map((task) => task.id)).toEqual(["t1", "t2"]);
    const firstUrl = vi.mocked(requestUrl).mock.calls[0]?.[0];
    expect(
      typeof firstUrl === "object" &&
        firstUrl !== null &&
        "url" in firstUrl &&
        typeof firstUrl.url === "string" &&
        firstUrl.url.includes("project_id=project-1"),
    ).toBe(true);
  });

  it("throws TodoistAuthorizationError on HTTP 401", async () => {
    vi.mocked(requestUrl).mockResolvedValueOnce(
      todoistResponse(401, JSON.stringify({ error: "unauthorized" })),
    );

    await expect(fetchTodoistProjects("token")).rejects.toBeInstanceOf(TodoistAuthorizationError);
  });

  it("throws TodoistRateLimitError after retry budget is exhausted", async () => {
    vi.mocked(requestUrl).mockResolvedValue(
      todoistResponse(429, "rate limited", { "retry-after": "0" }),
    );

    await expect(fetchTodoistProjects("token")).rejects.toBeInstanceOf(TodoistRateLimitError);
    expect(requestUrl).toHaveBeenCalledTimes(4);
  });

  it("updateTodoistTaskStatus POSTs close and reopen endpoints", async () => {
    vi.mocked(requestUrl).mockResolvedValue(todoistResponse(200, "null"));

    await updateTodoistTaskStatus("token", "task-1", true);
    await updateTodoistTaskStatus("token", "task-1", false);

    const closeCall = vi.mocked(requestUrl).mock.calls[0]?.[0];
    const reopenCall = vi.mocked(requestUrl).mock.calls[1]?.[0];
    expect(
      typeof closeCall === "object" &&
        closeCall !== null &&
        "url" in closeCall &&
        closeCall.url?.includes("/tasks/task-1/close"),
    ).toBe(true);
    expect(
      typeof reopenCall === "object" &&
        reopenCall !== null &&
        "url" in reopenCall &&
        reopenCall.url?.includes("/tasks/task-1/reopen"),
    ).toBe(true);
  });
});
