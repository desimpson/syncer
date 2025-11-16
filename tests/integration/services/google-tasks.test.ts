import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  fetchGoogleTasksLists,
  fetchGoogleTasks,
  updateGoogleTaskStatus,
} from "@/services/google-tasks";

describe("Google Tasks API service", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
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
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      });

      // Act
      const result = await fetchGoogleTasksLists(token);

      // Assert
      expect(result).toEqual(mockResponse.items);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "https://tasks.googleapis.com/tasks/v1/users/@me/lists",
        { headers: { Authorization: "Bearer fake-token" } },
      );
    });

    it("throws error when response is not ok", async () => {
      // Arrange
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
      });

      // Act & Assert
      await expect(fetchGoogleTasksLists("bad-token")).rejects.toThrow(
        "Failed to get task lists: 403",
      );
    });

    it("throws error when response JSON fails schema validation", async () => {
      // Arrange
      const invalidResponse = { foo: "bar" }; // missing items
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => invalidResponse,
      });

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
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      });

      // Act
      const result = await fetchGoogleTasks(token, listId);

      // Assert
      expect(result).toEqual(mockResponse.items);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        `https://tasks.googleapis.com/tasks/v1/lists/${listId}/tasks?showCompleted=false&showHidden=false`,
        { headers: { Authorization: "Bearer fake-token" } },
      );
    });

    it("throws error when response is not ok", async () => {
      // Arrange
      const listId = "bad-list";
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
      });

      // Act & Assert
      await expect(fetchGoogleTasks("bad-token", listId)).rejects.toThrow(
        "Failed to get tasks for list bad-list: 404",
      );
    });

    it("throws error when response JSON fails schema validation", async () => {
      // Arrange
      const listId = "list-123";
      const invalidResponse = { foo: "bar" }; // missing items
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => invalidResponse,
      });

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
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
      });
      globalThis.fetch = mockFetch;

      // Act
      await updateGoogleTaskStatus(token, listId, taskId, true);

      // Assert
      expect(mockFetch).toHaveBeenCalledWith(
        `https://tasks.googleapis.com/tasks/v1/lists/${listId}/tasks/${taskId}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: expect.stringContaining('"status":"completed"'),
        },
      );
      const call = mockFetch.mock.calls[0];
      expect(call).toBeDefined();
      const bodyParameter = call?.[1];
      expect(bodyParameter).toBeDefined();
      expect(typeof bodyParameter?.body).toBe("string");
      if (bodyParameter === undefined || typeof bodyParameter.body !== "string") {
        throw new Error("Expected bodyParameter.body to be a string");
      }
      const body = JSON.parse(bodyParameter.body);
      expect(body.status).toBe("completed");
      expect(body.completed).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/); // ISO date format
    });

    it("marks task as uncompleted with needsAction status", async () => {
      // Arrange
      const token = "fake-token";
      const listId = "list-123";
      const taskId = "task-456";
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
      });
      globalThis.fetch = mockFetch;

      // Act
      await updateGoogleTaskStatus(token, listId, taskId, false);

      // Assert
      expect(mockFetch).toHaveBeenCalledWith(
        `https://tasks.googleapis.com/tasks/v1/lists/${listId}/tasks/${taskId}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: expect.stringContaining('"status":"needsAction"'),
        },
      );
      const call = mockFetch.mock.calls[0];
      expect(call).toBeDefined();
      const bodyParameter = call?.[1];
      expect(bodyParameter).toBeDefined();
      expect(typeof bodyParameter?.body).toBe("string");
      if (bodyParameter === undefined || typeof bodyParameter.body !== "string") {
        throw new Error("Expected bodyParameter.body to be a string");
      }
      const body = JSON.parse(bodyParameter.body);
      expect(body.status).toBe("needsAction");
      expect(body.completed).toBeUndefined();
    });

    it("throws error when response is not ok", async () => {
      // Arrange
      const token = "fake-token";
      const listId = "list-123";
      const taskId = "task-456";
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
      });

      // Act & Assert
      await expect(updateGoogleTaskStatus(token, listId, taskId, true)).rejects.toThrow(
        "Failed to update task task-456 for list list-123: 404",
      );
    });
  });
});
