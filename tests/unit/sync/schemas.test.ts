import { describe, it, expect } from "vitest";
import { parsedLineSchema } from "@/sync/schemas";

describe("parsedLineSchema", () => {
  it("parses valid sync item metadata", () => {
    // Arrange
    const input = {
      id: "task123",
      source: "google-tasks",
      title: "Complete project",
      link: "https://tasks.google.com/task/task123",
      heading: "## Work",
    };

    // Act
    const result = parsedLineSchema.parse(input);

    // Assert
    expect(result).toEqual(input);
  });

  it("provides default empty string for missing title", () => {
    // Arrange
    const input = {
      id: "task456",
      source: "google-tasks",
      link: "https://tasks.google.com/task/task456",
      heading: "## Personal",
    };

    // Act
    const result = parsedLineSchema.parse(input);

    // Assert
    expect(result).toEqual({
      ...input,
      title: "",
    });
  });

  it("fails validation for missing required fields", () => {
    // Arrange
    const testCases = [
      {
        input: {
          source: "google-tasks",
          title: "Task",
          link: "https://example.com",
          heading: "## Work",
        },
        field: "id",
      },
      {
        input: { id: "123", title: "Task", link: "https://example.com", heading: "## Work" },
        field: "source",
      },
      {
        input: { id: "123", source: "google-tasks", title: "Task", heading: "## Work" },
        field: "link",
      },
      {
        input: { id: "123", source: "google-tasks", title: "Task", link: "https://example.com" },
        field: "heading",
      },
    ];

    // Act & Assert
    testCases.forEach(({ input, field }) => {
      const result = parsedLineSchema.safeParse(input);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((issue) => issue.path.includes(field))).toBe(true);
      }
    });
  });

  it("fails validation for empty required strings", () => {
    // Arrange
    const testCases = [
      { id: "", source: "google-tasks", link: "https://example.com", heading: "## Work" },
      { id: "123", source: "", link: "https://example.com", heading: "## Work" },
      { id: "123", source: "google-tasks", link: "", heading: "## Work" },
      { id: "123", source: "google-tasks", link: "https://example.com", heading: "" },
    ];

    // Act & Assert
    testCases.forEach((input) => {
      const result = parsedLineSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  it("accepts all valid string combinations", () => {
    // Arrange
    const input = {
      id: "complex-id-123",
      source: "different-source",
      title: "A very long title with special characters: & < > \" '",
      link: "https://example.com/path?param=value#anchor",
      heading: "### Complex Heading with Numbers 123",
    };

    // Act
    const result = parsedLineSchema.parse(input);

    // Assert
    expect(result).toEqual(input);
  });
});
