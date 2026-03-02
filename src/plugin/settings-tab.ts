import { Notice, PluginSettingTab, Setting, TextComponent, type App } from "obsidian";
import { FileSuggest } from "@/plugin/suggesters/file-suggest";
import type SyncerPlugin from "@/plugin";
import { formatLogError, formatUiError } from "@/utils/error-formatters";
import type { PluginSettings, PluginConfig } from "@/plugin/types";
import { createMarkdownFilePathSchema, headingSchema, syncIntervalSchema } from "./schemas";
import { GoogleAuth, InvalidGrantError } from "@/auth";
import { GoogleTasksService } from "@/services";
import type { GoogleTasksList } from "@/services/types";
import { AuthorizationExpiredModal } from "@/plugin/modals/authorization-expired-modal";

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
  }

  private async renderExternalSourceSettings(containerElement: HTMLElement) {
    new Setting(containerElement).setName("External sources").setHeading();
    containerElement.createEl("p", {
      text: "Configure settings for the external sources you want to sync with Obsidian.",
    });
    await this.addGoogleTasksSettings(containerElement);
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
      "Path to the markdown file you want to sync external data to.",
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
        "When enabled, completing or uncompleting tasks in Obsidian will update their status in Google Tasks.",
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

    // Add completion status sync setting
    this.addSyncCompletionStatusSetting(containerElement, settings);
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

  private async addGoogleTasksListSelector(containerElement: HTMLElement) {
    const { googleTasks } = await this.plugin.loadSettings();
    if (googleTasks === undefined) {
      return;
    }

    new Setting(containerElement).setName("Select task lists to sync").setHeading();

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
