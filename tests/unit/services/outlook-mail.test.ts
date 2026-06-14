import { describe, it, expect, beforeEach, vi } from "vitest";
import type { RequestUrlResponse } from "obsidian";
import { requestUrl } from "obsidian";
import {
  fetchFlaggedMessages,
  updateOutlookMessageFlag,
  GraphAuthorizationError,
} from "@/services/outlook-mail";

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

const graphResponse = (status: number, text: string): RequestUrlResponse => ({
  status,
  text,
  headers: {},
  arrayBuffer: new ArrayBuffer(0),
  json: safeJson(text),
});

describe("outlook-mail", () => {
  beforeEach(() => {
    vi.mocked(requestUrl).mockReset();
  });

  it("fetchFlaggedMessages returns messages from a single page", async () => {
    // Arrange
    vi.mocked(requestUrl).mockResolvedValueOnce(
      graphResponse(200, JSON.stringify({ value: [{ id: "a1", subject: "Hi" }] })),
    );

    // Act
    const result = await fetchFlaggedMessages("token");

    // Assert
    expect(result).toEqual([{ id: "a1", subject: "Hi" }]);
    expect(requestUrl).toHaveBeenCalledTimes(1);
    const firstCall = vi.mocked(requestUrl).mock.calls[0]?.[0];
    expect(firstCall).toMatchObject({
      method: "GET",
      headers: { Authorization: "Bearer token" },
    });
    expect(
      typeof firstCall === "object" &&
        firstCall !== null &&
        "url" in firstCall &&
        typeof firstCall.url === "string" &&
        firstCall.url.includes("$filter"),
    ).toBe(true);
  });

  it("fetchFlaggedMessages follows @odata.nextLink", async () => {
    // Arrange
    vi.mocked(requestUrl)
      .mockResolvedValueOnce(
        graphResponse(
          200,
          JSON.stringify({
            value: [{ id: "1" }],
            "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/messages?$skip=1",
          }),
        ),
      )
      .mockResolvedValueOnce(graphResponse(200, JSON.stringify({ value: [{ id: "2" }] })));

    // Act
    const result = await fetchFlaggedMessages("t");

    // Assert
    expect(result.map((message) => message.id)).toEqual(["1", "2"]);
    expect(requestUrl).toHaveBeenCalledTimes(2);
  });

  it("fetchFlaggedMessages throws GraphAuthorizationError when Graph returns 401", async () => {
    // Arrange
    vi.mocked(requestUrl).mockResolvedValueOnce(graphResponse(401, "Unauthorized"));

    // Act & Assert
    await expect(fetchFlaggedMessages("bad")).rejects.toBeInstanceOf(GraphAuthorizationError);
  });

  it("fetchFlaggedMessages throws GraphAuthorizationError when Graph returns 403", async () => {
    // Arrange
    vi.mocked(requestUrl).mockResolvedValueOnce(graphResponse(403, "Forbidden"));

    // Act & Assert
    await expect(fetchFlaggedMessages("bad")).rejects.toBeInstanceOf(GraphAuthorizationError);
  });

  it("fetchFlaggedMessages throws generic error for other non-2xx statuses", async () => {
    // Arrange
    vi.mocked(requestUrl).mockResolvedValueOnce(graphResponse(500, "Server error"));

    // Act & Assert
    await expect(fetchFlaggedMessages("bad")).rejects.toThrow(
      "Microsoft Graph list messages failed: 500 Server error",
    );
  });

  it("updateOutlookMessageFlag PATCHes complete flag when completed is true", async () => {
    // Arrange
    vi.mocked(requestUrl).mockResolvedValueOnce(graphResponse(204, ""));

    // Act
    await expect(updateOutlookMessageFlag("tok", "mid-1", true)).resolves.toBeUndefined();

    // Assert
    expect(requestUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "PATCH",
        url: "https://graph.microsoft.com/v1.0/me/messages/mid-1",
        body: JSON.stringify({ flag: { flagStatus: "complete" } }),
      }),
    );
  });

  it("updateOutlookMessageFlag PATCHes flagged when completed is false", async () => {
    // Arrange
    vi.mocked(requestUrl).mockResolvedValueOnce(graphResponse(200, "{}"));

    // Act
    await updateOutlookMessageFlag("t", "id-2", false);

    // Assert
    expect(requestUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        body: JSON.stringify({ flag: { flagStatus: "flagged" } }),
      }),
    );
  });

  it("updateOutlookMessageFlag encodes message id in the URL", async () => {
    // Arrange
    vi.mocked(requestUrl).mockResolvedValueOnce(graphResponse(204, ""));

    // Act
    await updateOutlookMessageFlag("t", "a/b", true);

    // Assert
    expect(requestUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://graph.microsoft.com/v1.0/me/messages/a%2Fb",
      }),
    );
  });

  it("updateOutlookMessageFlag throws GraphAuthorizationError on 401", async () => {
    // Arrange
    vi.mocked(requestUrl).mockResolvedValueOnce(graphResponse(401, "Unauthorized"));

    // Act & Assert
    await expect(updateOutlookMessageFlag("t", "id", false)).rejects.toBeInstanceOf(
      GraphAuthorizationError,
    );
  });

  it("updateOutlookMessageFlag throws on other non-2xx response", async () => {
    // Arrange
    vi.mocked(requestUrl).mockResolvedValueOnce(graphResponse(400, "Bad"));

    // Act & Assert
    await expect(updateOutlookMessageFlag("t", "id", false)).rejects.toThrow(
      "Microsoft Graph PATCH message failed: 400 Bad",
    );
  });
});
