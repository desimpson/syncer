import { describe, it, expect } from "vitest";
import { z } from "zod";
import { formatUiError, formatLogError } from "@/utils/error-formatters";

describe("formatUiError", () => {
  it("formats a normal Error", () => {
    const error = new Error("Something went wrong");
    const result = formatUiError(error);
    expect(result).toBe("Something went wrong");
  });

  it("formats a string error", () => {
    const error = "Just a string error";
    const result = formatUiError(error);
    expect(result).toBe("Just a string error");
  });

  it("formats a ZodError", () => {
    const schema = z.object({ name: z.string() });
    try {
      schema.parse({ name: 123 });
    } catch (error) {
      const result = formatUiError(error);
      expect(result).toContain("Invalid input: expected string, received number");
    }
  });

  it("formats null or undefined", () => {
    // eslint-disable-next-line unicorn/no-null
    expect(formatUiError(null)).toBe("null");
    expect(formatUiError(undefined)).toBe("undefined");
  });

  it("formats arbitrary object", () => {
    const object = { foo: "bar" };
    const result = formatUiError(object);
    expect(result).toBe(JSON.stringify(object, undefined, 2));
  });
});

describe("formatLogError", () => {
  it("includes stack trace when requested", () => {
    const error = new Error("Logging error");
    const result = formatLogError(error, true);
    expect(result).toContain("Logging error");
    expect(result).toContain("at");
  });

  it("omits stack trace when not requested", () => {
    const error = new Error("Logging error");
    const result = formatLogError(error, false);
    expect(result).toBe("Logging error");
  });

  it("formats string errors", () => {
    const result = formatLogError("String error");
    expect(result).toBe("String error");
  });

  it("formats null errors", () => {
    // eslint-disable-next-line unicorn/no-null
    const result = formatLogError(null);
    expect(result).toBe("null");
  });
});
