import { describe, expect, it } from "vitest";
import { summariseGraphErrorBody } from "@/services/microsoft-graph-errors";

describe("summariseGraphErrorBody", () => {
  it("returns code and message from a Graph error payload", () => {
    // Arrange
    const body = JSON.stringify({
      error: { code: "BadRequest", message: "Parsing OData Select and Expand failed." },
    });

    // Act
    const summary = summariseGraphErrorBody(body);

    // Assert
    expect(summary).toBe("BadRequest: Parsing OData Select and Expand failed.");
  });

  it("truncates long messages", () => {
    // Arrange
    const message = "x".repeat(200);

    // Act
    const summary = summariseGraphErrorBody(
      JSON.stringify({ error: { code: "BadRequest", message } }),
    );

    // Assert
    expect(summary).toBeDefined();
    expect(summary?.endsWith("…")).toBe(true);
    expect(summary?.length).toBe(160);
  });

  it("returns undefined for non-Graph or empty bodies", () => {
    // Act / Assert
    expect(summariseGraphErrorBody("")).toBeUndefined();
    expect(summariseGraphErrorBody("not-json")).toBeUndefined();
    expect(summariseGraphErrorBody('{"error":"busy"}')).toBeUndefined();
  });
});
