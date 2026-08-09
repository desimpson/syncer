import { describe, it, expect, beforeEach, vi } from "vitest";
import type { RequestUrlResponse } from "obsidian";
import { requestUrl } from "obsidian";
import {
  fetchProjects,
  fetchAssignedWorkItems,
  AzureDevOpsAuthorizationError,
} from "@/services/azure-devops";

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

const adoResponse = (status: number, text: string): RequestUrlResponse => ({
  status,
  text,
  headers: {},
  arrayBuffer: new ArrayBuffer(0),
  json: safeJson(text),
});

describe("azure-devops service", () => {
  beforeEach(() => {
    vi.mocked(requestUrl).mockReset();
  });

  it("fetchProjects returns projects from the organisation", async () => {
    // Arrange
    vi.mocked(requestUrl).mockResolvedValueOnce(
      adoResponse(
        200,
        JSON.stringify({
          value: [{ id: "proj-1", name: "Contoso" }],
        }),
      ),
    );

    // Act
    const result = await fetchProjects({ kind: "bearer", accessToken: "token" }, "my-org");

    // Assert
    expect(result).toEqual([{ id: "proj-1", name: "Contoso" }]);
    expect(requestUrl).toHaveBeenCalledTimes(1);
    const firstCall = vi.mocked(requestUrl).mock.calls[0]?.[0];
    expect(
      typeof firstCall === "object" &&
        firstCall !== null &&
        "url" in firstCall &&
        typeof firstCall.url === "string" &&
        firstCall.url.includes("dev.azure.com/my-org/_apis/projects"),
    ).toBe(true);
  });

  it("fetchProjects throws AzureDevOpsAuthorizationError on 401", async () => {
    // Arrange
    vi.mocked(requestUrl).mockResolvedValueOnce(adoResponse(401, "Unauthorized"));

    // Act & Assert
    await expect(
      fetchProjects({ kind: "bearer", accessToken: "bad" }, "my-org"),
    ).rejects.toBeInstanceOf(AzureDevOpsAuthorizationError);
  });

  it("fetchAssignedWorkItems returns empty array when WIQL finds no assignments", async () => {
    // Arrange
    vi.mocked(requestUrl).mockResolvedValueOnce(
      adoResponse(200, JSON.stringify({ workItems: [] })),
    );

    // Act
    const result = await fetchAssignedWorkItems(
      { kind: "bearer", accessToken: "token" },
      "my-org",
      "Contoso",
    );

    // Assert
    expect(result).toEqual([]);
    expect(requestUrl).toHaveBeenCalledTimes(1);
  });

  it("fetchAssignedWorkItems fetches details after WIQL returns IDs", async () => {
    // Arrange
    vi.mocked(requestUrl)
      .mockResolvedValueOnce(
        adoResponse(200, JSON.stringify({ workItems: [{ id: 10 }, { id: 11 }] })),
      )
      .mockResolvedValueOnce(
        adoResponse(
          200,
          JSON.stringify({
            value: [
              {
                id: 10,
                url: "https://dev.azure.com/my-org/Contoso/_workitems/edit/10",
                fields: { "System.Id": 10, "System.Title": "First" },
              },
              {
                id: 11,
                url: "https://dev.azure.com/my-org/Contoso/_workitems/edit/11",
                fields: { "System.Id": 11, "System.Title": "Second" },
              },
            ],
          }),
        ),
      );

    // Act
    const result = await fetchAssignedWorkItems(
      { kind: "bearer", accessToken: "token" },
      "my-org",
      "Contoso",
    );

    // Assert
    expect(result).toEqual([
      {
        id: 10,
        title: "First",
        url: "https://dev.azure.com/my-org/Contoso/_workitems/edit/10",
      },
      {
        id: 11,
        title: "Second",
        url: "https://dev.azure.com/my-org/Contoso/_workitems/edit/11",
      },
    ]);
    expect(requestUrl).toHaveBeenCalledTimes(2);
  });

  it("fetchAssignedWorkItems throws when detail fetch fails", async () => {
    // Arrange
    vi.mocked(requestUrl)
      .mockResolvedValueOnce(
        adoResponse(200, JSON.stringify({ workItems: [{ id: 10 }, { id: 11 }] })),
      )
      .mockResolvedValueOnce(adoResponse(500, "Server error"));

    // Act & Assert
    await expect(
      fetchAssignedWorkItems({ kind: "bearer", accessToken: "token" }, "my-org", "Contoso"),
    ).rejects.toThrow("Azure DevOps fetch work items failed: 500 Server error");
    expect(requestUrl).toHaveBeenCalledTimes(2);
  });

  it("retries on HTTP 429 with Retry-After header", async () => {
    // Arrange
    vi.mocked(requestUrl)
      .mockResolvedValueOnce({
        ...adoResponse(429, "Too many requests"),
        headers: { "retry-after": "0" },
      })
      .mockResolvedValueOnce(
        adoResponse(
          200,
          JSON.stringify({
            value: [{ id: "proj-1", name: "Contoso" }],
          }),
        ),
      );

    // Act
    const result = await fetchProjects({ kind: "bearer", accessToken: "token" }, "my-org");

    // Assert
    expect(result).toEqual([{ id: "proj-1", name: "Contoso" }]);
    expect(requestUrl).toHaveBeenCalledTimes(2);
  });

  it("uses Basic authorization for PAT mode", async () => {
    // Arrange
    vi.mocked(requestUrl).mockResolvedValueOnce(
      adoResponse(
        200,
        JSON.stringify({
          value: [{ id: "proj-1", name: "Contoso" }],
        }),
      ),
    );

    // Act
    await fetchProjects({ kind: "pat", personalAccessToken: "pat-token" }, "my-org");

    // Assert
    const firstCall = vi.mocked(requestUrl).mock.calls[0]?.[0];
    const authorizationHeader =
      typeof firstCall === "object" && firstCall !== null && "headers" in firstCall
        ? firstCall.headers?.["Authorization"]
        : undefined;
    expect(authorizationHeader).toBe(
      `Basic ${Buffer.from(":pat-token", "utf8").toString("base64")}`,
    );
  });

  it("treats HTML sign-in response as PAT authorization failure", async () => {
    // Arrange
    vi.mocked(requestUrl).mockResolvedValueOnce(
      adoResponse(200, "<!DOCTYPE html><html><body>Sign in</body></html>"),
    );

    // Act & Assert
    await expect(
      fetchAssignedWorkItems(
        { kind: "pat", personalAccessToken: "bad-token" },
        "my-org",
        "Contoso",
      ),
    ).rejects.toBeInstanceOf(AzureDevOpsAuthorizationError);
  });
});
