import type { SyncAction, SyncItem } from "@/sync/types";
import type { TFile } from "obsidian";

/* Matches markdown heading lines at the start of the line, e.g. "## Heading".
Anchored to avoid false matches against values inside HTML comments/JSON
metadata. */
const headingRegex = /^\s*#{1,6}\s/;
// Detect JSON inside HTML comment
const jsonCommentRegex = /<!--\s*({[\s\S]*?})\s*-->/;
// Obsidian Kanban plugin settings block delimiter (start line)
const kanbanSettingsStartRegex = /^\s*%%\s*kanban:settings\s*$/;
// Fixed in-file anchor marker; if present, target first heading AFTER this
const anchorMarker = "<!-- obsidian-syncer:anchor -->";

/** Blank line detection. */
const isBlank = (text: string) => text.trim() === "";

const createLine = (item: SyncItem) => {
  const metadata = {
    id: item.id,
    source: item.source,
    title: item.title,
    link: item.link,
    heading: item.heading,
    completed: item.completed ?? false,
  };
  const checkbox = (item.completed ?? false) ? "[x]" : "[ ]";
  // Indentation handled by caller; keep this at top-level format
  return `- ${checkbox} [${item.title}](${item.link}) <!-- ${JSON.stringify(metadata)} -->`;
};

const updateLine = (line: string, item: SyncItem) => {
  const checkbox = (item.completed ?? false) ? "[x]" : "[ ]";
  // Update both the checkbox and the metadata
  return line
    .replace(/^\s*- \[[ xX]\]/, (match) => match.replace(/\[[ xX]\]/, checkbox))
    .replace(
      jsonCommentRegex,
      `<!-- ${JSON.stringify({
        id: item.id,
        source: item.source,
        title: item.title,
        link: item.link,
        heading: item.heading,
        completed: item.completed ?? false,
      })} -->`,
    );
};

const buildUpdateDeleteMap = (actions: readonly SyncAction[]) =>
  new Map(
    actions
      .filter((action) => action.operation !== "create")
      .map((action) => [`${action.item.id}:${action.item.source}`, action]),
  );

const getCreateItems = (actions: readonly SyncAction[]): readonly SyncItem[] =>
  actions.filter((action) => action.operation === "create").map((action) => action.item);

const applyUpdatesAndDeletes = (lines: string[], updateDeleteMap: Map<string, SyncAction>) =>
  lines.reduce<string[]>((accumulator, line) => {
    const match = line.match(jsonCommentRegex);
    if (match !== null && match[1] !== undefined) {
      try {
        const metadata = JSON.parse(match[1]);
        const key = `${metadata.id}:${metadata.source}`;
        const action = updateDeleteMap.get(key);
        if (action !== undefined) {
          if (action.operation === "update") {
            return [...accumulator, updateLine(line, action.item)];
          }
          // delete: skip line
          return accumulator;
        }
      } catch {
        // invalid JSON, keep line
      }
    }
    return [...accumulator, line];
  }, []);

const findHeadingBlockEnd = (lines: string[], startIndex: number): number =>
  startIndex >= lines.length || headingRegex.test(lines[startIndex] ?? "")
    ? startIndex
    : findHeadingBlockEnd(lines, startIndex + 1);

const findLastIndex = <T>(
  array: readonly T[],
  predicate: (value: T, index: number, array: readonly T[]) => boolean,
): number =>
  array.reduce(
    (last, value, index, fullArray) => (predicate(value, index, fullArray) ? index : last),
    -1,
  );

const findTargetHeadingIndex = (lines: string[], heading: string): number => {
  const markerIndex = lines.findIndex((line) => line.trim() === anchorMarker);
  if (markerIndex === -1) {
    return lines.findIndex((line) => line.trim() === heading);
  }
  return lines.findIndex((line, index) => index > markerIndex && line.trim() === heading);
};

type Section = { sectionStart: number; nextHeadingIndex: number; sectionLines: string[] };

const getSection = (lines: string[], headingIndex: number): Section => {
  const nextHeadingIndex = findHeadingBlockEnd(lines, headingIndex + 1);
  const sectionStart = headingIndex + 1;
  const sectionEnd = nextHeadingIndex; // exclusive
  const sectionLines = lines.slice(sectionStart, sectionEnd);
  return { sectionStart, nextHeadingIndex, sectionLines };
};

