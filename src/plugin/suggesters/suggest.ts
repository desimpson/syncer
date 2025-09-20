import type { ISuggestOwner, Scope } from "obsidian";

const wrapAround = (value: number, size: number): number => ((value % size) + size) % size;

/**
 * Generic class for managing a suggestion list in Obsidian.
 * Handles rendering suggestions, navigation via keyboard, and selection.
 *
 * @template T - The type of suggestion items
 * @credit [Period Notes Obsidian plugin](
 * https://github.com/liamcain/obsidian-periodic-notes/blob/a8aa7e4e368ac344282b17e381b9101af12af0d1/src/ui/file-suggest.ts#L5)
 */
export class Suggest<T> {
  private owner: ISuggestOwner<T>;
  private values: T[] = [];
  private suggestions: HTMLElement[] = [];
  private selectedItem = 0;
  private containerEl: HTMLElement;

  /**
   * Constructs a new Suggest instance.
   *
   * @param owner - An object implementing `ISuggestOwner` callbacks
   * @param containerElement - The DOM element to render suggestions into
   * @param scope - The keyboard event scope for navigation/selection
   */
  public constructor(owner: ISuggestOwner<T>, containerElement: HTMLElement, scope: Scope) {
    this.owner = owner;
    this.containerEl = containerElement;

    containerElement.on("click", ".suggestion-item", this.onSuggestionClick.bind(this));
    containerElement.on("mousemove", ".suggestion-item", this.onSuggestionMouseover.bind(this));

    scope.register([], "ArrowUp", (event) => {
      if (!event.isComposing) {
        this.setSelectedItem(this.selectedItem - 1, true);
        return false;
      }
      return;
    });

    scope.register([], "ArrowDown", (event) => {
      if (!event.isComposing) {
        this.setSelectedItem(this.selectedItem + 1, true);
        return false;
      }
      return;
    });

    scope.register([], "Enter", (event) => {
      if (!event.isComposing) {
        this.useSelectedItem(event);
        return false;
      }
      return;
    });
  }

  private onSuggestionClick(event: MouseEvent, element: HTMLElement): void {
    event.preventDefault();
    const item = this.suggestions.indexOf(element);
    this.setSelectedItem(item, false);
    this.useSelectedItem(event);
  }

  private onSuggestionMouseover(_event: MouseEvent, element: HTMLElement): void {
    const item = this.suggestions.indexOf(element as HTMLDivElement);
    this.setSelectedItem(item, false);
  }

  /**
   * Updates the list of suggestions and re-renders them in the container.
   * Resets the selection to the first item.
   *
   * @param values - Array of suggestion values
   */
  public setSuggestions(values: T[]): void {
    this.containerEl.empty();
    this.suggestions = values.map((value) => {
      const element = this.containerEl.createDiv("suggestion-item");
      this.owner.renderSuggestion(value, element);
      return element;
    });

    this.values = values;
    this.setSelectedItem(0, false);
  }

  private useSelectedItem(event: MouseEvent | KeyboardEvent): void {
    const currentValue = this.values[this.selectedItem];
    if (currentValue !== undefined) {
      this.owner.selectSuggestion(currentValue, event);
    }
  }

  private setSelectedItem(index: number, scrollIntoView: boolean): void {
    const normalisedIndex = wrapAround(index, this.suggestions.length);
    const previous = this.suggestions[this.selectedItem];
    const next = this.suggestions[normalisedIndex];

    previous?.removeClass("is-selected");
    next?.addClass("is-selected");

    this.selectedItem = normalisedIndex;

    if (scrollIntoView) {
      next?.scrollIntoView(false);
    }
  }
}
