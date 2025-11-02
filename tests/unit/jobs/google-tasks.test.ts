import { describe, it, expect } from "vitest";
import { mapGoogleTaskToSyncItem } from "@/jobs/google-tasks";
import type { GoogleTask } from "@/services/types";

describe("mapGoogleTaskToSyncItem", () => {
  const heading = "## Inbox";
  const mapper = mapGoogleTaskToSyncItem(heading);

  it("maps a Google Task to a SyncItem", () => {
    // Arrange
    const googleTask: GoogleTask = {
      id: "task123",
      title: "Complete project",
      webViewLink: "https://tasks.google.com/task/task123",
    };

    // Act
    const result = mapper(googleTask);

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

    // Act
    const result = mapper(googleTask);

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

    // Act
    const result = mapper(googleTask);

    // Assert
    expect(result).toEqual({
      source: "google-tasks",
      id: "empty123",
      title: "",
      link: "https://tasks.google.com/task/empty123",
      heading: "## Inbox",
    });
  });

  it("uses provided heading consistently", () => {
    // Arrange
    const customHeading = "## Work Tasks";
    const customMapper = mapGoogleTaskToSyncItem(customHeading);

    const googleTask: GoogleTask = {
      id: "work456",
      title: "Team meeting",
      webViewLink: "https://tasks.google.com/task/work456",
    };

    // Act
    const result = customMapper(googleTask);

    // Assert
    expect(result.heading).toBe(customHeading);
  });
});
