import { describe, it, expect } from "vitest";
import {
  googleOAuthTokenResponseSchema,
  googleUserInfoResponseSchema,
  refreshResponseSchema,
} from "@/services/google/schemas";

describe("googleOAuthTokenResponseSchema", () => {
  it("parses valid token response", () => {
    const input = { access_token: "a", refresh_token: "r", expires_in: 3600 };
    expect(googleOAuthTokenResponseSchema.parse(input)).toEqual(input);
  });

  it("fails for missing fields", () => {
    const input = { access_token: "a" } as unknown;
    const result = googleOAuthTokenResponseSchema.safeParse(input);
    expect(result.success).toBe(false);
  });
});

describe("googleUserInfoResponseSchema", () => {
  it("parses valid user info", () => {
    const input = { sub: "123", email: "user@example.com" };
    expect(googleUserInfoResponseSchema.parse(input)).toEqual(input);
  });

  it("rejects invalid email", () => {
    const input = { sub: "123", email: "not-an-email" };
    const result = googleUserInfoResponseSchema.safeParse(input);
    expect(result.success).toBe(false);
  });
});

describe("refreshResponseSchema", () => {
  it("parses valid refresh response", () => {
    const input = { access_token: "b", expires_in: 1800 };
    expect(refreshResponseSchema.parse(input)).toEqual(input);
  });

  it("fails when missing expires_in", () => {
    const input = { access_token: "b" } as unknown;
    const result = refreshResponseSchema.safeParse(input);
    expect(result.success).toBe(false);
  });
});
