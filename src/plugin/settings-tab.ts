import { Notice, Platform, PluginSettingTab, Setting, TextComponent, type App } from "obsidian";
import { FileSuggest } from "@/plugin/suggesters/file-suggest";
import type SyncerPlugin from "@/plugin";
import { formatLogError, formatUiError } from "@/utils/error-formatters";
import type { PluginSettings, PluginConfig } from "@/plugin/types";
import {
  createMarkdownFilePathSchema,
  headingSchema,
  microsoftWorkOrSchoolTenantIdSchema,
  syncIntervalSchema,
} from "./schemas";
import { GoogleAuth, InvalidGrantError, MicrosoftAuth } from "@/auth";
import { GoogleTasksService } from "@/services";
import type { GoogleTasksList } from "@/services/types";
import { AuthorizationExpiredModal } from "@/plugin/modals/authorization-expired-modal";
import {
  fetchFirefoxBookmarkFolders,
  FirefoxBookmarksError,
  type FirefoxBookmarkFolder,
} from "@/services/firefox-bookmarks";
import { searchFirefoxBookmarkFolders } from "@/services/firefox-profiles";
import { resolvePluginDirectory } from "@/plugin/plugin-directory";
const firefoxFolderLabel = (folder: FirefoxBookmarkFolder): string =>
  folder.path.length > 0 ? folder.path : folder.title;

const normaliseAzureDevOpsOrganizationInput = (value: string): string => {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return "";
  }

  // Accept full org URLs and extract the organization segment.
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      if (parsed.hostname.toLowerCase() === "dev.azure.com") {
        const segment = parsed.pathname
          .split("/")
          .map((part) => part.trim())
          .find((part) => part.length > 0);
        return segment ?? "";
      }
    } catch {
      // Fall through and treat input as a raw organization string.
    }
  }

  return trimmed.replaceAll(/^\/+|\/+$/g, "");
};

const parseAzureDevOpsUrlSegments = (
  value: string,
): { organization: string; projectName: string | undefined } | undefined => {
  const trimmed = value.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    return undefined;
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.hostname.toLowerCase() !== "dev.azure.com") {
      return undefined;
    }
    const segments = parsed.pathname
      .split("/")
      .map((part) => decodeURIComponent(part.trim()))
      .filter((part) => part.length > 0);
    const organization = segments[0];
    if (organization === undefined) {
      return undefined;
    }
    return { organization, projectName: segments[1] };
  } catch {
    return undefined;
  }
};

/**
 * Settings tab for the Syncer plugin.
 */
export class SettingsTab extends PluginSettingTab {
  /**
   * Creates an instance of the SettingsTab.
   *
   * @param app - The Obsidian app instance
   * @param plugin - The plugin instance
   * @param config - The plugin configuration
   */
  public constructor(
    app: App,
    public plugin: SyncerPlugin,
    private readonly config: PluginConfig,
  ) {
    super(app, plugin);
  }

  /**
   * Renders the settings tab UI.
   */
  public async display(): Promise<void> {
    const { containerEl } = this;
    containerEl.empty();

    const settings = await this.plugin.loadSettings();

    await this.renderGeneralSettings(containerEl, settings);
    await this.renderExternalSourceSettings(containerEl);
  }

  private async renderGeneralSettings(containerElement: HTMLElement, settings: PluginSettings) {
    await this.addSyncIntervalSetting(containerElement, settings);
    await this.addSyncDocumentSetting(containerElement, settings);
    this.addSyncHeadingSetting(containerElement, settings);
    this.addSyncCompletionStatusSetting(containerElement, settings);
  }

  private async renderExternalSourceSettings(containerElement: HTMLElement) {
    new Setting(containerElement).setName("External sources").setHeading();
    containerElement.createEl("p", {
      text: "Configure settings for the external sources you want to sync with Obsidian.",
    });
    await this.addGoogleTasksSettings(containerElement);
    await this.addMicrosoftOutlookSettings(containerElement);
    await this.addAzureDevOpsSettings(containerElement);
    await this.addFirefoxBookmarksSettings(containerElement);
  }

  private async addSyncIntervalSetting(containerElement: HTMLElement, settings: PluginSettings) {
    const { input, errorElement } = this.createTextSetting(
      containerElement,
      "Sync interval (minutes)",
      "Set the frequency of sync operations in minutes.",
      settings.syncIntervalMinutes.toString(),
      "e.g., 5",
    );

    input.onChange(async (value) => {
      const result = syncIntervalSchema.safeParse(value);
      if (result.success) {
        await this.plugin.updateSettings({ syncIntervalMinutes: result.data });
        errorElement.setText("");
      } else {
        errorElement.setText(formatUiError(result.error));
        console.warn(
          `Invalid sync interval value: [${value}]. Error: [${formatLogError(result.error)}].`,
        );
      }
    });
  }

