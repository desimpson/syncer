import { z } from "zod";
import { formatPlural } from "@/utils/string-formatters";
import { normaliseHeadingToH2 } from "@/utils/heading-formatters";
import type { Vault } from "obsidian";

const minimumFilePathLength = 1;

/**
 * Minimum sync interval in minutes.
 */
export const minimumSyncIntervalMinutes = 1;

/**
 * Maximum sync interval in minutes.
 */
export const maximumSyncIntervalMinutes = 24 * 60;

const markdownExtensionRegex = /\.md$/;
const h2HeadingRegex = /^##\s.+/;

/**
 * Schema for validating and parsing the plugin configuration settings.
 */
export const pluginSchema = z.object({
  GOOGLE_TASKS_CLIENT_ID: z.string().min(1),
  /** Optional at build time; Outlook connect is disabled when empty. */
  OUTLOOK_CLIENT_ID: z.string().default(""),
  /** Optional at build time; Azure DevOps connect is disabled when empty. */
  AZURE_DEVOPS_CLIENT_ID: z.string().default(""),
});

/**
 * Base schema (sync) for Markdown file path shape/format. Reused across
 * settings parsing and UI field validation. Does NOT check existence.
 */
const markdownFilePathShapeSchema = z
  .string()
  .trim()
  .min(minimumFilePathLength, { message: "File path cannot be empty." })
  .regex(markdownExtensionRegex, { message: 'File must end with ".md".' });

/**
 * Creates a Zod schema for validating Markdown file paths with existence
 * checking using the provided vault. This adds an async refinement on top of
 * the shared shape schema.
 * @param vault - Obsidian `Vault` instance to check file existence
 * @returns Zod schema for Markdown file paths
 */
export const createMarkdownFilePathSchema = (vault: Vault): z.ZodString =>
  markdownFilePathShapeSchema.refine(async (value) => vault.getAbstractFileByPath(value), {
    message: "File does not exist in the vault.",
  }) as unknown as z.ZodString;

/**
 * Schema for validating the sync interval setting.
 */
export const syncIntervalSchema: z.ZodCoercedNumber<unknown> = z.coerce
  .number("Must be a number.")
  .int("Must be a whole number.")
  .min(minimumSyncIntervalMinutes, {
    message: `Must be at least ${formatPlural(minimumSyncIntervalMinutes, "minute")}.`,
  })
  .max(maximumSyncIntervalMinutes, {
    message: `Must be less than or equal to ${formatPlural(maximumSyncIntervalMinutes, "minute")}.`,
  });

/**
 * Schema for Markdown heading that always normalises to H2 ("## ") with text.
 * Accepts flexible input but stores a consistent H2 heading.
 */
export const headingSchema = z
  .string()
  .trim()
  .transform((value) => normaliseHeadingToH2(value))
  .refine((value) => h2HeadingRegex.test(value), {
    message: "Heading must be H2 with text, e.g., '## Tasks'",
  });

/**
 * Schema for Google Tasks integration settings stored inside plugin settings.
 */
export const googleTasksSettingsSchema = z.object({
  userInfo: z.object({
    email: z.email(),
  }),
  credentials: z.object({
    accessToken: z.string(),
    refreshToken: z.string(),
    expiryDate: z.number().int(),
    scope: z.string(),
  }),
  availableLists: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
      }),
    )
    .default([]),
  selectedListIds: z.array(z.string()).default([]),
});

const azureAdTenantGuidRegex =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * Optional directory (tenant) ID when signing in with a work or school account.
 * Empty means any organization (`organizations` authority).
 */
export const microsoftWorkOrSchoolTenantIdSchema = z
  .string()
  .trim()
  .refine((value) => value.length === 0 || azureAdTenantGuidRegex.test(value), {
    message: "Must be empty or a valid directory (tenant) ID (GUID).",
  })
  .default("");

export const microsoftAuthAccountKindSchema = z
  .enum(["personal", "workSchool"])
  .default("personal");

export type MicrosoftAuthAccountKind = z.infer<typeof microsoftAuthAccountKindSchema>;

/**
 * Connected Microsoft Outlook (Graph) account.
 */
export const microsoftOutlookSettingsSchema = z.object({
  userInfo: z.object({
    email: z.email(),
    displayName: z.string().optional(),
  }),
  credentials: z.object({
    accessToken: z.string(),
    refreshToken: z.string(),
    expiryDate: z.number().int(),
    scope: z.string(),
    tenantSegment: z.string().min(1),
  }),
});

/** Pre-connect Azure DevOps account kind from settings UI. */
export const azureDevOpsAuthAccountKindSchema = z
  .enum(["personal", "workSchool"])
  .default("workSchool");

export type AzureDevOpsAuthAccountKind = z.infer<typeof azureDevOpsAuthAccountKindSchema>;

/** Azure DevOps project metadata cached in plugin settings. */
export const azureDevOpsProjectSettingsSchema = z.object({
  id: z.string(),
  name: z.string(),
});

/**
 * Connected Azure DevOps organisation and selected project scope.
 */
export const azureDevOpsSettingsSchema = z.object({
  userInfo: z.object({
    email: z.email(),
    displayName: z.string().optional(),
  }),
  credentials: z.object({
    accessToken: z.string(),
    refreshToken: z.string(),
    expiryDate: z.number().int(),
    scope: z.string(),
    tenantSegment: z.string().min(1),
  }),
  organization: z.string().trim().min(1),
  availableProjects: z.array(azureDevOpsProjectSettingsSchema).default([]),
  selectedProjectId: z.string().default(""),
});

export const firefoxBookmarkFolderSettingsSchema = z.object({
  guid: z.string(),
  title: z.string(),
  path: z.string(),
});

/**
 * Firefox Bookmarks integration settings stored inside plugin settings.
 */
export const firefoxBookmarksSettingsSchema = z.object({
  profilePath: z.string().default(""),
  resolvedProfilePath: z.string().default(""),
  availableFolders: z.array(firefoxBookmarkFolderSettingsSchema).default([]),
  selectedFolderGuids: z.array(z.string()).default([]),
});

/**
 * Schema for plugin settings with sensible defaults.
 */
export const pluginSettingsSchema = z.object({
  syncIntervalMinutes: syncIntervalSchema.default(5),
  syncDocument: markdownFilePathShapeSchema.default("GTD.md"),
  syncHeading: headingSchema.default("## Inbox"),
  syncCompletionStatus: z.boolean().default(false),
  enableDeleteSync: z.boolean().default(true),
  confirmDeleteSync: z.boolean().default(true),
  manuallyDeletedTaskIds: z.array(z.string()).default([]),
  googleTasks: googleTasksSettingsSchema.optional(),
  microsoftAuthAccountKind: microsoftAuthAccountKindSchema,
  microsoftAuthWorkOrSchoolTenantId: microsoftWorkOrSchoolTenantIdSchema,
  microsoftOutlook: microsoftOutlookSettingsSchema.optional(),
  azureDevOpsAuthAccountKind: azureDevOpsAuthAccountKindSchema,
  azureDevOpsAuthWorkOrSchoolTenantId: microsoftWorkOrSchoolTenantIdSchema,
  azureDevOpsOrganization: z.string().trim().default(""),
  azureDevOps: azureDevOpsSettingsSchema.optional(),
  firefoxBookmarks: firefoxBookmarksSettingsSchema.optional(),
});
