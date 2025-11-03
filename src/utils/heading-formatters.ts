/**
 * Normalise any user-provided text or markdown heading into an H2 heading.
 * Examples:
 *  - "Inbox"       -> "## Inbox"
 *  - "### Tasks"   -> "## Tasks"
 *  - "#   Work"    -> "## Work"
 * Empty/whitespace strings normalise to an invalid "## " (caller validates).
 */
export const normaliseHeadingToH2 = (input: string): string => {
  const trimmed = (input ?? "").trim();
  // Strip leading markdown heading markers if present
  const title = trimmed.replace(/^#+\s*/, "");
  return title === "" ? "## " : `## ${title}`;
};