  private async addSyncDocumentSetting(containerElement: HTMLElement, settings: PluginSettings) {
    const { input, errorElement } = this.createTextSetting(
      containerElement,
      "Sync markdown file path",
      "Path to the markdown file you want to sync external data to. Sync reads the saved file on disk, so save changes before running Manual sync.",
      settings.syncDocument,
      "e.g., GTD.md",
    );

    new FileSuggest(this.app, input.inputEl);

    input.onChange(async (value) => {
      const schema = createMarkdownFilePathSchema(this.app.vault);
      const result = await schema.safeParseAsync(value);

      if (result.success) {
        await this.plugin.updateSettings({ syncDocument: result.data });
        errorElement.setText("");
      } else {
        errorElement.setText(formatUiError(result.error));
        console.warn(
          `Invalid sync document path: [${value}]. Error: [${formatLogError(result.error)}].`,
        );
      }
    });
  }

  private addSyncHeadingSetting(containerElement: HTMLElement, settings: PluginSettings): void {
    const { input, errorElement } = this.createTextSetting(
      containerElement,
      "Sync heading",
      "The H2 heading under which new synced items will be inserted. Text will be converted to H2 format.",
      settings.syncHeading,
      "e.g., ## Inbox, ## Tasks, or ## To-Do",
    );

    input.onChange(async (value) => {
      const result = headingSchema.safeParse(value);
      if (!result.success) {
        // E.g., empty or all whitespace
        errorElement.setText(formatUiError(result.error));
        console.warn(
          `Invalid heading format: [${value}]. Error: [${formatLogError(result.error)}].`,
        );
        return;
      }

      const normalised = result.data;
      if (normalised !== value) {
        input.setValue(normalised);
      }

      await this.plugin.updateSettings({ syncHeading: result.data });
      errorElement.setText("");
    });
  }

  private addSyncCompletionStatusSetting(
    containerElement: HTMLElement,
    settings: PluginSettings,
  ): void {
    new Setting(containerElement)
      .setName("Sync completion status")
      .setDesc(
        // eslint-disable-next-line obsidianmd/ui/sentence-case -- product names
        "When enabled, completing or uncompleting synced items in Obsidian updates Google Tasks and Microsoft Outlook (email flags) on the next sync.",
      )
      .addToggle((toggle) => {
        toggle.setValue(settings.syncCompletionStatus).onChange(async (value) => {
          await this.plugin.updateSettings({ syncCompletionStatus: value });
        });
      });
  }

  private addDeleteSyncSettings(containerElement: HTMLElement, settings: PluginSettings): void {
    new Setting(containerElement)
      .setName("Sync task deletions")
      .setDesc(
        // eslint-disable-next-line obsidianmd/ui/sentence-case -- product names
        "When enabled, deleting a Google Tasks task in Obsidian will also delete it from Google Tasks.",
      )
      .addToggle((toggle) => {
        toggle.setValue(settings.enableDeleteSync).onChange(async (value) => {
          await this.plugin.updateSettings({ enableDeleteSync: value });
          // Refresh the display to show/hide the confirm setting
          await this.display();
        });
      });

    if (settings.enableDeleteSync) {
      new Setting(containerElement)
        .setName("Confirm task deletions")
        .setDesc(
          // eslint-disable-next-line obsidianmd/ui/sentence-case -- product name
          "When enabled, you will be prompted to confirm before deleting tasks from Google Tasks.",
        )
        .addToggle((toggle) => {
          toggle.setValue(settings.confirmDeleteSync).onChange(async (value) => {
            await this.plugin.updateSettings({ confirmDeleteSync: value });
          });
        });
    }

    if (settings.manuallyDeletedTaskIds.length > 0) {
      new Setting(containerElement)
        .setName("Clear manually deleted tasks cache")
        .setDesc(
          `Clear the cache of ${settings.manuallyDeletedTaskIds.length} manually deleted task(s). This will allow these tasks to be re-synced from Google Tasks on the next sync.`,
        )
        .addButton((button) =>
          button
            .setButtonText("Clear cache")
            .setWarning()
            .onClick(async () => {
              await this.plugin.updateSettings({ manuallyDeletedTaskIds: [] });
              new Notice("Manually deleted tasks cache cleared.");
              await this.display();
            }),
        );
    }
  }

