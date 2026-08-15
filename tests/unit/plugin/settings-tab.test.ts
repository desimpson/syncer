import { describe, it, expect, vi } from "vitest";
import {
  selectionInstructionText,
  shouldDeferGmailStarredMaxItemsValidation,
  updateListSelectionUi,
} from "@/plugin/settings-tab";

describe("shouldDeferGmailStarredMaxItemsValidation", () => {
  it("returns true for empty draft values", () => {
    expect(shouldDeferGmailStarredMaxItemsValidation("")).toBe(true);
    expect(shouldDeferGmailStarredMaxItemsValidation("   ")).toBe(true);
  });

  it("returns false for non-empty draft values", () => {
    expect(shouldDeferGmailStarredMaxItemsValidation("10")).toBe(false);
    expect(shouldDeferGmailStarredMaxItemsValidation("abc")).toBe(false);
  });
});

describe("selectionInstructionText", () => {
  it("returns empty-selection hint when selectedCount is zero", () => {
    expect(selectionInstructionText(0, "list")).toBe(
      "Nothing will sync until you select at least one list.",
    );
    expect(selectionInstructionText(0, "project")).toBe(
      "Nothing will sync until you select at least one project.",
    );
    expect(selectionInstructionText(0, "folder")).toBe(
      "Nothing will sync until you select at least one folder.",
    );
  });

  it("returns click helper when selectedCount is non-zero", () => {
    expect(selectionInstructionText(1, "list")).toBe("Click lists to select them for syncing:");
    expect(selectionInstructionText(2, "project")).toBe(
      "Click projects to select them for syncing:",
    );
  });
});

describe("updateListSelectionUi", () => {
  it("updates instruction and count when selection goes from 0 to 1", () => {
    const instruction = { setText: vi.fn() };
    const count = { setText: vi.fn() };

    updateListSelectionUi(
      { instruction, count },
      { selectedCount: 1, totalCount: 3, noun: "list" },
    );

    expect(instruction.setText).toHaveBeenCalledWith("Click lists to select them for syncing:");
    expect(count.setText).toHaveBeenCalledWith("1 of 3 lists selected");
  });

  it("updates instruction and count when selection goes from 1 to 0", () => {
    const instruction = { setText: vi.fn() };
    const count = { setText: vi.fn() };

    updateListSelectionUi(
      { instruction, count },
      { selectedCount: 0, totalCount: 3, noun: "project" },
    );

    expect(instruction.setText).toHaveBeenCalledWith(
      "Nothing will sync until you select at least one project.",
    );
    expect(count.setText).toHaveBeenCalledWith("0 of 3 projects selected");
  });
});
