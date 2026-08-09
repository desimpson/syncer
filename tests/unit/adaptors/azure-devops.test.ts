import { describe, expect, it } from "vitest";
import { mapAzureDevOpsWorkItemToSyncItem } from "@/adaptors/azure-devops";
import { AZURE_DEVOPS_SOURCE } from "@/sync/types";

describe("mapAzureDevOpsWorkItemToSyncItem", () => {
  it("maps work item fields to SyncItem", () => {
    // Arrange
    const adaptor = mapAzureDevOpsWorkItemToSyncItem("## Inbox");

    // Act
    const item = adaptor({
      id: 42,
      title: "Fix login bug",
      url: "https://dev.azure.com/org/project/_workitems/edit/42",
    });

    // Assert
    expect(item).toEqual({
      source: AZURE_DEVOPS_SOURCE,
      id: "42",
      title: "Fix login bug",
      link: "https://dev.azure.com/org/project/_workitems/edit/42",
      heading: "## Inbox",
      completed: false,
    });
  });

  it("uses fallback title when work item title is blank", () => {
    // Arrange
    const adaptor = mapAzureDevOpsWorkItemToSyncItem("## Tasks");

    // Act
    const item = adaptor({
      id: 7,
      title: "   ",
      url: "https://dev.azure.com/org/project/_workitems/edit/7",
    });

    // Assert
    expect(item.title).toBe("Work item #7");
  });
});