  private async addGoogleTasksSettings(containerElement: HTMLElement) {
    // eslint-disable-next-line obsidianmd/ui/sentence-case -- product name
    new Setting(containerElement).setName("Google Tasks").setHeading();
    const setting = new Setting(containerElement);

    const settings = await this.plugin.loadSettings();
    const { googleTasks } = settings;
    if (googleTasks === undefined) {
      // eslint-disable-next-line obsidianmd/ui/sentence-case -- product name
      setting.setName("No Google Tasks account connected");
      // eslint-disable-next-line obsidianmd/ui/sentence-case -- product name
      setting.setDesc("Connect your Google Tasks account to sync tasks.");
      setting.addButton((button) =>
        button.setButtonText("Connect").onClick(async () => {
          await this.connectGoogleTasks();
          await this.display();
        }),
      );
    } else {
      setting.setName("Connected account");
      setting.setDesc(googleTasks.userInfo?.email ?? "");
      setting.addButton((button) =>
        button
          .setButtonText("Disconnect")
          .setWarning()
          .onClick(async () => {
            await this.disconnectGoogleTasks();
            await this.display();
          }),
      );
    }

    this.addDeleteSyncSettings(containerElement, settings);

    await this.addGoogleTasksListSelector(containerElement);
  }

  private async connectGoogleTasks(): Promise<void> {
    try {
      const credentials = await GoogleAuth.authenticate({
        clientId: this.config.googleClientId,
        scopes: "https://www.googleapis.com/auth/tasks openid email profile",
      });

      const userInfo = await GoogleAuth.getUserInfo(credentials.accessToken);

      await this.plugin.updateSettings({
        googleTasks: {
          credentials,
          userInfo,
          availableLists: [],
          selectedListIds: [],
        },
      });

      // eslint-disable-next-line obsidianmd/ui/sentence-case -- product name
      new Notice("Google Tasks account connected successfully.");
    } catch (error) {
      // eslint-disable-next-line obsidianmd/ui/sentence-case -- product name
      new Notice("Failed to connect Google Tasks.");
      console.error(`Error connecting Google Tasks: [${formatLogError(error)}].`);
    }
  }

  private async disconnectGoogleTasks(): Promise<void> {
    // TODO: Save the lists but grey everything out, so when the user reconnects
    // they get their previous selections back
    await this.plugin.updateSettings({ googleTasks: undefined });
    // eslint-disable-next-line obsidianmd/ui/sentence-case -- product name
    new Notice("Google Tasks account disconnected.");
  }

  private async addMicrosoftOutlookSettings(containerElement: HTMLElement) {
    /* eslint-disable obsidianmd/ui/sentence-case -- Microsoft product names in Outlook settings */

    new Setting(containerElement).setName("Microsoft Outlook").setHeading();

    const settings = await this.plugin.loadSettings();

    new Setting(containerElement)
      .setName("Outlook account type")
      .setDesc(
        "Choose the option that matches how you sign in to Microsoft: a personal inbox, or an account from work or school.",
      )
      .addDropdown((dropdown) => {
        dropdown
          .addOption("personal", "Personal (Outlook.com, Hotmail, Live)")
          .addOption("workSchool", "Work or school")
          .setValue(settings.microsoftAuthAccountKind)
          .onChange(async (value) => {
            const accountKind = value === "workSchool" ? "workSchool" : "personal";
            await this.plugin.updateSettings({ microsoftAuthAccountKind: accountKind });
            await this.display();
          });
      });

    if (settings.microsoftAuthAccountKind === "workSchool") {
      const tenantParse = microsoftWorkOrSchoolTenantIdSchema.safeParse(
        settings.microsoftAuthWorkOrSchoolTenantId,
      );
      const { input, errorElement } = this.createTextSetting(
        containerElement,
        "Directory (tenant) ID",
        "Optional. Leave empty to allow any work or school account. Otherwise paste your Microsoft Entra tenant GUID (Directory tenant ID from Azure).",
        settings.microsoftAuthWorkOrSchoolTenantId,
        "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
      );

      if (!tenantParse.success) {
        errorElement.setText(tenantParse.error.issues[0]?.message ?? "Invalid tenant ID.");
      }

      input.onChange(async (value) => {
        const result = microsoftWorkOrSchoolTenantIdSchema.safeParse(value);
        if (result.success) {
          await this.plugin.updateSettings({ microsoftAuthWorkOrSchoolTenantId: result.data });
          errorElement.setText("");
        } else {
          errorElement.setText(result.error.issues[0]?.message ?? "Invalid value.");
          console.warn(
            `Invalid Microsoft tenant ID: [${value}]. Error: [${formatLogError(result.error)}].`,
          );
        }
      });
    }

    const outlookRow = new Setting(containerElement);
    const { microsoftOutlook } = settings;

    if (microsoftOutlook === undefined) {
      outlookRow.setName("No Microsoft Outlook account connected");
      outlookRow.setDesc(
        this.config.outlookClientId.length === 0
          ? "The plugin build does not include an Outlook application (client) ID. Set OUTLOOK_CLIENT_ID_DEV or OUTLOOK_CLIENT_ID_PROD when building to enable Connect."
          : "Connect opens your browser to sign in with Microsoft; after you consent, you are redirected back to Obsidian on localhost to finish linking.",
      );
      outlookRow.addButton((button) => {
        if (this.config.outlookClientId.length === 0) {
          button.setDisabled(true);
        }
        button.setButtonText("Connect").onClick(async () => {
          await this.connectMicrosoftOutlook();
          await this.display();
        });
      });
    } else {
      const display =
        microsoftOutlook.userInfo.displayName !== undefined &&
        microsoftOutlook.userInfo.displayName.length > 0
          ? `${microsoftOutlook.userInfo.displayName} · ${microsoftOutlook.userInfo.email}`
          : microsoftOutlook.userInfo.email;
      outlookRow.setName("Connected account");
      outlookRow.setDesc(
        `${display} · authority: login.microsoftonline.com/${microsoftOutlook.credentials.tenantSegment}`,
      );
      outlookRow.addButton((button) =>
        button
          .setButtonText("Disconnect")
          .setWarning()
          .onClick(async () => {
            await this.disconnectMicrosoftOutlook();
            await this.display();
          }),
      );
    }
    /* eslint-enable obsidianmd/ui/sentence-case */
  }

