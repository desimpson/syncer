import type { GoogleTasksList } from "@/services/types";
import type {
  GoogleAccessToken,
  GoogleUserInfo,
  MicrosoftCredentials,
  MicrosoftUserInfo,
} from "@/auth/types";
import type { MicrosoftAuthAccountKind } from "@/plugin/schemas";

import type { FirefoxBookmarkFolder } from "@/services/firefox-bookmarks";

/**
 * Syncer plugin settings.
 */
export type PluginSettings = {
  googleTasks?: GoogleTasksSettings | undefined;
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
  outlookClientId: string;
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
 * Microsoft Outlook (Graph) integration settings.
 */
export type MicrosoftOutlookSettings = {
  userInfo: MicrosoftUserInfo;
  credentials: MicrosoftCredentials;
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
