import type { ParsedLine, SyncItem, SyncSource } from "./types";
import type { TFile } from "obsidian";
import { parsedLineSchema } from "./schemas";

// Matches markdown task line, e.g. "- [ ] Task title <!-- <metadata> -->"
const markdownTaskRegex = /^\s*- \[[ xX]?\]\s+/;

// Captures JSON inside <!-- ... -->
const metadataRegex = /<!--\s*({[\s\S]*?})\s*-->/;

const isValidMarkdownTask = (line: string): boolean => markdownTaskRegex.test(line);

const parseLine = (line: string): ParsedLine | undefined => {
  if (!isValidMarkdownTask(line)) {
    return undefined;
  }

  const match = line.match(metadataRegex);
  if (match === null || match[1] === undefined) {
    return undefined;
  }

  try {
    const json = JSON.parse(match[1]);
    const metadata = parsedLineSchema.parse(json);

    return metadata;
  } catch {
    console.warn(`Failed to parse metadata JSON in line: [${line}].`);
    return undefined;
  }
};

const parseMarkdownLines = (lines: string[]): SyncItem[] =>
  lines
    .map((line) => {
      const parsed = parseLine(line);
      if (parsed === undefined) {
        return undefined;
      }
      // Check if the checkbox is checked by examining the actual line
      const checkedMatch = line.match(/^\s*- \[([xX])\]/);
      const completed = checkedMatch !== null;
      return { ...parsed, completed };
    })
    .filter((line): line is ParsedLine & { completed: boolean } => line !== undefined)
    .map(({ id, title, link, source, heading, completed }) => ({
      id,
      title,
      link,
      source,
      heading,
      completed,
    }));

/**
 * Reads markdown sync items from a file.
 *
 * @param file The markdown file to read from
 * @param syncSource The sync source to filter items by
 * @returns An array of sync items
 */
export const readMarkdownSyncItems = async (
  file: TFile,
  syncSource: SyncSource,
): Promise<SyncItem[]> => {
  const content = await file.vault.cachedRead(file);
  const lines = content.split("\n");
  return parseMarkdownLines(lines).filter((item) => item.source === syncSource);
};
