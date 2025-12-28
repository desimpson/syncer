import { type App, Modal } from "obsidian";

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
    contentEl.createEl("h2", { text: "Google Tasks Authorization Expired" });

    const message = contentEl.createEl("p", {
      text: "Your Google Tasks authorization has expired and cannot be refreshed. Please reconnect your account in the plugin settings.",
    });
    message.style.marginBottom = "1.5em";

    const buttonContainer = contentEl.createDiv();
    buttonContainer.style.display = "flex";
    buttonContainer.style.gap = "0.5em";
    buttonContainer.style.justifyContent = "flex-end";

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
