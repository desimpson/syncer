import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchGoogleTasksLists, fetchGoogleTasks } from "@/services/google/tasks";

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
        `https://tasks.googleapis.com/tasks/v1/lists/${listId}/tasks`,
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
});
