import { requestUrl } from "obsidian";
import { z } from "zod";
import { runtimeSetTimeout } from "@/utils/browser-runtime";

const API_VERSION = "7.1";
const WORK_ITEMS_BATCH_SIZE = 200;
const MAX_THROTTLE_RETRIES = 3;

const azureDevOpsProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
});

const azureDevOpsProjectsPageSchema = z.object({
  value: z.array(azureDevOpsProjectSchema),
  count: z.number().optional(),
});

const wiqlResponseSchema = z.object({
  workItems: z.array(z.object({ id: z.number().int() })).default([]),
});

const workItemFieldSchema = z.object({
  "System.Id": z.number().int(),
  "System.Title": z.string(),
});

const workItemSchema = z.object({
  id: z.number().int(),
  url: z.string(),
  fields: workItemFieldSchema,
});

const workItemsBatchSchema = z.object({
  value: z.array(workItemSchema).default([]),
});

/** Azure DevOps project metadata returned by the projects API. */
export type AzureDevOpsProject = z.infer<typeof azureDevOpsProjectSchema>;

/** Work item fields used for Markdown sync (`id`, `title`, browser `url`). */
export type AzureDevOpsWorkItem = {
  id: number;
  title: string;
  url: string;
};

/** Authentication options for Azure DevOps REST calls. */
export type AzureDevOpsApiAuth =
  | {
      kind: "bearer";
      accessToken: string;
    }
  | {
      kind: "pat";
      personalAccessToken: string;
    };

/** Thrown when Azure DevOps REST returns 401 or 403. */
export class AzureDevOpsAuthorizationError extends Error {
  /** HTTP status code from the failed Azure DevOps response. */
  public readonly status: number;

  public constructor(status: number, message: string) {
    super(message);
    this.name = "AzureDevOpsAuthorizationError";
    this.status = status;
  }
}

const isAuthorizationStatus = (status: number): boolean => status === 401 || status === 403;

const throwResponseError = (operation: string, status: number, responseText: string): never => {
  const message = `Azure DevOps ${operation} failed: ${status} ${responseText}`;
  if (isAuthorizationStatus(status)) {
    throw new AzureDevOpsAuthorizationError(status, message);
  }
  throw new Error(message);
};

const isLikelyHtmlResponse = (responseText: string): boolean =>
  /^\s*<!DOCTYPE html|^\s*<html/i.test(responseText);

