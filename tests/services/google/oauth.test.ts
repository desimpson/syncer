import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GoogleOAuth2Service } from "@/services";

describe("GoogleOAuth2Service", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("getUserInfo", () => {
    it("returns parsed user info on success", async () => {
      // Arrange
      const token = "fake-token";
      const googleResponse = { sub: "123", email: "john@example.com" };
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => googleResponse,
      });

      // Act
      const actual = GoogleOAuth2Service.getUserInfo(token);

      // Assert
      await expect(actual).resolves.toEqual({ userId: "123", email: "john@example.com" });
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "https://www.googleapis.com/oauth2/v3/userinfo",
        { headers: { Authorization: `Bearer ${token}` } },
      );
    });

    it("throws when response not ok", async () => {
      // Arrange
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
      });

      // Act & Assert
      await expect(GoogleOAuth2Service.getUserInfo("bad-token")).rejects.toThrow(
        "Failed to fetch user info: 401 Unauthorized",
      );
    });

    it("throws when schema validation fails", async () => {
      // Arrange
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ foo: "bar" }),
      });

      // Act & Assert
      await expect(GoogleOAuth2Service.getUserInfo("fake-token")).rejects.toThrow();
    });
  });

  describe("createOAuthUrl", () => {
    it("returns authUrl and codeVerifier", async () => {
      // Arrange
      const scopes = "scope1 scope2";
      const clientId = "client-id";

      // Act
      const result = await GoogleOAuth2Service.createOAuthUrl(clientId, scopes);

      // Assert
      expect(result.codeVerifier).toBeDefined();
      expect(result.authUrl).toContain("https://accounts.google.com/o/oauth2/v2/auth?");
      expect(result.authUrl).toContain(`client_id=${clientId}`);
      expect(result.authUrl).toContain("scope=scope1+scope2");
    });
  });

  describe("exchangeOAuthCode", () => {
    it("returns access token object on success", async () => {
      // Arrange
      const fakeResponse = { access_token: "a", refresh_token: "r", expires_in: 3600 };
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => fakeResponse,
      });

      // Act
      const result = await GoogleOAuth2Service.exchangeOAuthCode(
        "id",
        "secret",
        "code",
        "verifier",
      );

      // Assert
      expect(result).toEqual({
        accessToken: "a",
        refreshToken: "r",
        expiresIn: 3600,
      });
    });

    it("throws on non-ok response", async () => {
      // Arrange
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        statusText: "Bad Request",
      });

      // Act & Assert
      await expect(
        GoogleOAuth2Service.exchangeOAuthCode("id", "secret", "code", "verifier"),
      ).rejects.toThrow("Failed to submit OAuth code: 400 Bad Request");
    });

    it("throws when schema validation fails", async () => {
      // Arrange
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ foo: "bar" }),
      });

      // Act & Assert
      await expect(
        GoogleOAuth2Service.exchangeOAuthCode("id", "secret", "code", "verifier"),
      ).rejects.toThrow();
    });
  });

  describe("refreshAccessToken", () => {
    it("returns access token on success", async () => {
      // Arrange
      const fakeResponse = { access_token: "new-token", expires_in: 3600 };
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => fakeResponse,
      });

      // Act
      const result = await GoogleOAuth2Service.refreshAccessToken("id", "secret", "refresh");

      // Assert
      expect(result).toEqual({ accessToken: "new-token", expiresIn: 3600 });
    });

    it("retries on network failure and succeeds", async () => {
      // Arrange
      let callCount = 0;
      globalThis.fetch = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount < 2) {
          throw new TypeError("Network error");
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({ access_token: "ok", expires_in: 100 }),
        });
      });

      // Act
      const result = await GoogleOAuth2Service.refreshAccessToken("id", "secret", "refresh", 2);

      // Assert
      expect(callCount).toBe(2);
      expect(result).toEqual({ accessToken: "ok", expiresIn: 100 });
    });

    it("fails after all retries", async () => {
      // Arrange
      globalThis.fetch = vi.fn().mockImplementation(() => {
        throw new TypeError("Network error");
      });

      // Act & Assert
      await expect(
        GoogleOAuth2Service.refreshAccessToken("id", "secret", "refresh", 1),
      ).rejects.toThrow("Token refresh failed after retries");
    });
  });
});
