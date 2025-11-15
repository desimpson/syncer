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
      completed: false,
    });
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
      completed: false,
    });
  });

  it("handles special characters in title and link", () => {
    // Arrange
    const googleTask: GoogleTask = {
      id: "special456",
      title: "Task with 'quotes' & <symbols>",
      webViewLink: "https://tasks.google.com/task/special456?param=value&other=data",
    };
    const heading = "## Special";
    const adaptor = mapGoogleTaskToSyncItem(heading);

    // Act
    const result = adaptor(googleTask);

    // Assert
    expect(result).toEqual({
      source: "google-tasks",
      id: "special456",
      title: "Task with 'quotes' & <symbols>",
      link: "https://tasks.google.com/task/special456?param=value&other=data",
      heading: "## Special",
      completed: false,
    });
  });

  it("preserves various heading formats", () => {
    // Arrange
    const googleTask: GoogleTask = {
      id: "task789",
      title: "Test task",
      webViewLink: "https://tasks.google.com/task/task789",
    };
    const headingWithoutHash = "Custom Section";
    const adaptor = mapGoogleTaskToSyncItem(headingWithoutHash);

    // Act
    const result = adaptor(googleTask);

    // Assert
    expect(result).toEqual({
      source: "google-tasks",
      id: "task789",
      title: "Test task",
      link: "https://tasks.google.com/task/task789",
      heading: "Custom Section",
      completed: false,
    });
  });

  it("maps completed Google Task to completed SyncItem", () => {
    // Arrange
    const googleTask: GoogleTask = {
      id: "completed123",
      title: "Completed task",
      webViewLink: "https://tasks.google.com/task/completed123",
      status: "completed",
      completed: "2024-01-15T10:30:00Z",
    };
    const heading = "## Done";
    const adaptor = mapGoogleTaskToSyncItem(heading);

    // Act
    const result = adaptor(googleTask);

    // Assert
    expect(result).toEqual({
      source: "google-tasks",
      id: "completed123",
      title: "Completed task",
      link: "https://tasks.google.com/task/completed123",
      heading: "## Done",
      completed: true,
    });
  });

  it("maps needsAction Google Task to uncompleted SyncItem", () => {
    // Arrange
    const googleTask: GoogleTask = {
      id: "pending456",
      title: "Pending task",
      webViewLink: "https://tasks.google.com/task/pending456",
      status: "needsAction",
    };
    const heading = "## To Do";
    const adaptor = mapGoogleTaskToSyncItem(heading);

    // Act
    const result = adaptor(googleTask);

    // Assert
    expect(result).toEqual({
      source: "google-tasks",
      id: "pending456",
      title: "Pending task",
      link: "https://tasks.google.com/task/pending456",
      heading: "## To Do",
      completed: false,
    });
  });

  it("maps task without status to uncompleted SyncItem", () => {
    // Arrange
    const googleTask: GoogleTask = {
      id: "no-status789",
      title: "Task without status",
      webViewLink: "https://tasks.google.com/task/no-status789",
    };
    const heading = "## Inbox";
    const adaptor = mapGoogleTaskToSyncItem(heading);

    // Act
    const result = adaptor(googleTask);

    // Assert
    expect(result).toEqual({
      source: "google-tasks",
      id: "no-status789",
      title: "Task without status",
      link: "https://tasks.google.com/task/no-status789",
      heading: "## Inbox",
      completed: false,
    });
  });
});
