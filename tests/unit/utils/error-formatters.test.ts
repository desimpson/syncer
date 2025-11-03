import { describe, it, expect } from "vitest";
import { z } from "zod";
import { formatUiError, formatLogError } from "@/utils/error-formatters";

describe("formatUiError", () => {
  it("formats a normal Error", () => {
    // Arrange
    const error = new Error("Something went wrong");

    // Act
    const result = formatUiError(error);

    // Assert
    expect(result).toBe("Something went wrong");
  });

  it("formats a string error", () => {
    // Arrange
    const error = "Just a string error";

    // Act
    const result = formatUiError(error);

    // Assert
    expect(result).toBe("Just a string error");
  });

  it("formats a ZodError", () => {
    // Arrange
    const schema = z.object({ name: z.string() });

    // Act & Assert
    try {
      schema.parse({ name: 123 });
    } catch (error) {
      const result = formatUiError(error);
      expect(result).toContain("Invalid input: expected string, received number");
    }
  });

  it("formats null or undefined", () => {
    // Act & Assert
    // eslint-disable-next-line unicorn/no-null
    expect(formatUiError(null)).toBe("null");
    expect(formatUiError(undefined)).toBe("undefined");
  });

  it("formats arbitrary object", () => {
    // Arrange
    const object = { foo: "bar" };

    // Act
    const result = formatUiError(object);

    // Assert
    expect(result).toBe(JSON.stringify(object, undefined, 2));
  });
});

describe("formatLogError", () => {
  it("includes stack trace when requested", () => {
    // Arrange
    const error = new Error("Logging error");

    // Act
    const result = formatLogError(error, true);

    // Assert
    expect(result).toContain("Logging error");
    expect(result).toContain("at");
  });

  it("omits stack trace when not requested", () => {
    // Arrange
    const error = new Error("Logging error");

    // Act
    const result = formatLogError(error, false);

    // Assert
    expect(result).toBe("Logging error");
  });

  it("formats string errors", () => {
    // Act
    const result = formatLogError("String error");

    // Assert
    expect(result).toBe("String error");
  });

  it("formats null errors", () => {
    // Act
    // eslint-disable-next-line unicorn/no-null
    const result = formatLogError(null);

    // Assert
    expect(result).toBe("null");
  });
});
