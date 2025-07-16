import { describe, it, expect } from "vitest";
import { formatPlural } from "@/utils/string-formatters";

describe("formatPlural", () => {
  it("returns singular when value is 1", () => {
    expect(formatPlural(1, "apple")).toBe("1 apple");
  });

  it("adds 's' for plurals by default", () => {
    expect(formatPlural(2, "apple")).toBe("2 apples");
    expect(formatPlural(0, "task")).toBe("0 tasks");
  });

  it("uses provided irregular plural when supplied", () => {
    expect(formatPlural(0, "child", "children")).toBe("0 children");
    expect(formatPlural(5, "person", "people")).toBe("5 people");
  });
});
