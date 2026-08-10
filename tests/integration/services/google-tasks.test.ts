import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RequestUrlResponse } from "obsidian";
import { requestUrl } from "obsidian";
import {
  fetchGoogleTasksLists,
  fetchGoogleTasks,
  updateGoogleTaskStatus,
} from "@/services/google-tasks";

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

const requestUrlResponse = (status: number, text: string): RequestUrlResponse => ({
  status,
  text,
  headers: {},
  arrayBuffer: new ArrayBuffer(0),
  json: safeJson(text),
});

describe("Google Tasks API service", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("getGoogleTasksLists", () => {
    it("returns parsed task lists on success", async () => {
      // Arrange
      const token = "fake-token";
      const mockResponse = {
        items: [
          { id: "list-1", title: "Work" },
          { id: "list-2", title: "Personal" },
        ],
      };
      vi.mocked(requestUrl).mockResolvedValueOnce(
        requestUrlResponse(200, JSON.stringify(mockResponse)),
      );

      // Act
      const result = await fetchGoogleTasksLists(token);

      // Assert
      expect(result).toEqual(mockResponse.items);
      expect(requestUrl).toHaveBeenCalledWith({
        url: "https://tasks.googleapis.com/tasks/v1/users/@me/lists",
        method: "GET",
        headers: { Authorization: "Bearer fake-token" },
        throw: false,
      });
    });

    it("throws error when response is not ok", async () => {
      // Arrange
      vi.mocked(requestUrl).mockResolvedValueOnce(requestUrlResponse(403, ""));

      // Act & Assert
      await expect(fetchGoogleTasksLists("bad-token")).rejects.toThrow(
        "Failed to get task lists: 403",
      );
    });

    it("throws error when response JSON fails schema validation", async () => {
      // Arrange
      const invalidResponse = { foo: "bar" }; // missing items
      vi.mocked(requestUrl).mockResolvedValueOnce(
        requestUrlResponse(200, JSON.stringify(invalidResponse)),
      );

      // Act & Assert
      await expect(fetchGoogleTasksLists("fake-token")).rejects.toThrow();
    });
  });

  describe("getGoogleTasks", () => {
    it("returns parsed tasks on success", async () => {
      // Arrange
      const token = "fake-token";
      const listId = "list-123";
      const mockResponse = {
        items: [
          { id: "task-1", title: "Buy milk", webViewLink: "https://tasks.google.com/task-1" },
          { id: "task-2", title: "Write report", webViewLink: "https://tasks.google.com/task-2" },
        ],
      };
      vi.mocked(requestUrl).mockResolvedValueOnce(
        requestUrlResponse(200, JSON.stringify(mockResponse)),
      );

      // Act
      const result = await fetchGoogleTasks(token, listId);

      // Assert
      expect(result).toEqual(mockResponse.items);
      expect(requestUrl).toHaveBeenCalledWith({
        url: `https://tasks.googleapis.com/tasks/v1/lists/${listId}/tasks?showCompleted=false&showHidden=false`,
        method: "GET",
        headers: { Authorization: "Bearer fake-token" },
        throw: false,
      });
    });

    it("throws error when response is not ok", async () => {
      // Arrange
      const listId = "bad-list";
      vi.mocked(requestUrl).mockResolvedValueOnce(requestUrlResponse(404, ""));

      // Act & Assert
      await expect(fetchGoogleTasks("bad-token", listId)).rejects.toThrow(
        "Failed to get tasks for list bad-list: 404",
      );
    });

    it("throws error when response JSON fails schema validation", async () => {
      // Arrange
      const listId = "list-123";
      const invalidResponse = { foo: "bar" }; // missing items
      vi.mocked(requestUrl).mockResolvedValueOnce(
        requestUrlResponse(200, JSON.stringify(invalidResponse)),
      );

      // Act & Assert
      await expect(fetchGoogleTasks("fake-token", listId)).rejects.toThrow();
    });
  });

  describe("updateGoogleTaskStatus", () => {
    it("marks task as completed with status and timestamp", async () => {
      // Arrange
      const token = "fake-token";
      const listId = "list-123";
      const taskId = "task-456";
      vi.mocked(requestUrl).mockResolvedValueOnce(requestUrlResponse(200, "{}"));

      // Act
      await updateGoogleTaskStatus(token, listId, taskId, true);

      // Assert
      expect(requestUrl).toHaveBeenCalledWith(
        expect.objectContaining({
          url: `https://tasks.googleapis.com/tasks/v1/lists/${listId}/tasks/${taskId}`,
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          throw: false,
        }),
      );
      const call = vi.mocked(requestUrl).mock.calls[0]?.[0];
      expect(call).toBeDefined();
      expect(typeof call).toBe("object");
      if (typeof call !== "object" || call === null || typeof call.body !== "string") {
        throw new Error("Expected call.body to be a string");
      }
      const body = JSON.parse(call.body);
      expect(body.status).toBe("completed");
      expect(body.completed).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/); // ISO date format
    });

    it("marks task as uncompleted with needsAction status", async () => {
      // Arrange
      const token = "fake-token";
      const listId = "list-123";
      const taskId = "task-456";
      vi.mocked(requestUrl).mockResolvedValueOnce(requestUrlResponse(200, "{}"));

      // Act
      await updateGoogleTaskStatus(token, listId, taskId, false);

      // Assert
      expect(requestUrl).toHaveBeenCalledWith(
        expect.objectContaining({
          url: `https://tasks.googleapis.com/tasks/v1/lists/${listId}/tasks/${taskId}`,
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          throw: false,
        }),
      );
      const call = vi.mocked(requestUrl).mock.calls[0]?.[0];
      expect(call).toBeDefined();
      expect(typeof call).toBe("object");
      if (typeof call !== "object" || call === null || typeof call.body !== "string") {
        throw new Error("Expected call.body to be a string");
      }
      const body = JSON.parse(call.body);
      expect(body.status).toBe("needsAction");
      expect(body.completed).toBeUndefined();
    });

    it("throws error when response is not ok", async () => {
      // Arrange
      const token = "fake-token";
      const listId = "list-123";
      const taskId = "task-456";
      vi.mocked(requestUrl).mockResolvedValueOnce(requestUrlResponse(404, ""));

      // Act & Assert
      await expect(updateGoogleTaskStatus(token, listId, taskId, true)).rejects.toThrow(
        "Failed to update task task-456 for list list-123: 404",
      );
    });
  });
});
