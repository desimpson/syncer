import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { RequestUrlParam, RequestUrlResponse } from "obsidian";
import { requestUrl } from "obsidian";
import { authenticate, type AuthOptions, InvalidGrantError } from "@/auth/google";
import { GoogleAuth } from "@/auth";

// Mock dependencies
vi.mock("node:http");

type MockServer = {
  listen: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  address: ReturnType<typeof vi.fn>;
  callback?: (request: MockRequest, response: MockResponse) => void;
};

type MockRequest = {
  url: string;
  headers: {
    host?: string;
  };
};

type MockResponse = {
  end: ReturnType<typeof vi.fn>;
};

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

const isRequestUrlParameter = (value: string | RequestUrlParam): value is RequestUrlParam =>
  typeof value === "object" && value !== null;

const formBodyFromRequestUrlCall = (
  call: readonly [string | RequestUrlParam, ...unknown[]] | undefined,
): string | undefined => {
  const parameters = call?.[0];
  if (
    parameters === undefined ||
    !isRequestUrlParameter(parameters) ||
    typeof parameters.body !== "string"
  ) {
    return undefined;
  }
  return parameters.body;
};

describe("authenticate", () => {
  let mockServer: MockServer;
  let mockRequest: MockRequest;
  let mockResponse: MockResponse;

  beforeEach(() => {
    vi.resetAllMocks();

    // Mock window.open
    Object.defineProperty(globalThis, "window", {
      value: { open: vi.fn() },
      writable: true,
    });

    // Mock response object
    mockResponse = {
      end: vi.fn(),
    };

    // Mock request object
    mockRequest = {
      url: "/",
      headers: {
        host: "localhost:3000",
      },
    };

    // Mock server
    mockServer = {
      listen: vi.fn(),
      close: vi.fn(),
      address: vi.fn(),
    };

    (createServer as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (callback: (request: MockRequest, response: MockResponse) => void) => {
        mockServer.callback = callback;
        return mockServer;
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("successful authentication", () => {
    it("should authenticate successfully with valid auth code", async () => {
      // Arrange
      const options: AuthOptions = {
        clientId: "test-client-id",
        clientSecret: "test-client-secret",
        scopes: "scope1 scope2",
      };

      const mockTokenResponse = {
        access_token: "access-token",
        refresh_token: "refresh-token",
        expires_in: 3600,
        scope: "scope1 scope2",
        token_type: "Bearer",
      };

      const mockAddress: AddressInfo = {
        address: "127.0.0.1",
        family: "IPv4",
        port: 3000,
      };

      mockServer.address.mockReturnValue(mockAddress);

      vi.mocked(requestUrl).mockResolvedValue(
        requestUrlResponse(200, JSON.stringify(mockTokenResponse)),
      );

      // Set up server to call the callback immediately with success
      mockServer.listen.mockImplementation((_port: number, callback: () => void) => {
        callback();
        // Simulate successful auth request
        mockRequest.url = "/?code=auth-code-123";
        setTimeout(() => {
          mockServer.callback?.(mockRequest, mockResponse);
        }, 0);
      });

      mockServer.close.mockImplementation((callback?: () => void) => {
        callback?.();
      });

      // Act
      const result = await authenticate(options);

      // Assert
      expect(result).toEqual({
        accessToken: "access-token",
        refreshToken: "refresh-token",
        expiryDate: expect.any(Number),
        scope: "scope1 scope2",
      });

      expect(window.open).toHaveBeenCalledWith(
        expect.stringContaining("https://accounts.google.com/o/oauth2/auth"),
        "_blank",
      );
      const authUrl = vi.mocked(window.open).mock.calls[0]?.[0] as string;
      expect(authUrl).toContain("code_challenge=");
      expect(authUrl).toContain("code_challenge_method=S256");
      expect(mockResponse.end).toHaveBeenCalledWith(
        "Authentication successful! Please return to the console.",
      );
    });
    it("sends client_secret and code_verifier in token exchange POST body", async () => {
      // Arrange
      const options: AuthOptions = {
        clientId: "test-client-id",
        clientSecret: "test-client-secret",
        scopes: "scope1",
      };

      const mockTokenResponse = {
        access_token: "access-token",
        refresh_token: "refresh-token",
        expires_in: 3600,
        scope: "scope1",
        token_type: "Bearer",
      };

      const mockAddress: AddressInfo = {
        address: "127.0.0.1",
        family: "IPv4",
        port: 3000,
      };

      mockServer.address.mockReturnValue(mockAddress);

      vi.mocked(requestUrl).mockResolvedValue(
        requestUrlResponse(200, JSON.stringify(mockTokenResponse)),
      );

      mockServer.listen.mockImplementation((_port: number, callback: () => void) => {
        callback();
        mockRequest.url = "/?code=auth-code-123";
        setTimeout(() => {
          mockServer.callback?.(mockRequest, mockResponse);
        }, 0);
      });

      mockServer.close.mockImplementation((callback?: () => void) => {
        callback?.();
      });

      // Act
      await authenticate(options);

      // Assert
      expect(requestUrl).toHaveBeenCalledWith(
        expect.objectContaining({
          url: "https://oauth2.googleapis.com/token",
          method: "POST",
        }),
      );
      const tokenCall = vi.mocked(requestUrl).mock.calls.find((call) => {
        const parameters = call[0];
        return (
          isRequestUrlParameter(parameters) &&
          parameters.url === "https://oauth2.googleapis.com/token"
        );
      });
      const formBody = formBodyFromRequestUrlCall(tokenCall);
      expect(formBody).toBeDefined();
      const formParameters = new URLSearchParams(formBody);
      expect(formParameters.get("client_secret")).toBe("test-client-secret");
      expect(formParameters.get("code_verifier")).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(formParameters.get("grant_type")).toBe("authorization_code");
    });
  });

  describe("error handling", () => {
    it("should reject when authorization is denied", async () => {
      // Arrange
      const options: AuthOptions = {
        clientId: "test-client-id",
        clientSecret: "test-client-secret",
        scopes: "scope1",
      };

      const mockAddress: AddressInfo = {
        address: "127.0.0.1",
        family: "IPv4",
        port: 3000,
      };

      mockServer.address.mockReturnValue(mockAddress);

      mockServer.listen.mockImplementation((_port: number, callback: () => void) => {
        callback();
        // Simulate error response
        mockRequest.url = "/?error=access_denied";
        setTimeout(() => mockServer.callback?.(mockRequest, mockResponse), 0);
      });

      mockServer.close.mockImplementation((callback?: () => void) => {
        callback?.();
      });

      // Act & Assert
      await expect(authenticate(options)).rejects.toThrow("access_denied");
      expect(mockResponse.end).toHaveBeenCalledWith("Authorization rejected.");
    });

    it("should reject when no auth code is provided", async () => {
      // Arrange
      const options: AuthOptions = {
        clientId: "test-client-id",
        clientSecret: "test-client-secret",
        scopes: "scope1",
      };

      const mockAddress: AddressInfo = {
        address: "127.0.0.1",
        family: "IPv4",
        port: 3000,
      };

      mockServer.address.mockReturnValue(mockAddress);

      mockServer.listen.mockImplementation((_port: number, callback: () => void) => {
        callback();
        // Simulate request without code
        mockRequest.url = "/";
        setTimeout(() => mockServer.callback?.(mockRequest, mockResponse), 0);
      });

      mockServer.close.mockImplementation((callback?: () => void) => {
        callback?.();
      });

      // Act & Assert
      await expect(authenticate(options)).rejects.toThrow("Cannot read authentication code.");
      expect(mockResponse.end).toHaveBeenCalledWith("No authentication code provided.");
    });

    it("should authenticate successfully even with empty auth code", async () => {
      // Arrange
      const options: AuthOptions = {
        clientId: "test-client-id",
        clientSecret: "test-client-secret",
        scopes: "scope1",
      };

      const mockTokenResponse = {
        access_token: "access-token",
        refresh_token: "refresh-token",
        expires_in: 3600,
        scope: "scope1",
        token_type: "Bearer",
      };

      const mockAddress: AddressInfo = {
        address: "127.0.0.1",
        family: "IPv4",
        port: 3000,
      };

      mockServer.address.mockReturnValue(mockAddress);

      vi.mocked(requestUrl).mockResolvedValue(
        requestUrlResponse(200, JSON.stringify(mockTokenResponse)),
      );

      mockServer.listen.mockImplementation((_port: number, callback: () => void) => {
        callback();
        // Simulate request with empty code parameter
        mockRequest.url = "/?code=";
        setTimeout(() => {
          mockServer.callback?.(mockRequest, mockResponse);
        }, 0);
      });

      mockServer.close.mockImplementation((callback?: () => void) => {
        callback?.();
      });

      // Act
      const result = await authenticate(options);

      // Assert
      expect(result).toEqual({
        accessToken: "access-token",
        refreshToken: "refresh-token",
        expiryDate: expect.any(Number),
        scope: "scope1",
      });
      expect(mockResponse.end).toHaveBeenCalledWith(
        "Authentication successful! Please return to the console.",
      );
    });

    it("should reject when token exchange fails", async () => {
      // Arrange
      const options: AuthOptions = {
        clientId: "test-client-id",
        clientSecret: "test-client-secret",
        scopes: "scope1",
      };

      const mockAddress: AddressInfo = {
        address: "127.0.0.1",
        family: "IPv4",
        port: 3000,
      };

      mockServer.address.mockReturnValue(mockAddress);

      vi.mocked(requestUrl).mockResolvedValue(requestUrlResponse(400, "invalid_grant"));

      mockServer.listen.mockImplementation((_port: number, callback: () => void) => {
        callback();
        // Simulate successful auth request
        mockRequest.url = "/?code=auth-code-123";
        setTimeout(() => mockServer.callback?.(mockRequest, mockResponse), 0);
      });

      mockServer.close.mockImplementation((callback?: () => void) => {
        callback?.();
      });

      // Act & Assert
      await expect(authenticate(options)).rejects.toThrow(
        "Token exchange failed: 400 invalid_grant",
      );
    });

    it("should reject when server address is not AddressInfo", async () => {
      // Arrange
      const options: AuthOptions = {
        clientId: "test-client-id",
        clientSecret: "test-client-secret",
        scopes: "scope1",
      };

      mockServer.address.mockReturnValue("string-address");

      mockServer.listen.mockImplementation((_port: number, callback: () => void) => {
        callback();
      });

      // Act & Assert
      await expect(authenticate(options)).rejects.toThrow("Unexpected server address type.");
    });

    it("should handle invalid callback URL", async () => {
      // Arrange
      const options: AuthOptions = {
        clientId: "test-client-id",
        clientSecret: "test-client-secret",
        scopes: "scope1",
      };

      const mockAddress: AddressInfo = {
        address: "127.0.0.1",
        family: "IPv4",
        port: 3000,
      };

      mockServer.address.mockReturnValue(mockAddress);

      mockServer.listen.mockImplementation((_port: number, callback: () => void) => {
        callback();
        // Simulate request to wrong path
        mockRequest.url = "/wrong-path";
        setTimeout(() => mockServer.callback?.(mockRequest, mockResponse), 0);
      });

      mockServer.close.mockImplementation((callback?: () => void) => {
        callback?.();
      });

      // Act
      const authPromise = authenticate(options);

      // Allow the server callback to execute
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Assert
      expect(mockResponse.end).toHaveBeenCalledWith("Invalid callback URL");

      // The promise should still be pending since invalid URL doesn't reject or resolve
      const promiseState = await Promise.race([
        authPromise.then(
          () => "resolved",
          () => "rejected",
        ),
        new Promise((resolve) => setTimeout(() => resolve("pending"), 50)),
      ]);
      expect(promiseState).toBe("pending");
    });
  });

  describe("server configuration", () => {
    it("should start server on port 0 and use assigned port for redirect URI", async () => {
      // Arrange
      const options: AuthOptions = {
        clientId: "test-client-id",
        clientSecret: "test-client-secret",
        scopes: "scope1 scope2",
      };

      const mockTokenResponse = {
        access_token: "access-token",
        refresh_token: "refresh-token",
        expires_in: 3600,
        scope: "scope1 scope2",
        token_type: "Bearer",
      };

      const mockAddress: AddressInfo = {
        address: "127.0.0.1",
        family: "IPv4",
        port: 8080,
      };

      mockServer.address.mockReturnValue(mockAddress);

      vi.mocked(requestUrl).mockResolvedValue(
        requestUrlResponse(200, JSON.stringify(mockTokenResponse)),
      );

      mockServer.listen.mockImplementation((port: number, callback: () => void) => {
        expect(port).toBe(0); // Should listen on port 0 for automatic assignment
        callback();
        mockRequest.url = "/?code=auth-code-123";
        setTimeout(() => {
          mockServer.callback?.(mockRequest, mockResponse);
        }, 0);
      });

      mockServer.close.mockImplementation((callback?: () => void) => {
        callback?.();
      });

      // Act
      await authenticate(options);

      // Assert
      expect(window.open).toHaveBeenCalledWith(
        expect.stringContaining("redirect_uri=http%3A%2F%2Flocalhost%3A8080%2F"),
        "_blank",
      );
    });

    it("should properly parse scopes with multiple values", async () => {
      // Arrange
      const options: AuthOptions = {
        clientId: "test-client-id",
        clientSecret: "test-client-secret",
        scopes: "scope1 scope2 scope3",
      };

      const mockTokenResponse = {
        access_token: "access-token",
        refresh_token: "refresh-token",
        expires_in: 3600,
        scope: "scope1 scope2 scope3",
        token_type: "Bearer",
      };

      const mockAddress: AddressInfo = {
        address: "127.0.0.1",
        family: "IPv4",
        port: 3000,
      };

      mockServer.address.mockReturnValue(mockAddress);

      vi.mocked(requestUrl).mockResolvedValue(
        requestUrlResponse(200, JSON.stringify(mockTokenResponse)),
      );

      mockServer.listen.mockImplementation((_port: number, callback: () => void) => {
        callback();
        mockRequest.url = "/?code=auth-code-123";
        setTimeout(() => {
          mockServer.callback?.(mockRequest, mockResponse);
        }, 0);
      });

      mockServer.close.mockImplementation((callback?: () => void) => {
        callback?.();
      });

      // Act
      await authenticate(options);

      // Assert
      expect(window.open).toHaveBeenCalledWith(
        expect.stringContaining("scope=scope1+scope2+scope3"),
        "_blank",
      );
    });
  });
});

describe("GoogleAuth", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("getUserInfo", () => {
    it("returns parsed user info on success", async () => {
      // Arrange
      const token = "fake-token";
      const googleResponse = { email: "john@example.com" };
      vi.mocked(requestUrl).mockResolvedValue(
        requestUrlResponse(200, JSON.stringify(googleResponse)),
      );

      // Act
      const actual = GoogleAuth.getUserInfo(token);

      // Assert
      await expect(actual).resolves.toEqual({ email: "john@example.com" });
      expect(requestUrl).toHaveBeenCalledWith({
        url: "https://www.googleapis.com/oauth2/v3/userinfo",
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        throw: false,
      });
    });

    it("throws when response not ok", async () => {
      // Arrange
      vi.mocked(requestUrl).mockResolvedValue(requestUrlResponse(401, "Unauthorized"));

      // Act & Assert
      await expect(GoogleAuth.getUserInfo("bad-token")).rejects.toThrow(
        "Failed to fetch user info: 401 Unauthorized",
      );
    });

    it("throws when schema validation fails", async () => {
      // Arrange
      vi.mocked(requestUrl).mockResolvedValue(
        requestUrlResponse(200, JSON.stringify({ foo: "bar" })),
      );

      // Act & Assert
      await expect(GoogleAuth.getUserInfo("fake-token")).rejects.toThrow();
    });
  });

  describe("refreshAccessToken", () => {
    it("returns access token on success", async () => {
      // Arrange
      const fakeResponse = { access_token: "new-token", expires_in: 3600 };
      vi.mocked(requestUrl).mockResolvedValue(
        requestUrlResponse(200, JSON.stringify(fakeResponse)),
      );

      // Act
      const result = await GoogleAuth.refreshAccessToken("id", "secret", "refresh");

      // Assert
      expect(result).toEqual({ accessToken: "new-token", expiryDate: expect.any(Number) });
    });

    it("sends client_secret in refresh POST body", async () => {
      // Arrange
      vi.mocked(requestUrl).mockResolvedValue(
        requestUrlResponse(200, JSON.stringify({ access_token: "new-token", expires_in: 3600 })),
      );

      // Act
      await GoogleAuth.refreshAccessToken("id", "my-secret", "refresh");

      // Assert
      const formBody = formBodyFromRequestUrlCall(vi.mocked(requestUrl).mock.calls[0]);
      expect(formBody).toBeDefined();
      const formParameters = new URLSearchParams(formBody);
      expect(formParameters.get("client_secret")).toBe("my-secret");
      expect(formParameters.get("grant_type")).toBe("refresh_token");
    });

    it("throws InvalidGrantError for invalid_grant response", async () => {
      // Arrange
      vi.mocked(requestUrl).mockResolvedValue(
        requestUrlResponse(
          400,
          JSON.stringify({
            error: "invalid_grant",
            error_description: "Token has been expired or revoked",
          }),
        ),
      );

      // Act & Assert
      await expect(
        GoogleAuth.refreshAccessToken("id", "secret", "refresh", 0),
      ).rejects.toBeInstanceOf(InvalidGrantError);
    });

    it("retries on network failure and succeeds", async () => {
      // Arrange
      vi.mocked(requestUrl)
        .mockRejectedValueOnce(new TypeError("Network error"))
        .mockResolvedValueOnce(
          requestUrlResponse(200, JSON.stringify({ access_token: "ok", expires_in: 100 })),
        );

      // Act
      const result = await GoogleAuth.refreshAccessToken("id", "secret", "refresh", 2);

      // Assert
      expect(vi.mocked(requestUrl)).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ accessToken: "ok", expiryDate: expect.any(Number) });
    });

    it("fails after all retries", async () => {
      // Arrange
      vi.mocked(requestUrl).mockRejectedValue(new TypeError("Network error"));

      // Act & Assert
      await expect(GoogleAuth.refreshAccessToken("id", "secret", "refresh", 1)).rejects.toThrow(
        "Token refresh failed after retries",
      );
    });
  });
});
