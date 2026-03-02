import { type App, Modal, Setting } from "obsidian";

/**
 * A modal dialog that informs the user their Google Tasks authorization has expired
 * and needs to be reconnected.
 */
export class AuthorizationExpiredModal extends Modal {
  public constructor(app: App) {
    super(app);
  }

  public override onOpen(): void {
    const { contentEl } = this;

    contentEl.empty();
    // eslint-disable-next-line obsidianmd/ui/sentence-case -- product name
    new Setting(contentEl).setName("Google Tasks authorization expired").setHeading();

    contentEl.createEl("p", {
      // eslint-disable-next-line obsidianmd/ui/sentence-case -- product name
      text: "Your Google Tasks authorization has expired and cannot be refreshed. Please reconnect your account in the plugin settings.",
      cls: "syncer-modal-message",
    });

    const buttonContainer = contentEl.createDiv({ cls: "syncer-modal-button-container" });

    const okButton = buttonContainer.createEl("button", {
      text: "OK",
      cls: "mod-cta",
    });
    okButton.addEventListener("click", () => {
      this.close();
    });
  }

  public override onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
  }
}
