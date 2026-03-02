import { type App, Scope, type ISuggestOwner } from "obsidian";
import { Suggest } from "@/plugin/suggesters/suggest";
import { createPopper, type Popper } from "@/utils/popper";

/**
 * Abstract base class for input-based suggestion lists.
 * Handles input events, suggestion display via Popper, and keyboard navigation.
 *
 * @template T - The type of suggestion items
 */
export abstract class TextInputSuggest<T> implements ISuggestOwner<T> {
  protected app: App;
  protected inputEl: HTMLInputElement | HTMLTextAreaElement;

  private popper: Popper | undefined;
  private readonly scope: Scope;
  private readonly suggestEl: HTMLElement;
  private readonly suggest: Suggest<T>;

  /**
   * Constructs a new TextInputSuggest instance.
   *
   * @param app - The Obsidian app instance
   * @param inputElement - The text input or textarea element to attach suggestions to
   */
  public constructor(app: App, inputElement: HTMLInputElement | HTMLTextAreaElement) {
    this.app = app;
    this.inputEl = inputElement;
    this.scope = new Scope();

    this.suggestEl = createDiv("suggestion-container");
    const suggestionContent = this.suggestEl.createDiv("suggestion");
    this.suggest = new Suggest(this, suggestionContent, this.scope);

    this.scope.register([], "Escape", this.close.bind(this));

    this.inputEl.addEventListener("input", this.onInputChanged.bind(this));
    this.inputEl.addEventListener("focus", this.onInputChanged.bind(this));
    this.inputEl.addEventListener("blur", this.close.bind(this));

    this.suggestEl.on("mousedown", ".suggestion-container", (event: MouseEvent) => {
      event.preventDefault(); // prevent blur
    });
  }

  private onInputChanged(): void {
    const input = this.inputEl.value;
    const suggestions = this.getSuggestions(input);

    if (suggestions.length === 0) {
      this.close();
      return;
    }

    this.suggest.setSuggestions(suggestions);
    this.open(document.body, this.inputEl);
  }

  private open(container: HTMLElement, inputElement: HTMLElement): void {
    this.app.keymap.pushScope(this.scope);
    container.append(this.suggestEl);

    this.popper = createPopper(inputElement, this.suggestEl);
  }

  /**
   * Closes the suggestion dropdown, clears the current suggestions,
   * destroys the Popper instance, and removes the suggestion element from the
   * DOM.
   */
  public close(): void {
    this.app.keymap.popScope(this.scope);
    this.suggest.setSuggestions([]);
    this.popper?.destroy();
    this.popper = undefined;
    this.suggestEl.detach();
  }

  /**
   * Returns the list of suggestions for a given input string.
   * Must be implemented by subclasses.
   *
   * @param inputString - The current value of the input element
   * @returns An array of suggestion items
   */
  public abstract getSuggestions(inputString: string): T[];

  /**
   * Renders a single suggestion item into a given container element.
   * Must be implemented by subclasses.
   *
   * @param item - The suggestion item to render
   * @param element - The HTML element to render the suggestion into
   */
  public abstract renderSuggestion(item: T, element: HTMLElement): void;

  /**
   * Handles the selection of a suggestion item (via click or keyboard).
   * Must be implemented by subclasses.
   *
   * @param item - The suggestion item that was selected
   * @param event - The originating mouse or keyboard event
   */
  public abstract selectSuggestion(item: T, event: MouseEvent | KeyboardEvent): void;
}
