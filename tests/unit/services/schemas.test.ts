import { describe, it, expect } from "vitest";
import { googleOAuthTokenResponseSchema } from "@/services/schemas";
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
