import type { GoogleTasksList, MicrosoftToDoList, TodoistProject } from "@/services/types";
import type {
  GoogleAccessToken,
  GoogleCredentials,
  GoogleUserInfo,
  MicrosoftCredentials,
  MicrosoftUserInfo,
  TodoistCredentials,
  TodoistUserInfo,
} from "@/auth/types";
import type { MicrosoftAuthAccountKind } from "@/plugin/schemas";

import type { FirefoxBookmarkFolder } from "@/services/firefox-bookmarks";

/**
 * Syncer plugin settings.
 */
export type PluginSettings = {
  googleTasks?: GoogleTasksSettings | undefined;
  gmailStarred?: GmailStarredSettings | undefined;
  gmailStarredMaxItems: number;
  syncIntervalMinutes: number;
  syncDocument: string;
  syncHeading: string;
  syncCompletionStatus: boolean;
  enableDeleteSync: boolean;
  confirmDeleteSync: boolean;
  manuallyDeletedTaskIds: readonly string[];
  microsoftAuthAccountKind: MicrosoftAuthAccountKind;
  microsoftAuthWorkOrSchoolTenantId: string;
  microsoftOutlook?: MicrosoftOutlookSettings | undefined;
  microsoftToDo?: MicrosoftToDoSettings | undefined;
  todoist?: TodoistSettings | undefined;
  azureDevOpsOrganization: string;
  azureDevOpsProjectName: string;
  azureDevOpsPersonalAccessToken: string;
  firefoxBookmarks?: FirefoxBookmarksSettings | undefined;
};

/**
 * Syncer plugin configuration.
 */
export type PluginConfig = {
  googleClientId: string;
  googleClientSecret: string;
  microsoftClientId: string;
  todoistClientId: string;
  pluginDirectory: string;
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

/**
 * Gmail Starred integration settings.
 */
export type GmailStarredSettings = {
  userInfo: GoogleUserInfo;
  credentials: GoogleCredentials;
};

/**
 * Microsoft Outlook (Graph) integration settings.
 */
export type MicrosoftOutlookSettings = {
  userInfo: MicrosoftUserInfo;
  credentials: MicrosoftCredentials;
};

/**
 * Microsoft To Do (Graph) integration settings.
 */
export type MicrosoftToDoSettings = {
  userInfo: MicrosoftUserInfo;
  credentials: MicrosoftCredentials;
  availableLists: readonly MicrosoftToDoList[];
  selectedListIds: readonly string[];
};

/**
 * Todoist integration settings.
 */
export type TodoistSettings = {
  userInfo: TodoistUserInfo;
  credentials: TodoistCredentials;
  availableProjects: readonly TodoistProject[];
  selectedProjectIds: readonly string[];
};

/**
 * Firefox Bookmarks integration settings.
 */
export type FirefoxBookmarksSettings = {
  profilePath: string;
  resolvedProfilePath: string;
  availableFolders: readonly FirefoxBookmarkFolder[];
  selectedFolderGuids: readonly string[];
};
