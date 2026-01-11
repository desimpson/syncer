import { type App, Modal } from "obsidian";

/**
 * A confirmation modal for deleting a Google Task.
 */
export class DeleteTaskConfirmationModal extends Modal {
  private resolvePromise: ((confirmed: boolean) => void) | undefined;
  private promise: Promise<boolean>;

  public constructor(
    app: App,
    private taskTitle: string,
  ) {
    super(app);
    this.promise = new Promise<boolean>((resolve) => {
      this.resolvePromise = resolve;
    });
  }

  public override onOpen(): void {
    const { contentEl } = this;

    contentEl.empty();
    contentEl.createEl("h2", { text: "Delete Google Task?" });

    const message = contentEl.createEl("p", {
      text: `You deleted the task "${this.taskTitle}" in Obsidian. Do you want to delete it in Google Tasks as well?`,
    });
    message.style.marginBottom = "1.5em";

    const buttonContainer = contentEl.createDiv();
    buttonContainer.style.display = "flex";
    buttonContainer.style.gap = "0.5em";
    buttonContainer.style.justifyContent = "flex-end";

    const cancelButton = buttonContainer.createEl("button", { text: "No, keep in Google Tasks" });
    cancelButton.addEventListener("click", () => {
      this.resolvePromise?.(false);
      this.close();
    });

    const deleteButton = buttonContainer.createEl("button", {
      text: "Yes, delete in Google Tasks",
      cls: "mod-cta",
    });
    deleteButton.addEventListener("click", () => {
      this.resolvePromise?.(true);
      this.close();
    });
  }

  public override onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
    // If the promise hasn't been resolved yet (e.g., user closed modal via ESC),
    // resolve it as false
    if (this.resolvePromise) {
      this.resolvePromise(false);
    }
  }

  /**
   * Returns a promise that resolves to true if the user confirmed deletion,
   * false otherwise.
   */
  public waitForConfirmation(): Promise<boolean> {
    return this.promise;
  }
}
