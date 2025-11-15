import { describe, it, expect } from "vitest";
import { normaliseHeadingToH2 } from "@/utils/heading-formatters";

describe("normaliseHeadingToH2", () => {
  it("converts plain text to H2 heading", () => {
    // Act & Assert
    expect(normaliseHeadingToH2("Inbox")).toBe("## Inbox");
    expect(normaliseHeadingToH2("Tasks")).toBe("## Tasks");
    expect(normaliseHeadingToH2("Work Items")).toBe("## Work Items");
  });

  it("normalises different heading levels to H2", () => {
    // Act & Assert
    expect(normaliseHeadingToH2("# Inbox")).toBe("## Inbox");
    expect(normaliseHeadingToH2("### Tasks")).toBe("## Tasks");
    expect(normaliseHeadingToH2("#### Work")).toBe("## Work");
    expect(normaliseHeadingToH2("##### Projects")).toBe("## Projects");
    expect(normaliseHeadingToH2("###### Deep")).toBe("## Deep");
  });

  it("handles headings with extra spaces", () => {
    // Act & Assert
    expect(normaliseHeadingToH2("#   Spaced")).toBe("## Spaced");
    expect(normaliseHeadingToH2("##  Double Spaced")).toBe("## Double Spaced");
    expect(normaliseHeadingToH2("  Inbox  ")).toBe("## Inbox");
  });

  it("handles empty and whitespace-only input", () => {
    // Act & Assert
    expect(normaliseHeadingToH2("")).toBe("## ");
    expect(normaliseHeadingToH2("   ")).toBe("## ");
    expect(normaliseHeadingToH2("#")).toBe("## ");
    expect(normaliseHeadingToH2("# ")).toBe("## ");
    expect(normaliseHeadingToH2("##")).toBe("## ");
  });

  it("handles null and undefined input", () => {
    // Act & Assert
    // @ts-expect-error Testing runtime behavior with undefined
    expect(normaliseHeadingToH2(undefined)).toBe("## ");
    // @ts-expect-error Testing runtime behavior with null
    // eslint-disable-next-line unicorn/no-null
    expect(normaliseHeadingToH2(null)).toBe("## ");
  });

  it("preserves text with # that is not a heading marker", () => {
    // Act & Assert
    expect(normaliseHeadingToH2("Code #example")).toBe("## Code #example");
    expect(normaliseHeadingToH2("Item #123")).toBe("## Item #123");
  });

  it("handles complex heading text", () => {
    // Act & Assert
    expect(normaliseHeadingToH2("# Complex: Task & Project (2024)")).toBe(
      "## Complex: Task & Project (2024)",
    );
    expect(normaliseHeadingToH2("### Multi-word heading with symbols!")).toBe(
      "## Multi-word heading with symbols!",
    );
  });
});
