import type { App, TextComponent } from "obsidian";
import { setIcon } from "obsidian";
import { TextInputSuggest } from "@/plugin/suggesters/text-input-suggest";

type BasePill = {
  id: string;
  title: string;
};

/**
 * A custom suggest component for managing a multi-select "pill" UI,
 * allowing users to search and select items from a list.
 * Selected items are shown as removable "pills" and persisted in the `selected` set.
 *
 * @template T - A type extending `BasePill`
 */
export class PillSuggest<T extends BasePill> extends TextInputSuggest<T> {
  private items: readonly T[];
  private selectedItemIds: readonly string[];
  private pillContainer: HTMLElement;

  /**
   * Creates a new PillSuggest instance.
   *
   * @param app - The current Obsidian App instance
   * @param input - The text input component to attach the suggester to
   * @param allItems - All possible items that can be selected
   * @param selectedItemIds - An array of item IDs representing currently selected items
   * @param pillContainer - An HTML element where selected pills will be rendered
   * @param onSelectionChange - A callback invoked whenever the selected set changes
   */
  public constructor(
    app: App,
    input: TextComponent,
    allItems: readonly T[],
    selectedItemIds: readonly string[],
    pillContainer: HTMLElement,
    private readonly onSelectionChange: (newSelectedItemIds: readonly string[]) => Promise<void>,
  ) {
    super(app, input.inputEl);
    this.items = allItems;
    this.selectedItemIds = selectedItemIds;
    this.pillContainer = pillContainer;
    this.renderSelected();
  }

  /**
   * Filters items based on the current query.
   *
   * @param query - The current user input to filter suggestions
   * @returns A list of matching, unselected items
   */
  public getSuggestions(query: string): T[] {
    const trimmed = query.trim().toLowerCase();
    if (trimmed === "") {
      return [];
    }
    return this.items.filter(
      (item) =>
        !this.selectedItemIds.includes(item.id) && item.title.toLowerCase().includes(trimmed),
    );
  }

  /**
   * Renders a single suggestion in the dropdown list.
   *
   * @param item - The suggestion item to render
   * @param element - The HTML element to render into
   */
  public renderSuggestion(item: T, element: HTMLElement): void {
    element.setText(item.title);
  }

  /**
   * Handles the selection of a suggestion.
   *
   * @param item - The item that was selected
   * @param _event - The event that triggered the selection
   */
  public selectSuggestion(item: T, _event: MouseEvent | KeyboardEvent): void {
    this.selectedItemIds = [...this.selectedItemIds, item.id];
    this.inputEl.value = "";
    this.renderSelected();
    this.notifyChange();
  }

  private notifyChange(): void {
    this.inputEl.dispatchEvent(new Event("input"));
    void this.onSelectionChange(this.selectedItemIds);
  }

  private renderSelected(): void {
    this.pillContainer.innerHTML = "";
    this.selectedItemIds
      .map((id) => this.items.find((item) => item.id === id))
      .filter((item): item is T => item !== undefined)
      .forEach((item) => this.createPill(item));
  }

  private createPill(item: T): void {
    const pill = this.pillContainer.createDiv({ cls: "pill" });
    pill.setText(item.title);

    const close = pill.createSpan({ cls: "pill-remove" });
    setIcon(close, "x");

    close.addEventListener("click", () => {
      this.selectedItemIds = this.selectedItemIds.filter((id) => id !== item.id);
      this.renderSelected();
      this.notifyChange();
    });
  }
}
