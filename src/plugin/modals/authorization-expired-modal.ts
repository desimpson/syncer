import { type App, Modal, Setting } from "obsidian";

/**
 * A modal dialog that informs the user their account authorization has expired
 * and needs to be reconnected for a specific integration.
 *
 * Copy names both Syncer and the integration so users know which settings to open.
 */
export class AuthorizationExpiredModal extends Modal {
  /**
   * @param app - Obsidian app instance
   * @param integrationName - Display name (e.g. `"Microsoft To Do"`)
   */
  public constructor(
    app: App,
    private readonly integrationName: string,
  ) {
    super(app);
  }

  /** Renders the expired-authorization message and OK button. */
  public override onOpen(): void {
    const { contentEl } = this;

    contentEl.empty();
    new Setting(contentEl).setName("Authorization expired").setHeading();

    contentEl.createEl("p", {
      text: `Your ${this.integrationName} authorization in Syncer has expired and cannot be refreshed. Open Syncer settings and reconnect ${this.integrationName}.`,
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

  /** Clears modal content when closed. */
  public override onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
  }
}
