import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { authenticate, type AuthOptions } from "@/auth/google";
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

describe("authenticate", () => {
  let mockServer: MockServer;
  let mockRequest: MockRequest;
  let mockResponse: MockResponse;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetAllMocks();

    // Mock window.open
    Object.defineProperty(globalThis, "window", {
      value: { open: vi.fn() },
      writable: true,
    });

    // Setup fetch mock
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock;

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

      // Mock the token exchange fetch request
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => mockTokenResponse,
      });

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
      expect(mockResponse.end).toHaveBeenCalledWith(
        "Authentication successful! Please return to the console.",
      );
    });
  });

  describe("error handling", () => {
    it("should reject when authorization is denied", async () => {
      // Arrange
      const options: AuthOptions = {
        clientId: "test-client-id",
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

      // Mock the token exchange fetch request
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => mockTokenResponse,
      });

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
        scopes: "scope1",
      };

      const mockAddress: AddressInfo = {
        address: "127.0.0.1",
        family: "IPv4",
        port: 3000,
      };

      mockServer.address.mockReturnValue(mockAddress);

      // Mock the token exchange to fail
      fetchMock.mockResolvedValue({
        ok: false,
        status: 400,
        statusText: "Bad Request",
        text: async () => "invalid_grant",
      });

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

      // Mock the token exchange fetch request
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => mockTokenResponse,
      });

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

      // Mock the token exchange fetch request
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => mockTokenResponse,
      });

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

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("getUserInfo", () => {
    it("returns parsed user info on success", async () => {
      // Arrange
      const token = "fake-token";
      const googleResponse = { email: "john@example.com" };
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => googleResponse,
      });

      // Act
      const actual = GoogleAuth.getUserInfo(token);

      // Assert
      await expect(actual).resolves.toEqual({ email: "john@example.com" });
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
      await expect(GoogleAuth.getUserInfo("bad-token")).rejects.toThrow(
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
      await expect(GoogleAuth.getUserInfo("fake-token")).rejects.toThrow();
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
      const result = await GoogleAuth.refreshAccessToken("id", "refresh");

      // Assert
      expect(result).toEqual({ accessToken: "new-token", expiryDate: expect.any(Number) });
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
      const result = await GoogleAuth.refreshAccessToken("id", "refresh", 2);

      // Assert
      expect(callCount).toBe(2);
      expect(result).toEqual({ accessToken: "ok", expiryDate: expect.any(Number) });
    });

    it("fails after all retries", async () => {
      // Arrange
      globalThis.fetch = vi.fn().mockImplementation(() => {
        throw new TypeError("Network error");
      });

      // Act & Assert
      await expect(GoogleAuth.refreshAccessToken("id", "refresh", 1)).rejects.toThrow(
        "Token refresh failed after retries",
      );
    });
  });
});