const taskItemRegex = /^(\s*)[-*+]\s+\[[ xX]\]\s/;

type ListInfo = { index: number; indent: string };

const findLastListInfo = (sectionLines: string[]): ListInfo =>
  sectionLines.reduce<ListInfo>(
    (accumulator, line, index) => {
      const match = line?.match(taskItemRegex);
      return match ? { index, indent: match[1] ?? "" } : accumulator;
    },
    { index: -1, indent: "" },
  );

const findLastJsonTaskIndex = (sectionLines: string[]): number =>
  findLastIndex(sectionLines, (line) => jsonCommentRegex.test(line ?? ""));

const findKanbanInsertBeforeIndex = (
  sectionLines: string[],
  sectionStart: number,
): number | undefined => {
  const kanbanRelativeIndex = sectionLines.findIndex((line) => kanbanSettingsStartRegex.test(line));
  if (kanbanRelativeIndex === -1) {
    return undefined;
  }
  const before = sectionLines.slice(0, kanbanRelativeIndex);
  const lastNonBlank = findLastIndex(before, (line) => !isBlank(line ?? ""));
  const blankRunStart = lastNonBlank + 1; // first blank, or 0 if none
  return sectionStart + blankRunStart;
};

const buildCreateLines = (items: readonly SyncItem[], indent: string): string[] =>
  items.map((item) => (indent ?? "") + createLine(item));

const insertAt = (lines: string[], index: number, newLines: string[]): string[] => [
  ...lines.slice(0, index),
  ...newLines,
  ...lines.slice(index),
];

const appendCreates = (
  lines: string[],
  createItems: readonly SyncItem[],
  heading: string,
): string[] => {
  if (createItems.length === 0) {
    return lines;
  }

  const headingIndex = findTargetHeadingIndex(lines, heading);
  if (headingIndex === -1) {
    // If the heading doesn't exist, prefer inserting before a global Kanban
    // settings block so that the Kanban metadata remains last in the file.
    const kanbanIndex = lines.findIndex((line) => kanbanSettingsStartRegex.test(line));
    if (kanbanIndex !== -1) {
      const before = lines.slice(0, kanbanIndex);
      const lastNonBlank = findLastIndex(before, (line) => !isBlank(line ?? ""));
      const insertIndex = lastNonBlank + 1; // start of trailing blank run (or 0 if none)
      return insertAt(lines, insertIndex, [heading, ...createItems.map(createLine)]);
    }
    // No Kanban block: append to end
    return [...lines, heading, ...createItems.map(createLine)];
  }

  const { sectionStart, nextHeadingIndex, sectionLines } = getSection(lines, headingIndex);
  const lastJsonTaskRelativeIndex = findLastJsonTaskIndex(sectionLines);
  const lastListInfo = findLastListInfo(sectionLines);
  const kanbanInsertBefore = findKanbanInsertBeforeIndex(sectionLines, sectionStart);
  const createLines = buildCreateLines(createItems, lastListInfo.indent);

  const insertAfterLastJsonTask =
    lastJsonTaskRelativeIndex >= 0 ? sectionStart + lastJsonTaskRelativeIndex + 1 : undefined;
  const insertAfterLastListItem =
    lastListInfo.index >= 0 ? sectionStart + lastListInfo.index + 1 : undefined;

  const insertIndex =
    insertAfterLastJsonTask ?? kanbanInsertBefore ?? insertAfterLastListItem ?? nextHeadingIndex;

  return insertAt(lines, insertIndex, createLines);
};

/**
 * Write sync actions to an Obsidian `TFile` file instance.
 *
 * @param file The file to write to
 * @param actions The sync actions to write
 * @param heading The heading under which to write the actions
 */
export const writeSyncActions = async (
  file: TFile,
  actions: readonly SyncAction[],
  heading: string,
): Promise<void> => {
  const content = await file.vault.read(file);
  const lines = content.split("\n");

  const updateDeleteMap = buildUpdateDeleteMap(actions);
  const createItems = getCreateItems(actions);

  const updatedLines = applyUpdatesAndDeletes(lines, updateDeleteMap);
  const resultLines = appendCreates(updatedLines, createItems, heading);

  await file.vault.modify(file, resultLines.join("\n"));
};
