import { describe, expect, it } from "vitest";
import { buildTodoistTaskLink, createTodoistTaskAdaptor } from "@/adaptors/todoist";
import { TODOIST_SOURCE } from "@/sync/types";

describe("todoist adaptor", () => {
  it("buildTodoistTaskLink constructs app.todoist.com task URLs", () => {
    expect(buildTodoistTaskLink("6XGgmFVcrG5RRjVr")).toBe(
      "https://app.todoist.com/app/task/6XGgmFVcrG5RRjVr",
    );
  });

  it("createTodoistTaskAdaptor maps content and completion", () => {
    const adaptor = createTodoistTaskAdaptor("## Inbox");
    const item = adaptor({
      id: "task-1",
      content: "Buy milk",
      checked: true,
    });

    expect(item).toEqual({
      source: TODOIST_SOURCE,
      id: "task-1",
      title: "Buy milk",
      link: "https://app.todoist.com/app/task/task-1",
      heading: "## Inbox",
      completed: true,
    });
  });
});
