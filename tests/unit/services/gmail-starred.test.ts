import { describe, it, expect, beforeEach, vi } from "vitest";
import type { RequestUrlResponse } from "obsidian";
import { requestUrl } from "obsidian";
import {
  fetchStarredMessages,
  updateGmailMessageStarred,
  GmailAuthorizationError,
  GmailRateLimitError,
  GMAIL_STARRED_CANDIDATE_LIMIT,
  GMAIL_STARRED_MAX_MESSAGES,
} from "@/services/gmail-starred";

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

const gmailResponse = (status: number, text: string): RequestUrlResponse => ({
  status,
  text,
  headers: {},
  arrayBuffer: new ArrayBuffer(0),
  json: safeJson(text),
});

const metadataBody = (id: string, internalDate: string, subject: string, from: string): string =>
  JSON.stringify({
    id,
    threadId: `thread-${id}`,
    internalDate,
    payload: {
      headers: [
        { name: "Subject", value: subject },
        { name: "From", value: from },
      ],
    },
  });

describe("gmail-starred service", () => {
  beforeEach(() => {
    vi.mocked(requestUrl).mockReset();
  });

  it("fetchStarredMessages metadata-gets only listed candidates and sorts by internalDate", async () => {
    // Arrange
    vi.mocked(requestUrl).mockResolvedValueOnce(
      gmailResponse(
        200,
        JSON.stringify({
          messages: [
            { id: "older", threadId: "t-older" },
            { id: "newer", threadId: "t-newer" },
          ],
        }),
      ),
    );
    vi.mocked(requestUrl)
      .mockResolvedValueOnce(
        gmailResponse(200, metadataBody("older", "100", "Old", "a@example.com")),
      )
      .mockResolvedValueOnce(
        gmailResponse(200, metadataBody("newer", "200", "New", "b@example.com")),
      );

    // Act
    const result = await fetchStarredMessages("token");

    // Assert
    expect(result.truncated).toBe(false);
    expect(result.messages.map((message) => message.id)).toEqual(["newer", "older"]);
    expect(requestUrl).toHaveBeenCalledTimes(3);
  });

  it("fetchStarredMessages respects a custom maxMessages limit", async () => {
    vi.mocked(requestUrl).mockResolvedValueOnce(
      gmailResponse(
        200,
        JSON.stringify({
          messages: [
            { id: "older", threadId: "t-older" },
            { id: "newer", threadId: "t-newer" },
          ],
        }),
      ),
    );
    vi.mocked(requestUrl)
      .mockResolvedValueOnce(
        gmailResponse(200, metadataBody("older", "100", "Old", "a@example.com")),
      )
      .mockResolvedValueOnce(
        gmailResponse(200, metadataBody("newer", "200", "New", "b@example.com")),
      );

    const result = await fetchStarredMessages("token", 1);

    expect(result.messages.map((message) => message.id)).toEqual(["newer"]);
    expect(result.truncated).toBe(true);
  });

  it("fetchStarredMessages caps metadata fetches at 2x maxMessages", async () => {
    const firstPageIds = Array.from({ length: 100 }, (_, index) => ({
      id: `m-${index}`,
      threadId: `t-${index}`,
    }));

    vi.mocked(requestUrl).mockResolvedValueOnce(
      gmailResponse(200, JSON.stringify({ messages: firstPageIds, nextPageToken: "page-2" })),
    );

    for (let index = 0; index < 20; index += 1) {
      vi.mocked(requestUrl).mockResolvedValueOnce(
        gmailResponse(
          200,
          metadataBody(
            `m-${index}`,
            String(1000 - index),
            `Subject ${index}`,
            "sender@example.com",
          ),
        ),
      );
    }

    const result = await fetchStarredMessages("token", 10);

    expect(result.messages).toHaveLength(10);
    expect(result.truncated).toBe(true);
    expect(requestUrl).toHaveBeenCalledTimes(21);
  });

  it("fetchStarredMessages paginates until candidate limit and marks truncated", async () => {
    // Arrange
    const firstPageIds = Array.from({ length: 100 }, (_, index) => ({
      id: `m-${index}`,
      threadId: `t-${index}`,
    }));
    const secondPageIds = Array.from({ length: 100 }, (_, index) => ({
      id: `m-${index + 100}`,
      threadId: `t-${index + 100}`,
    }));

    vi.mocked(requestUrl)
      .mockResolvedValueOnce(
        gmailResponse(200, JSON.stringify({ messages: firstPageIds, nextPageToken: "page-2" })),
      )
      .mockResolvedValueOnce(
        gmailResponse(200, JSON.stringify({ messages: secondPageIds, nextPageToken: "page-3" })),
      );

    for (let index = 0; index < GMAIL_STARRED_CANDIDATE_LIMIT; index += 1) {
      vi.mocked(requestUrl).mockResolvedValueOnce(
        gmailResponse(
          200,
          metadataBody(
            `m-${index}`,
            String(1000 - index),
            `Subject ${index}`,
            "sender@example.com",
          ),
        ),
      );
    }

    // Act
    const result = await fetchStarredMessages("token");

    // Assert
    expect(result.truncated).toBe(true);
    expect(result.messages).toHaveLength(GMAIL_STARRED_MAX_MESSAGES);
    expect(
      vi.mocked(requestUrl).mock.calls.filter((call) => {
        const options = call[0];
        return (
          typeof options === "object" &&
          options !== null &&
          "url" in options &&
          typeof options.url === "string" &&
          options.url.includes("/messages?")
        );
      }),
    ).toHaveLength(2);
    expect(requestUrl).toHaveBeenCalledTimes(2 + GMAIL_STARRED_CANDIDATE_LIMIT);
  });

  it("fetchStarredMessages throws GmailAuthorizationError on 401", async () => {
    // Arrange
    vi.mocked(requestUrl).mockResolvedValueOnce(gmailResponse(401, "Unauthorized"));

    // Act & Assert
    await expect(fetchStarredMessages("bad")).rejects.toBeInstanceOf(GmailAuthorizationError);
  });

  it("fetchStarredMessages throws GmailRateLimitError on 429", async () => {
    // Arrange
    vi.mocked(requestUrl).mockResolvedValueOnce(gmailResponse(429, "Too Many Requests"));

    // Act & Assert
    await expect(fetchStarredMessages("bad")).rejects.toBeInstanceOf(GmailRateLimitError);
  });

  it("fetchStarredMessages throws generic error for other non-2xx statuses", async () => {
    // Arrange
    vi.mocked(requestUrl).mockResolvedValueOnce(gmailResponse(500, "Server error"));

    // Act & Assert
    await expect(fetchStarredMessages("bad")).rejects.toThrow("Gmail list messages failed: 500");
  });

  it("updateGmailMessageStarred removes STARRED when starred is false", async () => {
    // Arrange
    vi.mocked(requestUrl).mockResolvedValueOnce(gmailResponse(200, "{}"));

    // Act
    await updateGmailMessageStarred("tok", "mid-1", false);

    // Assert
    expect(requestUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        url: "https://gmail.googleapis.com/gmail/v1/users/me/messages/mid-1/modify",
        body: JSON.stringify({ removeLabelIds: ["STARRED"] }),
      }),
    );
  });

  it("updateGmailMessageStarred adds STARRED when starred is true", async () => {
    // Arrange
    vi.mocked(requestUrl).mockResolvedValueOnce(gmailResponse(200, "{}"));

    // Act
    await updateGmailMessageStarred("t", "id-2", true);

    // Assert
    expect(requestUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        body: JSON.stringify({ addLabelIds: ["STARRED"] }),
      }),
    );
  });

  it("updateGmailMessageStarred throws GmailAuthorizationError on 403", async () => {
    // Arrange
    vi.mocked(requestUrl).mockResolvedValueOnce(gmailResponse(403, "Forbidden"));

    // Act & Assert
    await expect(updateGmailMessageStarred("t", "id", false)).rejects.toBeInstanceOf(
      GmailAuthorizationError,
    );
  });
});
