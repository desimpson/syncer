import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { RequestUrlResponse } from "obsidian";
import { requestUrl } from "obsidian";
import { authenticate, getUserInfo, refreshAccessToken } from "@/auth/microsoft";
import { InvalidGrantError } from "@/auth";

vi.mock("node:http");

type MockRequest = {
  url?: string;
};

type MockResponse = {
  statusCode: number;
  end: ReturnType<typeof vi.fn>;
};

type MockServer = {
  listen: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  address: ReturnType<typeof vi.fn>;
  callback?: (request: MockRequest, response: MockResponse) => void;
};

const createMockAddress = (port: number): AddressInfo => ({
  address: "127.0.0.1",
  family: "IPv4",
  port,
});

const safeJson = (text: string): unknown => {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
};

const requestUrlResponse = (status: number, text: string): RequestUrlResponse => ({
  status,
  text,
  headers: {},
  arrayBuffer: new ArrayBuffer(0),
  json: safeJson(text),
});

describe("microsoft auth integration", () => {
  let mockServer: MockServer;
  let mockResponse: MockResponse;
  let request: MockRequest;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.useRealTimers();

    Object.defineProperty(globalThis, "window", {
      value: { open: vi.fn() },
      writable: true,
    });

    request = { url: "/" };
    mockResponse = {
      statusCode: 200,
      end: vi.fn(),
    };

    mockServer = {
      listen: vi.fn(),
      close: vi.fn(),
      address: vi.fn(),
    };

    (createServer as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (callback: (request_: MockRequest, response: MockResponse) => void) => {
        mockServer.callback = callback;
        return mockServer;
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  describe("authenticate", () => {
    it("completes OAuth flow and exchanges code for tokens", async () => {
      // Arrange
      mockServer.address.mockReturnValue(createMockAddress(4312));
      mockServer.listen.mockImplementation((_port: number, callback: () => void) => callback());
      vi.mocked(requestUrl).mockResolvedValue(
        requestUrlResponse(
          200,
          JSON.stringify({
            access_token: "access-token",
            refresh_token: "refresh-token",
            expires_in: 3600,
            scope: "openid profile",
          }),
        ),
      );

      // Act
      const authPromise = authenticate({ clientId: "client-id", tenantSegment: "organizations" });
      const authUrl = vi.mocked(window.open).mock.calls[0]?.[0];
      expect(authUrl).toBeDefined();
      const state = new URL(String(authUrl), "http://localhost").searchParams.get("state");
      request.url = `/?code=auth-code&state=${state ?? ""}`;
      mockServer.callback?.(request, mockResponse);
      const result = await authPromise;

      // Assert
      expect(result).toEqual({
        accessToken: "access-token",
        refreshToken: "refresh-token",
        expiryDate: expect.any(Number),
        scope: "openid profile",
        tenantSegment: "organizations",
      });
      expect(mockResponse.end).toHaveBeenCalledWith(
        "Authentication successful. You can close this tab and return to Obsidian.",
      );
      const openUrl = String(authUrl);
      expect(openUrl).toContain("client_id=client-id");
      expect(openUrl).toContain("response_type=code");
      expect(openUrl).toContain("code_challenge=");
      expect(openUrl).toContain("state=");
      expect(openUrl).toContain("prompt=consent");
      expect(openUrl).toContain("login.microsoftonline.com/organizations/");
    });

    it("rejects when callback state does not match", async () => {
      // Arrange
      mockServer.address.mockReturnValue(createMockAddress(4313));
      mockServer.listen.mockImplementation((_port: number, callback: () => void) => callback());

      // Act
      const authPromise = authenticate({ clientId: "client-id", tenantSegment: "common" });
      request.url = "/?code=auth-code&state=wrong-state";
      mockServer.callback?.(request, mockResponse);

      // Assert
      await expect(authPromise).rejects.toThrow("Invalid OAuth state.");
      expect(mockResponse.end).toHaveBeenCalledWith("Sign-in could not be completed.");
    });

    it("rejects when callback has no code", async () => {
      // Arrange
      mockServer.address.mockReturnValue(createMockAddress(4314));
      mockServer.listen.mockImplementation((_port: number, callback: () => void) => callback());
      const authUrl = authenticate({ clientId: "client-id", tenantSegment: "common" });
      const opened = vi.mocked(window.open).mock.calls[0]?.[0];
      const state = new URL(String(opened), "http://localhost").searchParams.get("state");

      // Act
      request.url = `/?state=${state ?? ""}`;
      mockServer.callback?.(request, mockResponse);

      // Assert
      await expect(authUrl).rejects.toThrow("Cannot read authentication code.");
      expect(mockResponse.end).toHaveBeenCalledWith("Sign-in could not be completed.");
    });

    it("rejects when token exchange returns non-2xx", async () => {
      // Arrange
      mockServer.address.mockReturnValue(createMockAddress(4315));
      mockServer.listen.mockImplementation((_port: number, callback: () => void) => callback());
      vi.mocked(requestUrl).mockResolvedValue(requestUrlResponse(400, "bad_request"));
      const authPromise = authenticate({ clientId: "client-id", tenantSegment: "common" });
      const opened = vi.mocked(window.open).mock.calls[0]?.[0];
      const state = new URL(String(opened), "http://localhost").searchParams.get("state");

      // Act
      request.url = `/?code=auth-code&state=${state ?? ""}`;
      mockServer.callback?.(request, mockResponse);

      // Assert
      await expect(authPromise).rejects.toThrow("Microsoft token exchange failed: 400 bad_request");
    });

    it("rejects when refresh token is missing in token response", async () => {
      // Arrange
      mockServer.address.mockReturnValue(createMockAddress(4316));
      mockServer.listen.mockImplementation((_port: number, callback: () => void) => callback());
      vi.mocked(requestUrl).mockResolvedValue(
        requestUrlResponse(
          200,
          JSON.stringify({
            access_token: "access-token",
            expires_in: 3600,
          }),
        ),
      );
      const authPromise = authenticate({ clientId: "client-id", tenantSegment: "common" });
      const opened = vi.mocked(window.open).mock.calls[0]?.[0];
      const state = new URL(String(opened), "http://localhost").searchParams.get("state");

      // Act
      request.url = `/?code=auth-code&state=${state ?? ""}`;
      mockServer.callback?.(request, mockResponse);

      // Assert
      await expect(authPromise).rejects.toThrow("No refresh token received from Microsoft");
    });

    it("times out abandoned sign-in and ignores late callback safely", async () => {
      // Arrange
      vi.useFakeTimers();
      mockServer.address.mockReturnValue(createMockAddress(4317));
      mockServer.listen.mockImplementation((_port: number, callback: () => void) => callback());
      const authPromise = authenticate({ clientId: "client-id", tenantSegment: "common" });
      const timeoutExpectation = expect(authPromise).rejects.toThrow(
        "Microsoft sign-in timed out. Please try connecting again.",
      );

      // Act
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
      await timeoutExpectation;
      request.url = "/?code=late-code&state=late-state";
      mockServer.callback?.(request, mockResponse);

      // Assert
      expect(mockServer.close).toHaveBeenCalledTimes(1);
    });
  });

  describe("getUserInfo", () => {
    it("returns mail when present and falls back to userPrincipalName", async () => {
      // Arrange
      vi.mocked(requestUrl)
        .mockResolvedValueOnce(
          requestUrlResponse(
            200,
            JSON.stringify({
              displayName: "Ada Lovelace",
              mail: "ada@example.com",
              userPrincipalName: "ada.upn@example.com",
            }),
          ),
        )
        .mockResolvedValueOnce(
          requestUrlResponse(
            200,
            JSON.stringify({
              displayName: "Grace Hopper",
              mail: "",
              userPrincipalName: "grace.upn@example.com",
            }),
          ),
        );

      // Act
      const withMail = await getUserInfo("token-a");
      const withFallback = await getUserInfo("token-b");

      // Assert
      expect(withMail).toEqual({ email: "ada@example.com", displayName: "Ada Lovelace" });
      expect(withFallback).toEqual({ email: "grace.upn@example.com", displayName: "Grace Hopper" });
    });

    it("throws on non-2xx user info response", async () => {
      // Arrange
      vi.mocked(requestUrl).mockResolvedValue(requestUrlResponse(401, "Unauthorized"));

      // Act & Assert
      await expect(getUserInfo("bad-token")).rejects.toThrow(
        "Failed to fetch Microsoft user info: 401 Unauthorized",
      );
    });
  });

  describe("refreshAccessToken", () => {
    it("returns refreshed access token and rotated refresh token", async () => {
      // Arrange
      vi.mocked(requestUrl).mockResolvedValue(
        requestUrlResponse(
          200,
          JSON.stringify({
            access_token: "new-access-token",
            expires_in: 3600,
            refresh_token: "new-refresh-token",
          }),
        ),
      );

      // Act
      const result = await refreshAccessToken("client-id", {
        refreshToken: "old-refresh-token",
        tenantSegment: " organizations ",
      });

      // Assert
      expect(result).toEqual({
        accessToken: "new-access-token",
        expiryDate: expect.any(Number),
        refreshToken: "new-refresh-token",
      });
      expect(vi.mocked(requestUrl).mock.calls[0]?.[0]).toMatchObject({
        url: expect.stringContaining("/organizations/oauth2/v2.0/token"),
      });
    });

    it("throws InvalidGrantError for invalid_grant response", async () => {
      // Arrange
      vi.mocked(requestUrl).mockResolvedValue(
        requestUrlResponse(
          400,
          JSON.stringify({
            error: "invalid_grant",
            error_description: "Refresh token expired",
          }),
        ),
      );

      // Act & Assert
      await expect(
        refreshAccessToken("client-id", { refreshToken: "x", tenantSegment: "common" }, 0),
      ).rejects.toBeInstanceOf(InvalidGrantError);
    });

    it("retries after transient failure and succeeds", async () => {
      // Arrange
      vi.useFakeTimers();
      vi.mocked(requestUrl)
        .mockRejectedValueOnce(new Error("temporary network failure"))
        .mockResolvedValueOnce(
          requestUrlResponse(
            200,
            JSON.stringify({
              access_token: "retry-token",
              expires_in: 1200,
            }),
          ),
        );

      // Act
      const promise = refreshAccessToken(
        "client-id",
        { refreshToken: "refresh", tenantSegment: "common" },
        1,
      );
      await vi.advanceTimersByTimeAsync(1000);
      const result = await promise;

      // Assert
      expect(vi.mocked(requestUrl)).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ accessToken: "retry-token", expiryDate: expect.any(Number) });
    });

    it("fails refresh request when token endpoint times out", async () => {
      // Arrange
      vi.useFakeTimers();
      const neverResolvingRequest = new Promise<never>(() => undefined) as unknown as ReturnType<
        typeof requestUrl
      >;
      vi.mocked(requestUrl).mockReturnValue(neverResolvingRequest);

      // Act
      const promise = refreshAccessToken(
        "client-id",
        { refreshToken: "refresh", tenantSegment: "common" },
        0,
      );
      const timeoutExpectation = expect(promise).rejects.toThrow(
        "Microsoft token refresh failed after retries",
      );
      await vi.advanceTimersByTimeAsync(10_000);

      // Assert
      await timeoutExpectation;
    });
  });
});