  private async connectMicrosoftOutlook(): Promise<void> {
    /* eslint-disable obsidianmd/ui/sentence-case -- Microsoft product names in notices */
    if (this.config.outlookClientId.length === 0) {
      new Notice("Outlook client ID is not configured for this build.");
      return;
    }

    const settings = await this.plugin.loadSettings();
    const tenantIdCheck = microsoftWorkOrSchoolTenantIdSchema.safeParse(
      settings.microsoftAuthWorkOrSchoolTenantId,
    );
    if (!tenantIdCheck.success) {
      new Notice("Fix the directory (tenant) ID before connecting.");
      return;
    }

    try {
      const tenantSegment = MicrosoftAuth.microsoftGraphTenantSegmentFromAuthSelection({
        accountKind: settings.microsoftAuthAccountKind,
        workOrSchoolTenantId: tenantIdCheck.data,
      });

      const credentials = await MicrosoftAuth.authenticate({
        clientId: this.config.outlookClientId,
        tenantSegment,
      });

      const userInfo = await MicrosoftAuth.getUserInfo(credentials.accessToken);

      await this.plugin.updateSettings({
        microsoftOutlook: {
          credentials,
          userInfo,
        },
      });

      new Notice("Microsoft Outlook account connected successfully.");
    } catch (error) {
      new Notice("Failed to connect Microsoft Outlook.");
      console.error(`Error connecting Microsoft Outlook: [${formatLogError(error)}].`);
    }
    /* eslint-enable obsidianmd/ui/sentence-case */
  }

  private async disconnectMicrosoftOutlook(): Promise<void> {
    /* eslint-disable obsidianmd/ui/sentence-case -- Microsoft product names in notices */
    await this.plugin.updateSettings({ microsoftOutlook: undefined });
    new Notice("Microsoft Outlook account disconnected.");
    /* eslint-enable obsidianmd/ui/sentence-case */
  }

  private async addAzureDevOpsSettings(containerElement: HTMLElement): Promise<void> {
    /* eslint-disable obsidianmd/ui/sentence-case -- Azure DevOps product names in settings */

    new Setting(containerElement).setName("Azure DevOps").setHeading();

    const settings = await this.plugin.loadSettings();

    containerElement.createEl("p", {
      text: "Azure DevOps sync uses Personal Access Token (PAT) mode. Enter organisation, project, and PAT below, then run Manual sync.",
      cls: "setting-item-description",
    });

    const organizationValue = settings.azureDevOpsOrganization ?? "";
    const { input: organizationInput, errorElement: organizationError } = this.createTextSetting(
      containerElement,
      "Organisation name",
      "Azure DevOps organisation URL segment (for example, the name in https://dev.azure.com/your-org) or paste a full board URL.",
      organizationValue,
      "your-org",
    );

    organizationInput.onChange(async (value) => {
      const parsedUrl = parseAzureDevOpsUrlSegments(value);
      const normalized = parsedUrl?.organization ?? normaliseAzureDevOpsOrganizationInput(value);
      if (normalized.length === 0) {
        organizationError.setText("Organisation name cannot be empty.");
        await this.plugin.updateSettings({ azureDevOpsOrganization: "" });
        return;
      }

      organizationError.setText("");
      if (normalized !== value.trim()) {
        organizationInput.setValue(normalized);
      }
      const projectNameFromUrl = parsedUrl?.projectName;
      await this.plugin.updateSettings({
        azureDevOpsOrganization: normalized,
        ...(projectNameFromUrl === undefined ? {} : { azureDevOpsProjectName: projectNameFromUrl }),
      });
      if (projectNameFromUrl !== undefined) {
        projectNameInput.setValue(projectNameFromUrl);
      }
    });

    const { input: projectNameInput, errorElement: projectNameError } = this.createTextSetting(
      containerElement,
      "Project name",
      "Required for PAT mode. Use the project segment from URL (for example, My Test Project).",
      settings.azureDevOpsProjectName ?? "",
      "My Test Project",
    );
    projectNameInput.onChange(async (value) => {
      const normalized = decodeURIComponent(value.trim());
      if (normalized.length === 0) {
        projectNameError.setText("Project name cannot be empty.");
        await this.plugin.updateSettings({ azureDevOpsProjectName: "" });
        return;
      }

      projectNameError.setText("");
      await this.plugin.updateSettings({ azureDevOpsProjectName: normalized });
    });

    const { input: patInput } = this.createTextSetting(
      containerElement,
      "Personal access token (PAT)",
      "PAT must include Work Items (Read) scope.",
      settings.azureDevOpsPersonalAccessToken,
      "Paste PAT token",
    );
    patInput.inputEl.type = "password";
    patInput.onChange(async (value) => {
      await this.plugin.updateSettings({ azureDevOpsPersonalAccessToken: value.trim() });
    });

    new Setting(containerElement)
      .setName("PAT mode")
      .setDesc(
        settings.azureDevOpsPersonalAccessToken.trim().length === 0
          ? "No PAT set yet. Add PAT with Work Items (Read) scope."
          : "PAT is configured. Use Manual sync to fetch assigned work items.",
      );

    /* eslint-enable obsidianmd/ui/sentence-case */
  }

