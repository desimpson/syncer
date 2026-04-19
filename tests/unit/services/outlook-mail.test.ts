import { describe, it, expect, beforeEach, vi } from "vitest";
import type { RequestUrlResponse } from "obsidian";
import { requestUrl } from "obsidian";
import { fetchFlaggedMessages, updateOutlookMessageFlag } from "@/services/outlook-mail";

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
    vi.mocked(requestUrl).mockResolvedValueOnce(
      graphResponse(200, JSON.stringify({ value: [{ id: "a1", subject: "Hi" }] })),
    );

    const result = await fetchFlaggedMessages("token");

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

    const result = await fetchFlaggedMessages("t");

    expect(result.map((message) => message.id)).toEqual(["1", "2"]);
    expect(requestUrl).toHaveBeenCalledTimes(2);
  });

  it("fetchFlaggedMessages throws when Graph returns a non-2xx status", async () => {
    vi.mocked(requestUrl).mockResolvedValueOnce(graphResponse(401, "Unauthorized"));
    await expect(fetchFlaggedMessages("bad")).rejects.toThrow(
      "Microsoft Graph list messages failed: 401 Unauthorized",
    );
  });

  it("updateOutlookMessageFlag PATCHes complete flag when completed is true", async () => {
    vi.mocked(requestUrl).mockResolvedValueOnce(graphResponse(204, ""));

    await expect(updateOutlookMessageFlag("tok", "mid-1", true)).resolves.toBeUndefined();

    expect(requestUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "PATCH",
        url: "https://graph.microsoft.com/v1.0/me/messages/mid-1",
        body: JSON.stringify({ flag: { flagStatus: "complete" } }),
      }),
    );
  });

  it("updateOutlookMessageFlag PATCHes flagged when completed is false", async () => {
    vi.mocked(requestUrl).mockResolvedValueOnce(graphResponse(200, "{}"));

    await updateOutlookMessageFlag("t", "id-2", false);

    expect(requestUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        body: JSON.stringify({ flag: { flagStatus: "flagged" } }),
      }),
    );
  });

  it("updateOutlookMessageFlag encodes message id in the URL", async () => {
    vi.mocked(requestUrl).mockResolvedValueOnce(graphResponse(204, ""));

    await updateOutlookMessageFlag("t", "a/b", true);

    expect(requestUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://graph.microsoft.com/v1.0/me/messages/a%2Fb",
      }),
    );
  });

  it("updateOutlookMessageFlag throws on non-2xx response", async () => {
    vi.mocked(requestUrl).mockResolvedValueOnce(graphResponse(400, "Bad"));
    await expect(updateOutlookMessageFlag("t", "id", false)).rejects.toThrow(
      "Microsoft Graph PATCH message failed: 400 Bad",
    );
  });
});
