import type { TFile } from "obsidian";
import { TextInputSuggest } from "@/plugin/suggesters/text-input-suggest";

/**
 * A text input suggestion component for Obsidian files.
 *
 * Extends `TextInputSuggest` to provide autocomplete suggestions
 * for Markdown files in the vault based on the user's input.
 *
 * @credit [Period Notes Obsidian plugin](
 * https://github.com/liamcain/obsidian-periodic-notes/blob/a8aa7e4e368ac344282b17e381b9101af12af0d1/src/ui/file-suggest.ts#L5)
 */
export class FileSuggest extends TextInputSuggest<TFile> {
  /**
   * Returns a filtered list of Markdown files whose paths include the input
   * string.
   *
   * @param inputString - The current user input to filter suggestions
   * @returns An array of matching `TFile` objects
   */
  public getSuggestions(inputString: string): TFile[] {
    const files = this.app.vault.getMarkdownFiles();
    const lower = inputString.toLowerCase();

    return files.filter((file) => file.path.toLowerCase().includes(lower));
  }

  /**
   * Renders a suggestion item by setting its text content to the file path.
   *
   * @param file - The file to render as a suggestion
   * @param element - The HTMLElement to render the suggestion into
   */
  public renderSuggestion(file: TFile, element: HTMLElement): void {
    element.setText(file.path);
  }

  /**
   * Handles selection of a suggestion by updating the input value and closing
   * suggestions.
   *
   * @param file - The selected file suggestion
   */
  public selectSuggestion(file: TFile): void {
    this.inputEl.value = file.path;
    this.inputEl.trigger("input");
    this.close();
  }
}
