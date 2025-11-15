import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import type { TFile } from "obsidian";
import { writeSyncActions } from "@/sync/writer";
import type { SyncAction, SyncItem } from "@/sync/types";

const makeItem = (
  id: string,
  source = "google-tasks",
  title = "Task",
  heading = "## Heading",
): SyncItem => ({ id, source, title, link: `https://example.com/${id}`, heading });

describe("writeSyncActions", () => {
  let mockFile: TFile;
  let readMock: Mock;
  let modifyMock: Mock;

  beforeEach(() => {
    readMock = vi.fn();
    modifyMock = vi.fn();
    mockFile = {
      name: "Test.md",
      vault: {
        read: readMock,
        modify: modifyMock,
      },
    } as unknown as TFile;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const testCases: {
    desc: string;
    initialLines: string[];
    actions: SyncAction[];
    expectedLines: string[];
  }[] = [
    {
      desc: "creates new tasks under heading",
      initialLines: ["# Notes", "## Heading"],
      actions: [
        { operation: "create", item: makeItem("1", "google-tasks") },
        { operation: "create", item: makeItem("2", "google-tasks") },
      ],
      expectedLines: [
        "# Notes",
        "## Heading",
        `- [ ] [Task](https://example.com/1) <!-- {"id":"1","source":"google-tasks","title":"Task","link":"https://example.com/1","heading":"## Heading","completed":false} -->`,
        `- [ ] [Task](https://example.com/2) <!-- {"id":"2","source":"google-tasks","title":"Task","link":"https://example.com/2","heading":"## Heading","completed":false} -->`,
      ],
    },
    {
      desc: "updates existing task metadata only",
      initialLines: [
        "## Heading",
        `- [ ] [Task](https://example.com/1) <!-- {"id":"1","source":"google-tasks","title":"Old","link":"https://example.com/1","heading":"## Heading"} -->`,
      ],
      actions: [{ operation: "update", item: makeItem("1", "google-tasks", "Updated") }],
      expectedLines: [
        "## Heading",
        `- [ ] [Task](https://example.com/1) <!-- {"id":"1","source":"google-tasks","title":"Updated","link":"https://example.com/1","heading":"## Heading","completed":false} -->`,
      ],
    },
    {
      desc: "deletes a task",
      initialLines: [
        "## Heading",
        `- [ ] [Task](https://example.com) <!-- {"id":"1","source":"google-tasks","title":"Task","link":"https://example.com","heading":"## Heading"} -->`,
      ],
      actions: [{ operation: "delete", item: makeItem("1", "google-tasks") }],
      expectedLines: ["## Heading"],
    },
    {
      desc: "appends tasks if heading not found",
      initialLines: ["# Notes"],
      actions: [{ operation: "create", item: makeItem("1", "google-tasks") }],
      expectedLines: [
        "# Notes",
        "## Heading",
        `- [ ] [Task](https://example.com/1) <!-- {"id":"1","source":"google-tasks","title":"Task","link":"https://example.com/1","heading":"## Heading","completed":false} -->`,
      ],
    },
    {
      desc: "keeps lines with invalid JSON",
      initialLines: ["## Heading", "- [ ] Task <!-- invalid json -->"],
      actions: [{ operation: "update", item: makeItem("1", "google-tasks") }],
      expectedLines: ["## Heading", "- [ ] Task <!-- invalid json -->"],
    },
    {
      desc: "appends new item to bottom of heading block (not top)",
      initialLines: [
        "## Heading",
        `- [ ] [Existing](https://example.com/0) <!-- {"id":"0","source":"google-tasks","title":"Existing","link":"https://example.com/0","heading":"## Heading"} -->`,
      ],
      actions: [{ operation: "create", item: makeItem("2", "google-tasks") }],
      expectedLines: [
        "## Heading",
        `- [ ] [Existing](https://example.com/0) <!-- {"id":"0","source":"google-tasks","title":"Existing","link":"https://example.com/0","heading":"## Heading"} -->`,
        `- [ ] [Task](https://example.com/2) <!-- {"id":"2","source":"google-tasks","title":"Task","link":"https://example.com/2","heading":"## Heading","completed":false} -->`,
      ],
    },
  ];

  testCases.forEach(({ desc, initialLines, actions, expectedLines }) => {
    it(desc, async () => {
      // Arrange
      readMock.mockResolvedValue(initialLines.join("\n"));

      // Act
      await writeSyncActions(mockFile, actions, "## Heading");

      // Assert
      expect(modifyMock).toHaveBeenCalledWith(mockFile, expectedLines.join("\n"));
    });
  });

  it("inserts before Kanban settings block, preserving blank lines", async () => {
    // Arrange
    const initialLines = [
      "# Notes",
      "## Heading",
      "",
      "",
      "",
      "%% kanban:settings",
      "```",
      '{"kanban-plugin":"board","list-collapse":[false]}',
      "```",
      "%%",
    ];
    readMock.mockResolvedValue(initialLines.join("\n"));
    const actions: SyncAction[] = [{ operation: "create", item: makeItem("1", "google-tasks") }];

    // Act
    await writeSyncActions(mockFile, actions, "## Heading");

    // Assert
    expect(modifyMock).toHaveBeenCalledWith(
      mockFile,
      [
        "# Notes",
        "## Heading",
        `- [ ] [Task](https://example.com/1) <!-- {"id":"1","source":"google-tasks","title":"Task","link":"https://example.com/1","heading":"## Heading","completed":false} -->`,
        "",
        "",
        "",
        "%% kanban:settings",
        "```",
        '{"kanban-plugin":"board","list-collapse":[false]}',
        "```",
        "%%",
      ].join("\n"),
    );
  });

  it("inserts missing heading and tasks before global Kanban block at end", async () => {
    // Arrange
    const initialLines = [
      "# Notes",
      "",
      "",
      "%% kanban:settings",
      "```",
      '{"kanban-plugin":"board","list-collapse":[false]}',
      "```",
      "%%",
    ];
    readMock.mockResolvedValue(initialLines.join("\n"));
    const actions: SyncAction[] = [{ operation: "create", item: makeItem("1", "google-tasks") }];

    // Act
    await writeSyncActions(mockFile, actions, "## Heading");

    // Assert
    expect(modifyMock).toHaveBeenCalledWith(
      mockFile,
      [
        "# Notes",
        "## Heading",
        `- [ ] [Task](https://example.com/1) <!-- {"id":"1","source":"google-tasks","title":"Task","link":"https://example.com/1","heading":"## Heading","completed":false} -->`,
        "",
        "",
        "%% kanban:settings",
        "```",
        '{"kanban-plugin":"board","list-collapse":[false]}',
        "```",
        "%%",
      ].join("\n"),
    );
  });
});
