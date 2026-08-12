import { describe, expect, it } from "vitest";
import {
  buildMicrosoftToDoTaskLink,
  createMicrosoftToDoTaskAdaptor,
  formatMicrosoftToDoTenantLabel,
} from "@/adaptors/microsoft-todo";

describe("buildMicrosoftToDoTaskLink", () => {
  it("uses live.com task deep link for personal accounts", () => {
    // Act
    const link = buildMicrosoftToDoTaskLink("consumers", "list-1", "task-abc");

    // Assert
    expect(link).toBe("https://to-do.live.com/tasks/id/task-abc");
  });

  it("uses office.com task deep link for work or school accounts", () => {
    // Act / Assert
    expect(buildMicrosoftToDoTaskLink("organizations", "list-1", "task-abc")).toBe(
      "https://to-do.office.com/tasks/id/task-abc",
    );
    expect(
      buildMicrosoftToDoTaskLink("11111111-1111-1111-1111-111111111111", "list-1", "task-abc"),
    ).toBe("https://to-do.office.com/tasks/id/task-abc");
  });

  it("falls back to list-level link when task id is empty", () => {
    // Act / Assert
    expect(buildMicrosoftToDoTaskLink("consumers", "list-1", "")).toBe(
      "https://to-do.live.com/tasks/list-1",
    );
    expect(buildMicrosoftToDoTaskLink("organizations", "list-2", "   ")).toBe(
      "https://to-do.office.com/tasks/list-2",
    );
  });
});

describe("formatMicrosoftToDoTenantLabel", () => {
  it("maps tenant segments to human-readable labels", () => {
    // Act / Assert
    expect(formatMicrosoftToDoTenantLabel("consumers")).toBe("Personal");
    expect(formatMicrosoftToDoTenantLabel("organizations")).toBe("Work or school (any)");
    expect(formatMicrosoftToDoTenantLabel("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")).toBe(
      "Work or school · aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    );
  });
});

describe("createMicrosoftToDoTaskAdaptor", () => {
  it("maps Graph tasks to sync items with completion and links", () => {
    // Arrange
    const adaptor = createMicrosoftToDoTaskAdaptor("## Inbox", "consumers", "list-1");

    // Act
    const item = adaptor({ id: "task-1", title: "Buy milk", status: "notStarted" });

    // Assert
    expect(item).toEqual({
      source: "microsoft-to-do",
      id: "task-1",
      title: "Buy milk",
      link: "https://to-do.live.com/tasks/id/task-1",
      heading: "## Inbox",
      completed: false,
    });
    expect(adaptor({ id: "task-2", title: "Done", status: "completed" }).completed).toBe(true);
  });
});
