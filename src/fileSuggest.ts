import {
  AbstractInputSuggest,
  type App,
  type TFile,
  type TFolder,
} from "obsidian";

/**
 * One suggester for both the Folder and Template fields — they differ only in
 * which vault lookup supplies the candidates. Selection is handled by the
 * caller through AbstractInputSuggest.onSelect: overriding selectSuggestion to
 * call setValue persists nothing, because setValue assigns inputEl.value
 * without dispatching the "input" event that Setting.addText listens for.
 */
export class PathSuggest<
  T extends TFile | TFolder,
> extends AbstractInputSuggest<T> {
  constructor(
    app: App,
    inputEl: HTMLInputElement,
    private readonly getAll: () => T[],
  ) {
    super(app, inputEl);
  }

  getSuggestions(query: string): T[] {
    const lowerQuery = query.toLowerCase();
    return this.getAll().filter((item) =>
      item.path.toLowerCase().contains(lowerQuery),
    );
  }

  renderSuggestion(item: T, el: HTMLElement): void {
    el.setText(item.path);
  }
}
