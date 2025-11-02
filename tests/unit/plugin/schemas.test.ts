import {
  createMarkdownFilePathSchema,
  maximumSyncIntervalMinutes,
  minimumSyncIntervalMinutes,
  pluginSchema,
  syncIntervalSchema,
  pluginSettingsSchema,
  googleTasksSettingsSchema,
  headingSchema,
} from "@/plugin/schemas";
import { describe, it, expect } from "vitest";
import type { TFile, Vault } from "obsidian";

// Local light-weight Vault mock for this test file
const makeMockVault = (existingFiles: string[] = [], content = ""): Vault =>
  ({
    getAbstractFileByPath: (path: string) => {
      return existingFiles.includes(path)
        ? ({ path, name: path.split("/").pop() ?? path } as TFile)
        : undefined;
    },
    cachedRead: async (_file?: TFile) => content,
    getFileByPath: (path?: string) => {
      return path !== undefined && existingFiles.includes(path) ? ({ path } as TFile) : undefined;
    },
    modify: async () => {
      /* empty */
    },
    read: async () => content,
  }) as unknown as Vault;

describe("pluginSchema", () => {
  it("accepts valid non-empty client credentials", () => {
    // Arrange
    const input = {
      GOOGLE_CLIENT_ID: "id-123",
    };

    // Act
    const result = pluginSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.GOOGLE_CLIENT_ID).toBe("id-123");
    }
  });

  it("rejects empty client credentials", () => {
    // Arrange
    const input = {
      GOOGLE_CLIENT_ID: "",
    };

    // Act
    const result = pluginSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((index) => index.message);
      expect(messages).toContain("Too small: expected string to have >=1 characters");
    }
  });
});

describe("createMarkdownFilePathSchema", () => {
  it("accepts a valid existing Markdown file path", async () => {
    // Arrange
    const fakeVault = makeMockVault(["GTD.md"]);
    const schema = createMarkdownFilePathSchema(fakeVault);

    // Act
    const result = await schema.safeParseAsync("GTD.md");

    // Assert
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe("GTD.md");
    }
  });

  it("rejects empty/whitespace paths with custom message", async () => {
    // Arrange
    const fakeVault = makeMockVault();
    const schema = createMarkdownFilePathSchema(fakeVault);

    // Act
    const result = await schema.safeParseAsync("   ");

    // Assert
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe("File path cannot be empty.");
    }
  });

  it("rejects non-.md extensions before existence check", async () => {
    // Arrange
    const fakeVault = makeMockVault(["notes.txt"]);
    const schema = createMarkdownFilePathSchema(fakeVault);

    // Act
    const result = await schema.safeParseAsync("notes.txt");

    // Assert
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('File must end with ".md".');
    }
  });

  it("rejects non-existent .md path with existence message", async () => {
    // Arrange
    const fakeVault = makeMockVault();
    const schema = createMarkdownFilePathSchema(fakeVault);

    // Act
    const result = await schema.safeParseAsync("missing.md");

    // Assert
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe("File does not exist in the vault.");
    }
  });
});

describe("syncIntervalSchema", () => {
  it("coerces numeric strings and accepts valid integer within bounds", () => {
    // Arrange
    const input = String(minimumSyncIntervalMinutes + 1);

    // Act
    const result = syncIntervalSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe(minimumSyncIntervalMinutes + 1);
    }
  });

  it("rejects non-integer values with whole number message", () => {
    // Arrange
    const input = "3.5";

    // Act
    const result = syncIntervalSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((index) => index.message);
      expect(messages).toContain("Must be a whole number.");
    }
  });

  it("enforces min and max with formatted messages", () => {
    // Arrange
    const belowInput = minimumSyncIntervalMinutes - 1;
    const aboveInput = maximumSyncIntervalMinutes + 1;

    // Act
    const belowMin = syncIntervalSchema.safeParse(belowInput);
    const aboveMax = syncIntervalSchema.safeParse(aboveInput);

    // Assert
    expect(belowMin.success).toBe(false);
    if (!belowMin.success) {
      const message = belowMin.error.issues[0]?.message ?? "";
      expect(message).toContain("Must be at least");
      expect(message).toContain("minute");
    }

    expect(aboveMax.success).toBe(false);
    if (!aboveMax.success) {
      const message = aboveMax.error.issues[0]?.message ?? "";
      expect(message).toContain("less than or equal");
      expect(message).toContain("minute");
    }
  });

  it("rejects non-numeric input with number message", () => {
    // Arrange
    const input = "not-a-number";

    // Act
    const result = syncIntervalSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((index) => index.message);
      expect(messages.join(" | ")).toContain("Must be a number.");
    }
  });
});

