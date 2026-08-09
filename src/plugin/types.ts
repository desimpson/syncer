import type { GoogleTasksList } from "@/services/types";
import type {
  AzureDevOpsCredentials,
  AzureDevOpsUserInfo,
  GoogleAccessToken,
  GoogleUserInfo,
  MicrosoftCredentials,
  MicrosoftUserInfo,
} from "@/auth/types";
import type { AzureDevOpsAuthAccountKind, MicrosoftAuthAccountKind } from "@/plugin/schemas";

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
  azureDevOpsAuthAccountKind: AzureDevOpsAuthAccountKind;
  azureDevOpsAuthWorkOrSchoolTenantId: string;
  azureDevOpsOrganization: string;
  azureDevOps?: AzureDevOpsSettings | undefined;
  firefoxBookmarks?: FirefoxBookmarksSettings | undefined;
};

/**
 * Syncer plugin configuration.
 */
export type PluginConfig = {
  googleClientId: string;
  outlookClientId: string;
  /** Empty when the build omits an Azure DevOps client ID (Connect disabled). */
  azureDevOpsClientId: string;
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
 * Azure DevOps project metadata stored in settings.
 */
export type AzureDevOpsProjectSettings = {
  id: string;
  name: string;
};

/**
 * Azure DevOps integration settings.
 */
export type AzureDevOpsSettings = {
  userInfo: AzureDevOpsUserInfo;
  credentials: AzureDevOpsCredentials;
  organization: string;
  availableProjects: readonly AzureDevOpsProjectSettings[];
  selectedProjectId: string;
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
