import { afterEach, describe, expect, it, vi } from "vitest";

describe("parseBuildConfig", () => {
  it("trims client IDs and preserves Google values when enabled", async () => {
    // Arrange
    const raw = {
      enableGoogle: true,
      googleClientId: "  google-id  ",
      googleClientSecret: "  google-secret  ",
      microsoftClientId: "  microsoft-id  ",
      todoistClientId: "  todoist-id  ",
    };

    // Act
    const { parseBuildConfig } = await import("@/plugin/build-config");
    const result = parseBuildConfig(raw);

    // Assert
    expect(result).toEqual({
      enableGoogle: true,
      googleClientId: "google-id",
      googleClientSecret: "google-secret",
      microsoftClientId: "microsoft-id",
      todoistClientId: "todoist-id",
    });
  });

  it("forces Google credentials empty when Google is disabled", async () => {
    // Arrange
    const raw = {
      enableGoogle: false,
      googleClientId: "google-id",
      googleClientSecret: "google-secret",
      microsoftClientId: "microsoft-id",
      todoistClientId: "todoist-id",
    };

    // Act
    const { parseBuildConfig } = await import("@/plugin/build-config");
    const result = parseBuildConfig(raw);

    // Assert
    expect(result.googleClientId).toBe("");
    expect(result.googleClientSecret).toBe("");
    expect(result.microsoftClientId).toBe("microsoft-id");
    expect(result.todoistClientId).toBe("todoist-id");
  });

  it("throws when required fields have invalid types", async () => {
    // Arrange
    const invalid = {
      enableGoogle: "true",
      googleClientId: "google-id",
      googleClientSecret: "google-secret",
      microsoftClientId: "microsoft-id",
      todoistClientId: "todoist-id",
    };

    // Act & Assert
    const { parseBuildConfig } = await import("@/plugin/build-config");
    expect(() => parseBuildConfig(invalid)).toThrow();
  });
});

describe("buildConfig", () => {
  it("provides deterministic fallback defaults without injected defines", async () => {
    // Arrange
    // No setup needed because tests run without esbuild define injection.

    // Act
    vi.resetModules();
    const module = await import("@/plugin/build-config");
    const result = module.buildConfig;

    // Assert
    expect(result).toEqual({
      enableGoogle: false,
      googleClientId: "",
      googleClientSecret: "",
      microsoftClientId: "",
      todoistClientId: "",
    });
  });
});

describe("buildConfig global define parsing", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("reads global define values when present", async () => {
    // Arrange
    vi.resetModules();
    vi.stubGlobal("__ENABLE_GOOGLE__", true);
    vi.stubGlobal("__GOOGLE_CLIENT_ID__", "  dynamic-google-id  ");
    vi.stubGlobal("__GOOGLE_CLIENT_SECRET__", "  dynamic-google-secret  ");
    vi.stubGlobal("__MICROSOFT_CLIENT_ID__", "  dynamic-microsoft-id  ");
    vi.stubGlobal("__TODOIST_CLIENT_ID__", "  dynamic-todoist-id  ");

    // Act
    const module = await import("@/plugin/build-config");

    // Assert
    expect(module.buildConfig).toEqual({
      enableGoogle: true,
      googleClientId: "dynamic-google-id",
      googleClientSecret: "dynamic-google-secret",
      microsoftClientId: "dynamic-microsoft-id",
      todoistClientId: "dynamic-todoist-id",
    });
  });

  it("falls back when globals have wrong runtime types", async () => {
    // Arrange
    vi.resetModules();
    vi.stubGlobal("__ENABLE_GOOGLE__", "not-boolean");
    vi.stubGlobal("__GOOGLE_CLIENT_ID__", 123);
    vi.stubGlobal("__GOOGLE_CLIENT_SECRET__", undefined);
    vi.stubGlobal("__MICROSOFT_CLIENT_ID__", false);
    vi.stubGlobal("__TODOIST_CLIENT_ID__", {});

    // Act
    const module = await import("@/plugin/build-config");

    // Assert
    expect(module.buildConfig).toEqual({
      enableGoogle: false,
      googleClientId: "",
      googleClientSecret: "",
      microsoftClientId: "",
      todoistClientId: "",
    });
  });
});