const parseJsonResponse = <T>(
  operation: string,
  status: number,
  responseText: string,
  auth: AzureDevOpsApiAuth,
  schema: z.ZodType<T>,
): T => {
  try {
    const json: unknown = JSON.parse(responseText);
    return schema.parse(json);
  } catch (error) {
    if (auth.kind === "pat" && isLikelyHtmlResponse(responseText)) {
      throw new AzureDevOpsAuthorizationError(
        status,
        `Azure DevOps ${operation} returned an HTML sign-in page. The PAT may be invalid/expired, or missing Work Items (Read) scope.`,
      );
    }

    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Azure DevOps ${operation} returned invalid JSON: ${message}`);
  }
};

const parseRetryAfterMs = (headers: Record<string, string> | undefined): number => {
  const retryAfter = headers?.["retry-after"] ?? headers?.["Retry-After"];
  if (retryAfter === undefined) {
    return 1000;
  }
  const seconds = Number.parseInt(retryAfter, 10);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 1000;
};

const createAuthorizationHeader = (auth: AzureDevOpsApiAuth): string => {
  if (auth.kind === "bearer") {
    return `Bearer ${auth.accessToken}`;
  }

  const basicToken = Buffer.from(`:${auth.personalAccessToken}`, "utf8").toString("base64");
  return `Basic ${basicToken}`;
};

const azureDevOpsRequest = async (
  url: string,
  auth: AzureDevOpsApiAuth,
  options: {
    method?: "GET" | "POST";
    body?: string;
    contentType?: string;
  } = {},
): Promise<{ status: number; text: string; headers: Record<string, string> }> => {
  const attempt = async (
    remainingRetries: number,
  ): Promise<{
    status: number;
    text: string;
    headers: Record<string, string>;
  }> => {
    const response = await requestUrl({
      url,
      method: options.method ?? "GET",
      headers: {
        Authorization: createAuthorizationHeader(auth),
        ...(options.contentType === undefined ? {} : { "Content-Type": options.contentType }),
      },
      ...(options.body === undefined ? {} : { body: options.body }),
      throw: false,
    });

    if (response.status === 429 && remainingRetries > 0) {
      const delayMs = parseRetryAfterMs(response.headers);
      await new Promise((resolve) => runtimeSetTimeout(resolve, delayMs));
      return attempt(remainingRetries - 1);
    }

    return { status: response.status, text: response.text, headers: response.headers };
  };

  return attempt(MAX_THROTTLE_RETRIES);
};

const organisationBaseUrl = (organization: string): string =>
  `https://dev.azure.com/${encodeURIComponent(organization)}`;

/**
 * Fetches projects visible to the connected user within an organisation.
 *
 * @param accessToken - Valid Azure DevOps OAuth access token
 * @param organization - Organisation URL segment (`https://dev.azure.com/{organization}`)
 */
export const fetchProjects = async (
  auth: AzureDevOpsApiAuth,
  organization: string,
): Promise<readonly AzureDevOpsProject[]> => {
  const url = `${organisationBaseUrl(organization)}/_apis/projects?api-version=${API_VERSION}`;
  const { status, text } = await azureDevOpsRequest(url, auth);

  if (status < 200 || status >= 300) {
    throwResponseError("list projects", status, text);
  }

  const page = parseJsonResponse(
    "list projects",
    status,
    text,
    auth,
    azureDevOpsProjectsPageSchema,
  );
  return page.value;
};

const ASSIGNED_WORK_ITEMS_WIQL = `
SELECT [System.Id]
FROM WorkItems
WHERE [System.AssignedTo] = @Me
  AND [System.State] <> 'Closed'
  AND [System.State] <> 'Done'
  AND [System.State] <> 'Removed'
ORDER BY [System.ChangedDate] DESC
`.trim();

const queryAssignedWorkItemIds = async (
  auth: AzureDevOpsApiAuth,
  organization: string,
  projectName: string,
): Promise<readonly number[]> => {
  const url = `${organisationBaseUrl(organization)}/${encodeURIComponent(projectName)}/_apis/wit/wiql?api-version=${API_VERSION}`;
  const { status, text } = await azureDevOpsRequest(url, auth, {
    method: "POST",
    contentType: "application/json",
    body: JSON.stringify({ query: ASSIGNED_WORK_ITEMS_WIQL }),
  });

  if (status < 200 || status >= 300) {
    throwResponseError("run WIQL", status, text);
  }

  const parsed = parseJsonResponse("run WIQL", status, text, auth, wiqlResponseSchema);
  return parsed.workItems.map((item) => item.id);
};

const chunkIds = (ids: readonly number[], chunkSize: number): readonly (readonly number[])[] => {
  const chunks: number[][] = [];
  for (let index = 0; index < ids.length; index += chunkSize) {
    chunks.push(ids.slice(index, index + chunkSize));
  }
  return chunks;
};

const fetchWorkItemDetailsChunk = async (
  auth: AzureDevOpsApiAuth,
  organization: string,
  ids: readonly number[],
): Promise<readonly AzureDevOpsWorkItem[]> => {
  if (ids.length === 0) {
    return [];
  }

  const fields = encodeURIComponent("System.Id,System.Title");
  const idList = ids.join(",");
  const url = `${organisationBaseUrl(organization)}/_apis/wit/workitems?ids=${idList}&fields=${fields}&api-version=${API_VERSION}`;
  const { status, text } = await azureDevOpsRequest(url, auth);

  if (status < 200 || status >= 300) {
    throwResponseError("fetch work items", status, text);
  }

  const batch = parseJsonResponse("fetch work items", status, text, auth, workItemsBatchSchema);
  return batch.value.map((item) => ({
    id: item.fields["System.Id"],
    title: item.fields["System.Title"],
    url: item.url,
  }));
};

/**
 * Fetches work items assigned to the connected user in the selected project.
 * WIQL returns IDs only; details are fetched in chunks (max 200 IDs per request).
 * Any detail fetch failure aborts the sync to avoid partial reconcile/deletion side effects.
 *
 * @param accessToken - Valid Azure DevOps OAuth access token
 * @param organization - Organisation URL segment
 * @param projectName - Selected project name within the organisation
 */
export const fetchAssignedWorkItems = async (
  auth: AzureDevOpsApiAuth,
  organization: string,
  projectName: string,
): Promise<readonly AzureDevOpsWorkItem[]> => {
  const ids = await queryAssignedWorkItemIds(auth, organization, projectName);
  if (ids.length === 0) {
    return [];
  }

  const chunks = chunkIds(ids, WORK_ITEMS_BATCH_SIZE);
  const results: AzureDevOpsWorkItem[] = [];

  for (const chunk of chunks) {
    try {
      const items = await fetchWorkItemDetailsChunk(auth, organization, chunk);
      results.push(...items);
    } catch (error) {
      console.warn(
        `Azure DevOps work item detail fetch failed for chunk [${chunk.join(",")}]. Aborting sync to avoid partial results:`,
        error,
      );
      throw error;
    }
  }

  return results;
};
