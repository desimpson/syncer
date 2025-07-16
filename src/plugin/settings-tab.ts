import { Notice, PluginSettingTab, Setting, TextComponent, type App } from "obsidian";
import { FileSuggest } from "@/plugin/suggesters/file-suggest";
import type ObsidianSyncerPlugin from "@/plugin";
import { fetchGoogleTasksLists } from "@/services/google/tasks";
import type { AccessToken, GoogleTasksList, GoogleUserInfo } from "@/services/google/types";
import { PillSuggest as GoogleTaskListSuggest } from "@/plugin/suggesters/pill-suggest";
import { formatLogError, formatUiError } from "@/utils/error-formatters";
import type { PluginSettings, PluginConfig } from "@/plugin/types";
import { GoogleOAuth2Service } from "@/services";
import { AuthCodeModal } from "@/plugin/modals/auth-code-modal";
import { createMarkdownFilePathSchema, headingSchema, syncIntervalSchema } from "./schemas";

/**
 * Settings tab for the Obsidian Syncer plugin.
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
    public plugin: ObsidianSyncerPlugin,
    private config: PluginConfig,
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

    containerEl.createEl("h1", { text: "Obsidian Syncer Settings" });

    await this.renderGeneralSettings(containerEl, settings);
    await this.renderExternalSourceSettings(containerEl);
  }

  private async renderGeneralSettings(containerElement: HTMLElement, settings: PluginSettings) {
    containerElement.createEl("h4", { text: "General Settings" });
    await this.addSyncIntervalSetting(containerElement, settings);
    await this.addSyncDocumentSetting(containerElement, settings);
    this.addSyncHeadingSetting(containerElement, settings);
  }

  private async renderExternalSourceSettings(containerElement: HTMLElement) {
    containerElement.createEl("h3", { text: "External Source Settings" });
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
        console.info(`Sync interval updated to [${result.data}] minutes.`);
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
      "Sync Markdown file path",
      "Path to the Markdown file you want to sync external data to.",
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
        console.info(`Sync Markdown file path set to [${result.data}].`);
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
      "Sync Heading",
      "The Markdown heading under which new Google Tasks will be inserted.",
      settings.syncHeading,
      "e.g., ## Inbox",
    );

    input.onChange(async (value) => {
      const result = headingSchema.safeParse(value);
      if (result.success) {
        await this.plugin.updateSettings({ syncHeading: result.data });
        errorElement.setText("");
        console.info(`Updated sync heading: [${result.data}].`);
      } else {
        errorElement.setText(formatUiError(result.error));
        console.warn(
          `Invalid heading format: [${value}]. Error: [${formatLogError(result.error)}].`,
        );
      }
    });
  }

  private async addGoogleTasksSettings(containerElement: HTMLElement) {
    containerElement.createEl("h4", { text: "Google Tasks Account Settings" });
    const setting = new Setting(containerElement);

    const { googleTasks } = await this.plugin.loadSettings();
    if (googleTasks === undefined) {
      setting.setName("No Google Tasks account connected");
      setting.setDesc("Connect your Google Tasks account to sync tasks.");
      setting.addButton((button) =>
        button.setButtonText("Connect").onClick(async () => {
          await this.connectGoogleTasks();
          await this.display();
        }),
      );
    } else {
      setting.setName("Connected Account");
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

    await this.addGoogleTasksListSelector(containerElement);
  }

  private async connectGoogleTasks(): Promise<void> {
    console.info("Connecting to Google Tasks...");

    try {
      console.info("Fetching Google Tasks token...");
      const scopes = ["https://www.googleapis.com/auth/tasks", "openid", "email", "profile"].join(
        " ",
      );
      const { token, userInfo } = await this.handleGoogleOAuthFlow(scopes);

      await this.plugin.updateSettings({
        googleTasks: {
          userInfo,
          token,
          availableLists: [],
          selectedListIds: [],
        },
      });

      new Notice("Google Tasks account connected successfully.");
      console.info(`Google Tasks account [${userInfo.email}] connected.`);
    } catch (error) {
      new Notice(`Failed to connect Google Tasks.`);
      console.error(`Error connecting Google Tasks: [${formatLogError(error)}].`);
    }
  }

  private async handleGoogleOAuthFlow(
    scopes: string,
  ): Promise<{ token: AccessToken; userInfo: GoogleUserInfo }> {
    const { authUrl, codeVerifier } = await GoogleOAuth2Service.createOAuthUrl(
      this.config.googleClientId,
      scopes,
    );
    window.open(authUrl, "_blank");

    return new Promise((resolve, reject) => {
      new AuthCodeModal(this.app, async (code: string) => {
        if (code.trim() === "") {
          return reject("Empty code");
        }

        try {
          const token = await GoogleOAuth2Service.exchangeOAuthCode(
            this.config.googleClientId,
            this.config.googleClientSecret,
            code,
            codeVerifier,
          );
          const { userId, email } = await GoogleOAuth2Service.getUserInfo(token.accessToken);
          const userInfo: GoogleUserInfo = { userId, email };
          resolve({ token, userInfo });
        } catch (error) {
          reject(error);
        }
      }).open();
    });
  }

  private async disconnectGoogleTasks(): Promise<void> {
    // TODO: Save the lists but grey everything out, so when the user reconnects
    // they get their previous selections back
    await this.plugin.updateSettings({ googleTasks: undefined });
    new Notice("Google Tasks account disconnected.");
  }

  private async addGoogleTasksListSelector(containerElement: HTMLElement) {
    const { googleTasks } = await this.plugin.loadSettings();
    if (googleTasks === undefined) {
      console.warn("Google Tasks not connected. Cannot add list selector.");
      return;
    }

    containerElement.createEl("h5", { text: "Select Task Lists to Sync" });

    let selectedListIds: readonly string[] = [...(googleTasks.selectedListIds ?? [])];

    const pillContainer = containerElement.createDiv({ cls: "google-tasks-pill-container" });
    const searchSetting = new Setting(containerElement).setName("Search Task Lists");

    let textComponent!: TextComponent;
    searchSetting.addText((tc) => (textComponent = tc));

    const updateSelected = async (newSelected: readonly string[]) => {
      selectedListIds = [...newSelected]; // preserve order via new array
      const freshSettings = await this.plugin.loadSettings();
      if (freshSettings.googleTasks !== undefined) {
        await this.plugin.updateSettings({
          googleTasks: {
            ...freshSettings.googleTasks,
            selectedListIds: [...selectedListIds],
          },
        });
        console.info(`Saved selected Google Task list IDs: [${selectedListIds}].`);
      }
    };

    const initSuggest = (lists: readonly GoogleTasksList[]) => {
      pillContainer.empty(); // clear old pills

      new GoogleTaskListSuggest(
        this.app,
        textComponent,
        lists,
        selectedListIds,
        pillContainer,
        updateSelected,
      );
    };

    // FIXME: Slight delay when opening settings for second time after choosing a list (?)

    // Initialise suggester with cached lists first
    initSuggest(googleTasks.availableLists ?? []);

    // Then refresh lists from Google API
    try {
      const lists = await fetchGoogleTasksLists(googleTasks.token?.accessToken ?? "");
      await this.plugin.updateSettings({ googleTasks: { ...googleTasks, availableLists: lists } });

      initSuggest(lists); // re-init with fresh data
      console.info(`Refreshed available Google Task lists: [${lists.length}] lists.`);
    } catch (error) {
      console.error(`Failed to refresh task lists. Error: [${formatLogError(error)}].`);
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
