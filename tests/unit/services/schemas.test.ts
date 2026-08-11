import { describe, it, expect } from "vitest";
import { googleOAuthTokenResponseSchema, microsoftToDoTaskSchema } from "@/services/schemas";
import { refreshResponseSchema, googleUserInfoResponseSchema } from "@/auth/schemas";

describe("googleOAuthTokenResponseSchema", () => {
  it("parses valid token response", () => {
    // Arrange
    const input = { access_token: "a", refresh_token: "r", expires_in: 3600 };

    // Act & Assert
    expect(googleOAuthTokenResponseSchema.parse(input)).toEqual(input);
  });

  it("fails for missing fields", () => {
    // Arrange
    const input = { access_token: "a" } as unknown;

    // Act
    const result = googleOAuthTokenResponseSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(false);
  });
});

describe("googleUserInfoResponseSchema", () => {
  it("parses valid user info", () => {
    // Arrange
    const input = { email: "user@example.com" };

    // Act & Assert
    expect(googleUserInfoResponseSchema.parse(input)).toEqual(input);
  });

  it("rejects invalid email", () => {
    // Arrange
    const input = { email: "not-an-email" };

    // Act
    const result = googleUserInfoResponseSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(false);
  });
});

describe("refreshResponseSchema", () => {
  it("parses valid refresh response", () => {
    // Arrange
    const input = { access_token: "b", expires_in: 1800 };

    // Act & Assert
    expect(refreshResponseSchema.parse(input)).toEqual(input);
  });

  it("fails when missing expires_in", () => {
    // Arrange
    const input = { access_token: "b" } as unknown;

    // Act
    const result = refreshResponseSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(false);
  });
});

describe("microsoftToDoTaskSchema", () => {
  it("defaults nullish or blank titles to (Untitled)", () => {
    // Arrange / Act / Assert — Graph may send JSON null titles
    expect(
      microsoftToDoTaskSchema.parse(
        JSON.parse('{"id":"t1","title":null,"status":"notStarted"}') as unknown,
      ),
    ).toEqual({
      id: "t1",
      title: "(Untitled)",
      status: "notStarted",
    });
    expect(
      microsoftToDoTaskSchema.parse({ id: "t2", title: undefined, status: "inProgress" }),
    ).toEqual({
      id: "t2",
      title: "(Untitled)",
      status: "inProgress",
    });
    expect(microsoftToDoTaskSchema.parse({ id: "t3", title: "  ", status: "inProgress" })).toEqual({
      id: "t3",
      title: "(Untitled)",
      status: "inProgress",
    });
  });

  it("treats unknown status as notStarted", () => {
    // Arrange
    const input = { id: "t3", title: "Odd", status: "mystery" };

    // Act
    const parsed = microsoftToDoTaskSchema.parse(input);

    // Assert
    expect(parsed.status).toBe("notStarted");
    expect(parsed.title).toBe("Odd");
  });
});