  private async addFirefoxBookmarksSettings(containerElement: HTMLElement): Promise<void> {
    /* eslint-disable obsidianmd/ui/sentence-case -- Firefox product names in settings */
    new Setting(containerElement).setName("Firefox Bookmarks").setHeading();

    if (!Platform.isDesktopApp) {
      containerElement.createEl("p", {
        text: "Firefox Bookmarks sync is available on Obsidian desktop only.",
        cls: "setting-item-description",
      });
      return;
    }

    const settings = await this.plugin.loadSettings();
    const { firefoxBookmarks } = settings;

    const enableSetting = new Setting(containerElement);
    if (firefoxBookmarks === undefined) {
      enableSetting
        .setName("Firefox Bookmarks sync disabled")
        .setDesc("Enable syncing bookmarks from a local Firefox profile into your vault.")
        .addButton((button) =>
          button.setButtonText("Enable").onClick(async () => {
            await this.plugin.updateSettings({
              firefoxBookmarks: {
                profilePath: "",
                resolvedProfilePath: "",
                availableFolders: [],
                selectedFolderGuids: [],
              },
            });
            await this.display();
          }),
        );
      return;
    }

    enableSetting
      .setName("Firefox Bookmarks sync enabled")
      .setDesc("Disable to stop syncing Firefox bookmarks.")
      .addButton((button) =>
        button
          .setButtonText("Disable")
          .setWarning()
          .onClick(async () => {
            await this.plugin.updateSettings({ firefoxBookmarks: undefined });
            new Notice("Firefox Bookmarks sync disabled.");
            await this.display();
          }),
      );

    const profilePathSetting = this.createTextSetting(
      containerElement,
      "Firefox profile path",
      "Optional manual path to a Firefox profile directory. Leave empty to auto-detect the default profile.",
      firefoxBookmarks.profilePath,
      "e.g., /home/user/.mozilla/firefox/abc123.default-release",
    );

    profilePathSetting.input.onChange(async (value) => {
      const freshSettings = await this.plugin.loadSettings();
      if (freshSettings.firefoxBookmarks === undefined) {
        return;
      }
      await this.plugin.updateSettings({
        firefoxBookmarks: {
          ...freshSettings.firefoxBookmarks,
          profilePath: value.trim(),
        },
      });
    });

    if (firefoxBookmarks.resolvedProfilePath.length > 0) {
      new Setting(containerElement)
        .setName("Resolved profile path")
        .setDesc(firefoxBookmarks.resolvedProfilePath)
        .setDisabled(true);
    }

    new Setting(containerElement)
      .setName("Refresh bookmark folders")
      .setDesc("Load bookmark folders from the selected Firefox profile.")
      .addButton((button) =>
        button.setButtonText("Refresh folders").onClick(async () => {
          await this.refreshFirefoxBookmarkFolders(containerElement);
        }),
      );

    await this.addFirefoxBookmarkFolderSelector(containerElement, firefoxBookmarks);
    /* eslint-enable obsidianmd/ui/sentence-case */
  }

