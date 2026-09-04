import { describe, expect, it } from "vitest";
import { buildConfig, parseBuildConfig } from "@/plugin/build-config";

describe("parseBuildConfig", () => {
  it("trims client IDs and preserves Google values when enabled", () => {
    // Arrange
    const raw = {
      enableGoogle: true,
      googleClientId: "  google-id  ",
      googleClientSecret: "  google-secret  ",
      microsoftClientId: "  microsoft-id  ",
      todoistClientId: "  todoist-id  ",
    };

    // Act
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

  it("forces Google credentials empty when Google is disabled", () => {
    // Arrange
    const raw = {
      enableGoogle: false,
      googleClientId: "google-id",
      googleClientSecret: "google-secret",
      microsoftClientId: "microsoft-id",
      todoistClientId: "todoist-id",
    };

    // Act
    const result = parseBuildConfig(raw);

    // Assert
    expect(result.googleClientId).toBe("");
    expect(result.googleClientSecret).toBe("");
    expect(result.microsoftClientId).toBe("microsoft-id");
    expect(result.todoistClientId).toBe("todoist-id");
  });

  it("throws when required fields have invalid types", () => {
    // Arrange
    const invalid = {
      enableGoogle: "true",
      googleClientId: "google-id",
      googleClientSecret: "google-secret",
      microsoftClientId: "microsoft-id",
      todoistClientId: "todoist-id",
    };

    // Act & Assert
    expect(() => parseBuildConfig(invalid)).toThrow();
  });
});

describe("buildConfig", () => {
  it("provides deterministic fallback defaults without injected defines", () => {
    // Arrange
    // No setup needed because tests run without esbuild define injection.

    // Act
    const result = buildConfig;

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
