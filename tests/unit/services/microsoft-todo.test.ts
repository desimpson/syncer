import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RequestUrlResponse } from "obsidian";
import { requestUrl } from "obsidian";
import {
  fetchMicrosoftToDoLists,
  fetchMicrosoftToDoTasks,
  updateMicrosoftToDoTaskStatus,
} from "@/services/microsoft-todo";
import { GraphAuthorizationError, GraphRateLimitError } from "@/services/microsoft-graph-errors";

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

const graphResponse = (status: number, text: string): RequestUrlResponse => ({
  status,
  text,
  headers: {},
  arrayBuffer: new ArrayBuffer(0),
  json: safeJson(text),
});

describe("microsoft-todo service", () => {
  beforeEach(() => {
    vi.mocked(requestUrl).mockReset();
  });

  it("fetchMicrosoftToDoLists follows @odata.nextLink", async () => {
    vi.mocked(requestUrl)
      .mockResolvedValueOnce(
        graphResponse(
          200,
          JSON.stringify({
            value: [{ id: "list-1", displayName: "Tasks" }],
            "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/todo/lists?$skip=1",
          }),
        ),
      )
      .mockResolvedValueOnce(
        graphResponse(200, JSON.stringify({ value: [{ id: "list-2", displayName: "Shopping" }] })),
      );

    const result = await fetchMicrosoftToDoLists("token");

    expect(result).toEqual([
      { id: "list-1", displayName: "Tasks" },
      { id: "list-2", displayName: "Shopping" },
    ]);
    expect(requestUrl).toHaveBeenCalledTimes(2);
  });

  it("fetchMicrosoftToDoTasks paginates and drops completed tasks from the incomplete feed", async () => {
    vi.mocked(requestUrl)
      .mockResolvedValueOnce(
        graphResponse(
          200,
          JSON.stringify({
            value: [
              { id: "t1", title: "One", status: "notStarted" },
              { id: "t-done", title: "Done", status: "completed" },
            ],
            "@odata.nextLink":
              "https://graph.microsoft.com/v1.0/me/todo/lists/list-1/tasks?$skip=1",
          }),
        ),
      )
      .mockResolvedValueOnce(
        graphResponse(
          200,
          JSON.stringify({
            value: [{ id: "t2", title: "Two", status: "inProgress" }],
          }),
        ),
      );

    const result = await fetchMicrosoftToDoTasks("token", "list-1", false);

    expect(result.map((task) => task.id)).toEqual(["t1", "t2"]);
    const firstUrl = vi.mocked(requestUrl).mock.calls[0]?.[0];
    expect(
      typeof firstUrl === "object" &&
        firstUrl !== null &&
        "url" in firstUrl &&
        typeof firstUrl.url === "string" &&
        !firstUrl.url.includes("$select") &&
        !firstUrl.url.includes("$filter"),
    ).toBe(true);
  });

  it("fetchMicrosoftToDoTasks requests completed filter when showCompleted is true", async () => {
    vi.mocked(requestUrl).mockResolvedValueOnce(
      graphResponse(
        200,
        JSON.stringify({
          value: [{ id: "t-done", title: "Done", status: "completed" }],
        }),
      ),
    );

    await fetchMicrosoftToDoTasks("token", "list-1", true);

    const firstUrl = vi.mocked(requestUrl).mock.calls[0]?.[0];
    expect(
      typeof firstUrl === "object" &&
        firstUrl !== null &&
        "url" in firstUrl &&
        typeof firstUrl.url === "string" &&
        firstUrl.url.includes("status%20eq%20'completed'") &&
        !firstUrl.url.includes("$select"),
    ).toBe(true);
  });

  it("throws GraphAuthorizationError on 401", async () => {
    vi.mocked(requestUrl).mockResolvedValueOnce(graphResponse(401, "Unauthorized"));

    await expect(fetchMicrosoftToDoLists("bad")).rejects.toBeInstanceOf(GraphAuthorizationError);
  });

  it("throws GraphRateLimitError on 429", async () => {
    vi.mocked(requestUrl).mockResolvedValueOnce(graphResponse(429, "Too Many Requests"));

    await expect(fetchMicrosoftToDoLists("bad")).rejects.toBeInstanceOf(GraphRateLimitError);
  });

  it("throws short generic error for other failures without Graph error shape", async () => {
    vi.mocked(requestUrl).mockResolvedValueOnce(graphResponse(503, '{"error":"busy"}'));

    await expect(fetchMicrosoftToDoLists("bad")).rejects.toThrow(
      "Microsoft To Do list lists failed: 503",
    );
  });

  it("includes Graph error code and message in failure (not raw JSON)", async () => {
    vi.mocked(requestUrl).mockResolvedValueOnce(
      graphResponse(
        400,
        JSON.stringify({
          error: {
            code: "BadRequest",
            message: "Parsing OData Select and Expand failed.",
            innerError: { "request-id": "abc" },
          },
        }),
      ),
    );

    await expect(fetchMicrosoftToDoTasks("bad", "list-1")).rejects.toThrow(
      "Microsoft To Do list tasks failed: 400 BadRequest: Parsing OData Select and Expand failed.",
    );
  });

  it("updateMicrosoftToDoTaskStatus PATCHes completed status", async () => {
    vi.mocked(requestUrl).mockResolvedValueOnce(graphResponse(200, "{}"));

    await updateMicrosoftToDoTaskStatus("tok", "list-1", "task-1", true);

    expect(requestUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "PATCH",
        url: "https://graph.microsoft.com/v1.0/me/todo/lists/list-1/tasks/task-1",
        body: JSON.stringify({ status: "completed" }),
      }),
    );
  });

  it("updateMicrosoftToDoTaskStatus PATCHes notStarted when uncompleting", async () => {
    vi.mocked(requestUrl).mockResolvedValueOnce(graphResponse(200, "{}"));

    await updateMicrosoftToDoTaskStatus("tok", "list-1", "task-1", false);

    expect(requestUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        body: JSON.stringify({ status: "notStarted" }),
      }),
    );
  });
});
