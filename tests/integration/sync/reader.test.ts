import { describe, it, expect } from "vitest";
import { readMarkdownSyncItems } from "@/sync/reader";
import type { SyncItem } from "@/sync/types";
import type { TFile, Vault } from "obsidian";

const mockVault = (content = ""): Vault =>
  ({
    cachedRead: async () => content,
  }) as unknown as Vault;

const mockTFile = (path: string, content: string): TFile =>
  ({
    path,
    name: path.split("/").pop() ?? path,
    vault: mockVault(content),
  }) as unknown as TFile;

describe("readMarkdownSyncItems", () => {
  type TestCase = {
    name: string;
    markdown: string;
    expected: SyncItem[];
  };

  const cases: TestCase[] = [
    {
      name: "returns empty array for empty file",
      markdown: ``,
      expected: [],
    },
    {
      name: "ignores non-sync lines",
      markdown: `# Heading\n- Just a normal task`,
      expected: [],
    },
    {
      name: "parses a single sync item with JSON metadata",
      markdown: `- [ ] [Do something](https://tasks.google.com/task/123) <!-- {"id":"123","source":"google-tasks","title":"Do something","link":"https://tasks.google.com/task/123","heading":"# Tasks"} -->`,
      expected: [
        {
          id: "123",
          title: "Do something",
          source: "google-tasks",
          heading: "# Tasks",
          link: "https://tasks.google.com/task/123",
        },
      ],
    },
    {
      name: "ignores items from a different source",
      markdown: `- [ ] Wrong source <!-- {"id":"999","source":"other","title":"Wrong source","link":"https://tasks.google.com/task/999","heading":"# Tasks"} -->`,
      expected: [],
    },
    {
      name: "parses multiple sync items with different headings",
      markdown: `
- [ ] [Task A](https://tasks.google.com/task/1) <!-- {"id":"1","source":"google-tasks","title":"Task A","link":"https://tasks.google.com/task/1","heading":"# Work"} -->
- [x] [Task B](https://tasks.google.com/task/2) <!-- {"id":"2","source":"google-tasks","title":"Task B","link":"https://tasks.google.com/task/2","heading":"# Personal"} -->
`,
      expected: [
        {
          id: "1",
          title: "Task A",
          source: "google-tasks",
          heading: "# Work",
          link: "https://tasks.google.com/task/1",
        },
        {
          id: "2",
          title: "Task B",
          source: "google-tasks",
          heading: "# Personal",
          link: "https://tasks.google.com/task/2",
        },
      ],
    },
    {
      name: "skips invalid sync items (missing id)",
      markdown: `- [ ] [Broken](https://tasks.google.com/task/1) <!-- {"source":"google-tasks","title":"Broken","link":"https://tasks.google.com/task/1","heading":"# Tasks"} -->`,
      expected: [],
    },
    {
      name: "skips invalid sync items (missing source)",
      markdown: `- [ ] [Broken](https://tasks.google.com/task/1) <!-- {"id":"123","title":"Broken","link":"https://tasks.google.com/task/1","heading":"# Tasks"} -->`,
      expected: [],
    },
    {
      name: "skips invalid sync items (missing heading)",
      markdown: `- [ ] [Broken](https://tasks.google.com/task/1) <!-- {"id":"123","source":"google-tasks","title":"Broken","link":"https://tasks.google.com/task/1"} -->`,
      expected: [],
    },
    {
      name: "parses sync item with empty link text",
      markdown: `- [ ] [](https://tasks.google.com/task/1) <!-- {"id":"123","source":"google-tasks","title":"A Title","link":"https://tasks.google.com/task/1","heading":"# Tasks"} -->`,
      expected: [
        {
          id: "123",
          title: "A Title",
          source: "google-tasks",
          heading: "# Tasks",
          link: "https://tasks.google.com/task/1",
        },
      ],
    },
    {
      name: "skips invalid sync items (missing link)",
      markdown: `- [ ] [Broken](https://tasks.google.com/task/1) <!-- {"id":"123","source":"google-tasks","title":"Broken","heading":"# Tasks"} -->`,
      expected: [],
    },
  ];

  cases.forEach(({ name, markdown, expected }) => {
    it(name, async () => {
      // Arrange
      const file = mockTFile("Tasks.md", markdown);

      // Act
      const items = await readMarkdownSyncItems(file, "google-tasks");

      // Assert
      expect(items).toEqual(expected);
    });
  });
});
