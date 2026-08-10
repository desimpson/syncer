import { describe, it, expect } from "vitest";
import { shouldDeferGmailStarredMaxItemsValidation } from "@/plugin/settings-tab";

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
