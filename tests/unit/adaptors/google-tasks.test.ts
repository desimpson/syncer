import { describe, it, expect } from "vitest";
import { mapGoogleTaskToSyncItem } from "@/adaptors";
import type { GoogleTask } from "@/services/types";

describe("mapGoogleTaskToSyncItem", () => {
  it("maps a Google Task to a SyncItem", () => {
    // Arrange
    const googleTask: GoogleTask = {
      id: "task123",
      title: "Complete project",
      webViewLink: "https://tasks.google.com/task/task123",
    };
    const heading = "## Inbox";
    const adaptor = mapGoogleTaskToSyncItem(heading);

    // Act
    const result = adaptor(googleTask);

    // Assert
    expect(result).toEqual({
      source: "google-tasks",
      id: "task123",
      title: "Complete project",
      link: "https://tasks.google.com/task/task123",
      heading: "## Inbox",
    });
  });

  it("preserves all fields correctly", () => {
    // Arrange
    const googleTask: GoogleTask = {
      id: "xyz789",
      title: "Review documents",
      webViewLink: "https://tasks.google.com/task/xyz789",
    };
    const heading = "## Work";
    const adaptor = mapGoogleTaskToSyncItem(heading);

    // Act
    const result = adaptor(googleTask);

    // Assert
    expect(result.source).toBe("google-tasks");
    expect(result.id).toBe(googleTask.id);
    expect(result.title).toBe(googleTask.title);
    expect(result.link).toBe(googleTask.webViewLink);
    expect(result.heading).toBe(heading);
  });

  it("works with empty title", () => {
    // Arrange
    const googleTask: GoogleTask = {
      id: "empty123",
      title: "",
      webViewLink: "https://tasks.google.com/task/empty123",
    };
    const heading = "## Tasks";
    const adaptor = mapGoogleTaskToSyncItem(heading);

    // Act
    const result = adaptor(googleTask);

    // Assert
    expect(result).toEqual({
      source: "google-tasks",
      id: "empty123",
      title: "",
      link: "https://tasks.google.com/task/empty123",
      heading: "## Tasks",
    });
  });
});
