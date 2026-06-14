import { type App, Modal, Setting } from "obsidian";

/**
 * A modal dialog that informs the user their account authorization has expired
 * and needs to be reconnected.
 */
export class AuthorizationExpiredModal extends Modal {
  public constructor(app: App) {
    super(app);
  }

  public override onOpen(): void {
    const { contentEl } = this;

    contentEl.empty();
    new Setting(contentEl).setName("Authorization expired").setHeading();

    contentEl.createEl("p", {
      text: "Your account authorization has expired and cannot be refreshed. Reconnect in plugin settings.",
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