describe("pluginSettingsSchema", () => {
  it("applies defaults when no values are provided", () => {
    // Act
    const result = pluginSettingsSchema.safeParse({});

    // Assert
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.syncIntervalMinutes).toBe(5);
      expect(result.data.syncDocument).toBe("GTD.md");
      expect(result.data.syncHeading).toBe("## Inbox");
      expect(result.data.googleTasks).toBeUndefined();
    }
  });

  it("coerces syncIntervalMinutes and normalises heading to H2", () => {
    // Arrange
    const input = { syncIntervalMinutes: "7", syncDocument: "Work.md", syncHeading: "### Tasks" };

    // Act
    const parsed = pluginSettingsSchema.parse(input);

    // Assert
    expect(parsed.syncIntervalMinutes).toBe(7);
    expect(parsed.syncDocument).toBe("Work.md");
    expect(parsed.syncHeading).toBe("## Tasks");
  });

  it("rejects invalid document extension with a helpful message", () => {
    // Arrange
    const input = { syncDocument: "notes.txt", syncHeading: "## H" };

    // Act
    const result = pluginSettingsSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((index) => index.message);
      expect(messages).toContain('File must end with ".md".');
    }
  });

  it("parses googleTasks nested settings and defaults list fields to empty arrays", () => {
    // Arrange
    const input = {
      googleTasks: {
        userInfo: { email: "u1@example.com" },
        credentials: { accessToken: "at", refreshToken: "rt", expiryDate: 3600, scope: "scope" },
      },
    };

    // Act
    const parsed = pluginSettingsSchema.parse(input);

    // Assert
    expect(parsed.googleTasks).toBeDefined();
    expect(parsed.googleTasks?.userInfo.email).toBe("u1@example.com");
    expect(parsed.googleTasks?.credentials.accessToken).toBe("at");
    expect(parsed.googleTasks?.credentials.refreshToken).toBe("rt");
    expect(parsed.googleTasks?.credentials.expiryDate).toBe(3600);
    expect(parsed.googleTasks?.availableLists).toEqual([]);
    expect(parsed.googleTasks?.selectedListIds).toEqual([]);
  });

  it("rejects invalid googleTasks nested settings (bad email, negative expires)", () => {
    // Arrange
    const input = {
      googleTasks: {
        userInfo: { email: "not-an-email" },
        credentials: { accessToken: "at", refreshToken: "rt", expiryDate: -10, scope: "scope" },
      },
    };

    // Act
    const result = pluginSettingsSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((index) => index.message).join(" | ");
      expect(messages).toContain("Invalid email address");
    }
  });
});

describe("googleTasksSettingsSchema", () => {
  it("accepts a fully specified settings object", () => {
    // Arrange
    const input = {
      userInfo: { email: "user@example.com" },
      credentials: { accessToken: "aa", refreshToken: "rr", expiryDate: 1000, scope: "scope" },
      availableLists: [
        { id: "1", title: "Inbox" },
        { id: "2", title: "Work" },
      ],
      selectedListIds: ["1"],
    };

    // Act
    const result = googleTasksSettingsSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.availableLists.length).toBe(2);
      expect(result.data.selectedListIds).toEqual(["1"]);
    }
  });
});

describe("headingSchema", () => {
  it("normalises various inputs to H2 with text", () => {
    const cases: [string, string][] = [
      ["# A", "## A"],
      ["## B", "## B"],
      ["### C", "## C"],
      ["Inbox", "## Inbox"],
      ["#   Work", "## Work"],
      ["####### Inbox", "## Inbox"],
    ];
    for (const [input, expected] of cases) {
      const result = headingSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe(expected);
      }
    }
  });

  it("rejects empty headings after normalisation", () => {
    // TODO: parameterise this test with it.each
    const invalid = ["", "   ", "# ", "## "];
    for (const value of invalid) {
      const result = headingSchema.safeParse(value);
      expect(result.success).toBe(false);
      if (!result.success) {
        const messages = result.error.issues.map((issue) => issue.message).join(" | ");
        expect(messages).toContain("Heading must be H2 with text");
      }
    }
  });
});

describe("pluginSettingsSchema with heading", () => {
  it("accepts flexible heading inputs and stores H2", () => {
    const result = pluginSettingsSchema.safeParse({ syncHeading: "Inbox" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.syncHeading).toBe("## Inbox");
    }
  });
});