  private async refreshFirefoxBookmarkFolders(_containerElement: HTMLElement): Promise<void> {
    /* eslint-disable obsidianmd/ui/sentence-case -- Firefox product names in notices */
    const settings = await this.plugin.loadSettings();
    const { firefoxBookmarks } = settings;
    if (firefoxBookmarks === undefined) {
      return;
    }

    try {
      const pluginDirectory = resolvePluginDirectory(this.app, this.plugin.manifest);
      const { profileDirectory, folders } = await fetchFirefoxBookmarkFolders(
        firefoxBookmarks.profilePath,
        pluginDirectory,
      );

      const availableGuids = new Set(folders.map((folder) => folder.guid));
      const cleanedSelectedGuids = firefoxBookmarks.selectedFolderGuids.filter((guid) =>
        availableGuids.has(guid),
      );

      await this.plugin.updateSettings({
        firefoxBookmarks: {
          ...firefoxBookmarks,
          resolvedProfilePath: profileDirectory,
          availableFolders: folders,
          selectedFolderGuids: cleanedSelectedGuids,
        },
      });

      new Notice(`Loaded ${folders.length} bookmark folder(s) from Firefox.`);
      await this.display();
    } catch (error) {
      if (error instanceof FirefoxBookmarksError) {
        console.error(
          `Failed to refresh Firefox bookmark folders: [${error.userMessage}].`,
          error.cause,
        );
        new Notice(error.userMessage);
        return;
      }
      console.error(`Failed to refresh Firefox bookmark folders: [${formatLogError(error)}].`);
      new Notice("Failed to load Firefox bookmark folders.");
    }
    /* eslint-enable obsidianmd/ui/sentence-case */
  }

  private async addFirefoxBookmarkFolderSelector(
    containerElement: HTMLElement,
    firefoxBookmarks: NonNullable<PluginSettings["firefoxBookmarks"]>,
  ): Promise<void> {
    /* eslint-disable obsidianmd/ui/sentence-case -- Firefox folder picker UI */
    this.addSettingsSubheading(containerElement, "Select bookmark folders to sync");

    let selectedFolderGuids = [...firefoxBookmarks.selectedFolderGuids];
    let searchQuery = "";
    const availableFolders = firefoxBookmarks.availableFolders;
    const folderByGuid = new Map(availableFolders.map((folder) => [folder.guid, folder]));

    const folderContainer = containerElement.createDiv({
      cls: "firefox-bookmarks-folder-selector",
    });

    if (availableFolders.length === 0) {
      folderContainer.createEl("p", {
        text: "No bookmark folders loaded. Click Refresh folders above.",
        cls: "setting-item-description",
      });
    } else {
      // DOM order: selected → search → results → count (search Setting must not append after results).
      const selectedContainer = folderContainer.createDiv({
        cls: "firefox-bookmarks-selected-section",
      });
      const searchContainer = folderContainer.createDiv({
        cls: "firefox-bookmarks-search-section",
      });
      const searchResultsContainer = folderContainer.createDiv({
        cls: "firefox-bookmarks-results-section",
      });
      const countElement = folderContainer.createEl("p", {
        cls: "setting-item-description firefox-bookmarks-selection-count",
      });

      const renderSelectedFolders = () => {
        selectedContainer.empty();

        const staleCount = selectedFolderGuids.filter((guid) => !folderByGuid.has(guid)).length;
        if (staleCount > 0) {
          selectedContainer.createEl("p", {
            text: `${staleCount} selected folder(s) were not found. Refresh folders or remove them.`,
            cls: "setting-item-description mod-warning",
          });
        }

        selectedContainer.createEl("p", {
          text: "Selected folders (subfolders are included recursively):",
          cls: "setting-item-description",
        });

        if (selectedFolderGuids.length === 0) {
          selectedContainer.createEl("p", {
            text: "None selected yet. Search below to add folders.",
            cls: "setting-item-description",
          });
          return;
        }

        const selectedList = selectedContainer.createDiv({
          cls: "firefox-bookmarks-selected-list",
        });
        for (const guid of selectedFolderGuids) {
          const folder = folderByGuid.get(guid);
          const row = selectedList.createDiv({ cls: "firefox-bookmarks-selected-row" });
          row.createSpan({
            text:
              folder === undefined
                ? `${guid} (not found — refresh folders)`
                : firefoxFolderLabel(folder),
            cls:
              folder === undefined
                ? "firefox-bookmarks-selected-label is-missing"
                : "firefox-bookmarks-selected-label",
          });
          const removeButton = row.createEl("button", {
            text: "Remove",
            cls: "mod-warning firefox-bookmarks-remove-button",
          });
          removeButton.addEventListener("click", async () => {
            await updateSelected(
              selectedFolderGuids.filter((selectedGuid) => selectedGuid !== guid),
            );
          });
        }
      };

      const renderSearchResults = () => {
        searchResultsContainer.empty();
        const { matches, totalMatches, truncated, rawMatchCount } = searchFirefoxBookmarkFolders(
          availableFolders,
          searchQuery,
        );

        if (searchQuery.trim().length === 0) {
          searchResultsContainer.createEl("p", {
            text: "Type a folder name (for example: recent). Selecting a folder syncs its subfolders too, so you usually only need the parent.",
            cls: "setting-item-description",
          });
          return;
        }

        if (matches.length === 0) {
          searchResultsContainer.createEl("p", {
            text: `No folders match “${searchQuery.trim()}”.`,
            cls: "setting-item-description",
          });
          return;
        }

        const nestedHidden = Math.max(0, rawMatchCount - totalMatches);
        const summaryParts = [
          truncated
            ? `Showing ${matches.length} of ${totalMatches} folders`
            : `${totalMatches} folder(s)`,
        ];
        if (nestedHidden > 0) {
          summaryParts.push(
            `${nestedHidden} nested match(es) hidden — pick the parent to include them`,
          );
        }
        searchResultsContainer.createEl("p", {
          text: `${summaryParts.join(". ")}.`,
          cls: "setting-item-description",
        });

        const resultsList = searchResultsContainer.createDiv({
          cls: "firefox-bookmarks-search-results",
        });
        for (const folder of matches) {
          const isSelected = selectedFolderGuids.includes(folder.guid);
          // Use a div row — Obsidian button styles squash full-width text in settings.
          const row = resultsList.createDiv({
            cls: `firefox-bookmarks-result-row${isSelected ? " is-selected" : ""}`,
            attr: { role: "button", tabindex: "0" },
          });
          const textBlock = row.createDiv({ cls: "firefox-bookmarks-result-text" });
          textBlock.createDiv({
            text: folder.title.length > 0 ? folder.title : "(Untitled folder)",
            cls: "firefox-bookmarks-result-title",
          });
          if (folder.path.length > 0 && folder.path !== folder.title) {
            textBlock.createDiv({
              text: folder.path,
              cls: "firefox-bookmarks-result-path",
            });
          }
          const toggleSelection = async () => {
            const newSelection = isSelected
              ? selectedFolderGuids.filter((guid) => guid !== folder.guid)
              : [...selectedFolderGuids, folder.guid];
            await updateSelected(newSelection);
          };
          row.addEventListener("click", () => {
            void toggleSelection();
          });
          row.addEventListener("keydown", (event: KeyboardEvent) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              void toggleSelection();
            }
          });
        }
      };

