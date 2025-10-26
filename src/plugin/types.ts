import type { GoogleTasksList } from "@/services/types";
import type { GoogleAccessToken, GoogleUserInfo } from "@/auth/types";

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
};

/**
 * Google Tasks integration settings.
 */
export type GoogleTasksSettings = {
  userInfo: GoogleUserInfo;
  credentials: GoogleAccessToken;
  availableLists: readonly GoogleTasksList[];
  selectedListIds: readonly string[];
};
