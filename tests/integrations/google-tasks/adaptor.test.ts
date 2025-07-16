import { describe, expect, it } from "vitest";
import { mapGoogleTaskToSyncItem } from "@/integrations/google-tasks/adaptor";

describe("mapGoogleTaskToSyncItem", () => {
  it.each([
    {
      name: "maps all fields correctly",
      input: {
        id: "task-123",
        title: "Write unit tests",
        webViewLink: "https://tasks.google.com/task-123",
      },
      expected: {
        source: "google-tasks",
        id: "task-123",
        title: "Write unit tests",
        link: "https://tasks.google.com/task-123",
        heading: "# Tasks",
      },
    },
    {
      name: "handles empty title (still valid)",
      input: {
        id: "task-456",
        title: "",
        webViewLink: "https://tasks.google.com/task-456",
      },
      expected: {
        source: "google-tasks",
        id: "task-456",
        title: "",
        link: "https://tasks.google.com/task-456",
        heading: "# Tasks",
      },
    },
    {
      name: "handles whitespace-only title",
      input: {
        id: "task-789",
        title: "   ",
        webViewLink: "https://tasks.google.com/task-789",
      },
      expected: {
        source: "google-tasks",
        id: "task-789",
        title: "   ",
        link: "https://tasks.google.com/task-789",
        heading: "# Tasks",
      },
    },
  ])("$name", ({ input, expected }) => {
    // Arrange
    const task = input;
    const heading = "# Tasks";

    // Act
    const adaptor = mapGoogleTaskToSyncItem(heading);
    const actual = adaptor(task);

    // Assert
    expect(actual).toEqual(expected);
  });
});