      const renderCount = () => {
        countElement.setText(
          `${selectedFolderGuids.length} folder(s) selected · ${availableFolders.length} available`,
        );
      };

      const updateSelected = async (newSelected: readonly string[]) => {
        selectedFolderGuids = [...newSelected];
        const freshSettings = await this.plugin.loadSettings();
        if (freshSettings.firefoxBookmarks === undefined) {
          return;
        }
        await this.plugin.updateSettings({
          firefoxBookmarks: {
            ...freshSettings.firefoxBookmarks,
            selectedFolderGuids: [...selectedFolderGuids],
          },
        });
        renderSelectedFolders();
        renderSearchResults();
        renderCount();
      };

      renderSelectedFolders();

      new Setting(searchContainer)
        .setName("Search folders")
        .setDesc(
          "Search by folder name. Nested matches under a hit are hidden — select the parent to sync it and all subfolders.",
        )
        .addText((text) => {
          text.setPlaceholder("For example: recent");
          text.setValue(searchQuery);
          text.inputEl.addClass("firefox-bookmarks-search-input");
          text.onChange((value) => {
            searchQuery = value;
            renderSearchResults();
          });
        });

      renderSearchResults();
      renderCount();
    }
    /* eslint-enable obsidianmd/ui/sentence-case */
  }

  private async addGoogleTasksListSelector(containerElement: HTMLElement) {
    const { googleTasks } = await this.plugin.loadSettings();
    if (googleTasks === undefined) {
      return;
    }

    this.addSettingsSubheading(containerElement, "Select task lists to sync");

    let selectedListIds: readonly string[] = [...(googleTasks.selectedListIds ?? [])];

    const listContainer = containerElement.createDiv({ cls: "google-tasks-list-selector" });

    const updateSelected = async (newSelected: readonly string[]) => {
      selectedListIds = [...newSelected];
      const freshSettings = await this.plugin.loadSettings();
      if (freshSettings.googleTasks !== undefined) {
        await this.plugin.updateSettings({
          googleTasks: {
            ...freshSettings.googleTasks,
            selectedListIds: [...selectedListIds],
          },
        });
      }
    };

    const createListDropdown = (
      lists: readonly GoogleTasksList[],
      currentSelection: readonly string[],
    ) => {
      listContainer.empty(); // clear existing content

      if (lists.length === 0) {
        listContainer.createEl("p", {
          text: "No task lists found.",
          cls: "setting-item-description",
        });
        return;
      }

      // Add clear instructions
      listContainer.createEl("p", {
        text: "Click lists to select them for syncing:",
        cls: "setting-item-description",
      });

      // Create toggle buttons container
      const toggleContainer = listContainer.createDiv("google-tasks-toggle-container");

      lists.forEach((list) => {
        const isSelected = currentSelection.includes(list.id);

        const button = toggleContainer.createEl("button", {
          text: list.title,
          cls: `google-tasks-toggle-button${isSelected ? " is-selected" : ""}`,
        });

        button.addEventListener("click", async () => {
          const wasSelected = selectedListIds.includes(list.id);
          let newSelection: string[];

          if (wasSelected) {
            // Remove from selection
            newSelection = selectedListIds.filter((id) => id !== list.id);
            button.removeClass("is-selected");
          } else {
            // Add to selection
            newSelection = [...selectedListIds, list.id];
            button.addClass("is-selected");
          }

          // Update count display
          countElement.setText(`${newSelection.length} of ${lists.length} lists selected`);

          // Save to settings (this will update the selectedListIds variable)
          await updateSelected(newSelection);
        });
      });

      // Show selection count below the buttons
      const countElement = listContainer.createEl("p", {
        text: `${currentSelection.length} of ${lists.length} lists selected`,
        cls: "setting-item-description google-tasks-selection-count",
      });
    };

    // Initialise with cached lists first
    createListDropdown(googleTasks.availableLists ?? [], selectedListIds);

    // Then refresh lists from Google API
    try {
      // Ensure access token is valid before fetching lists
      let accessToken: string;
      try {
        const { credentials: token } = googleTasks;
        if (token.expiryDate < Date.now()) {
          const refreshed = await GoogleAuth.refreshAccessToken(
            this.config.googleClientId,
            token.refreshToken,
          );

          // Update settings with refreshed token
          const freshSettings = await this.plugin.loadSettings();
          if (freshSettings.googleTasks !== undefined) {
            await this.plugin.updateSettings({
              googleTasks: {
                ...freshSettings.googleTasks,
                credentials: {
                  ...freshSettings.googleTasks.credentials,
                  accessToken: refreshed.accessToken,
                  expiryDate: refreshed.expiryDate,
                },
              },
            });
          }
          accessToken = refreshed.accessToken;
        } else {
          accessToken = token.accessToken;
        }
      } catch (error) {
        if (error instanceof InvalidGrantError) {
          console.warn(
            "Google Tasks refresh token has been expired or revoked. Clearing credentials...",
          );
          const freshSettings = await this.plugin.loadSettings();
          await this.plugin.updateSettings({ ...freshSettings, googleTasks: undefined });
          new AuthorizationExpiredModal(this.app).open();
          // Refresh the display to show the disconnected state
          await this.display();
          return;
        }
        throw error;
      }

      const lists = await GoogleTasksService.fetchGoogleTasksLists(accessToken);

      // Load fresh settings to check if available lists have changed
      const freshSettingsForUpdate = await this.plugin.loadSettings();

      // Clean up selected list IDs - remove any that no longer exist
      const availableListIds = new Set(lists.map((list) => list.id));
      const cleanedSelectedIds = selectedListIds.filter((id) => availableListIds.has(id));

      // Update Google Tasks settings with fresh data
      if (freshSettingsForUpdate.googleTasks !== undefined) {
        await this.plugin.updateSettings({
          googleTasks: {
            ...freshSettingsForUpdate.googleTasks,
            availableLists: lists,
            selectedListIds: cleanedSelectedIds,
          },
        });

        // Reload selection from updated settings to keep closure variable in sync
        const updatedSettings = await this.plugin.loadSettings();
        if (updatedSettings.googleTasks?.selectedListIds !== undefined) {
          selectedListIds = [...updatedSettings.googleTasks.selectedListIds];
        }
      }

      // Re-create dropdown with fresh data and cleaned selection
      createListDropdown(lists, cleanedSelectedIds);
    } catch (error) {
      console.error(`Failed to refresh task lists. Error: [${formatLogError(error)}].`);
      listContainer.createEl("p", {
        text: "Failed to load task lists. Check your connection and try refreshing.",
        cls: "setting-item-description mod-warning",
      });
    }
  }

  /**
   * Subsection label under an integration heading (visually demoted vs setHeading sections).
   */
  private addSettingsSubheading(containerElement: HTMLElement, name: string): void {
    new Setting(containerElement).setName(name).setHeading().setClass("syncer-setting-subheading");
  }

  /**
   * Creates a consistent text setting with an attached error element.
   */
  private createTextSetting(
    containerElement: HTMLElement,
    name: string,
    description: string,
    initialValue: string,
    placeholder?: string,
  ): { input: TextComponent; errorElement: HTMLElement } {
    const setting = new Setting(containerElement).setName(name).setDesc(description);
    const input = new TextComponent(setting.controlEl);
    if (placeholder !== undefined) {
      input.setPlaceholder(placeholder);
    }
    input.setValue(initialValue);

    const errorElement = setting.descEl.createDiv({ cls: "setting-item-description" });
    return { input, errorElement };
  }
}
