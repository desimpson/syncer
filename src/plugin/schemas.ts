import { z } from "zod";
import { formatPlural } from "@/utils/string-formatters";
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
  GOOGLE_CLIENT_ID: z.string().min(1),
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
 * Normalise any user-provided text or markdown heading into an H2 heading.
 * Examples:
 *  - "Inbox"       -> "## Inbox"
 *  - "### Tasks"   -> "## Tasks"
 *  - "#   Work"    -> "## Work"
 * Empty/whitespace strings normalise to an invalid "## " (caller validates).
 */
const normaliseHeadingToH2 = (input: string): string => {
  const trimmed = (input ?? "").trim();
  // Strip leading markdown heading markers if present
  const title = trimmed.replace(/^#+\s*/, "");
  return title === "" ? "## " : `## ${title}`;
};

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
  // TODO: add scope?
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

/**
 * Schema for plugin settings with sensible defaults.
 */
export const pluginSettingsSchema = z.object({
  syncIntervalMinutes: syncIntervalSchema.default(5),
  syncDocument: markdownFilePathShapeSchema.default("GTD.md"),
  syncHeading: headingSchema.default("## Inbox"),
  googleTasks: googleTasksSettingsSchema.optional(),
});
