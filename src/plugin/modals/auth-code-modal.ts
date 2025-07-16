import type { App } from "obsidian";
import { Modal, Setting } from "obsidian";

/**
 * Modal dialog for entering a Google OAuth authorisation code.
 *
 * TODO: Use a local web server to automatically handle the auth code
 * submission, so users don't have to copy-paste.
 */
export class AuthCodeModal extends Modal {
  private onSubmit: (code: string) => void;

  /**
   * Creates a new AuthCodeModal instance.
   *
   * @param app - The Obsidian application instance
   * @param onSubmit - Callback invoked with the entered authorisation code when
   *                   submitted
   */
  public constructor(app: App, onSubmit: (code: string) => void) {
    super(app);
    this.onSubmit = onSubmit;
  }

  /**
   * Called when the modal is opened.
   */
  public override onOpen() {
    const { contentEl: contentElement } = this;
    contentElement.createEl("h2", { text: "Enter Google Auth Code" });

    let inputElement: HTMLInputElement;

    new Setting(contentElement).setName("Authorisation Code").addText((text) => {
      inputElement = text.inputEl;
      text.setPlaceholder("Paste code here");
      inputElement.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          this.close();
          this.onSubmit(inputElement.value.trim());
        }
      });
    });

    new Setting(contentElement).addButton((button) =>
      button
        .setButtonText("Submit")
        .setCta()
        .onClick(() => {
          this.close();
          this.onSubmit(inputElement.value.trim());
        }),
    );
  }

  /**
   * Called when the modal is closed.
   */
  public override onClose() {
    this.contentEl.empty();
  }
}
