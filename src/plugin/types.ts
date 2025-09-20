import type { AccessToken, GoogleUserInfo, GoogleTasksList } from "@/services/google/types";

/**
 * Obsidian Syncer plugin settings.
 */
export type PluginSettings = {
  googleTasks?: GoogleTasksSettings | undefined;
  syncIntervalMinutes: number;
  syncDocument: string;
  syncHeading: string;
};

/**
 * Obsidian Syncer plugin configuration.
 */
export type PluginConfig = {
  googleClientId: string;
  googleClientSecret: string;
  /** Build-time experimental flag for MCP */
  mcpExperimental: boolean;
};

/**
 * Google Tasks integration settings.
 */
export type GoogleTasksSettings = {
  userInfo: GoogleUserInfo;
  token: AccessToken;
  availableLists: readonly GoogleTasksList[];
  selectedListIds: readonly string[];
};
