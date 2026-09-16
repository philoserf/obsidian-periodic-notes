import {
  AbstractInputSuggest,
  type App,
  type TFile,
  type TFolder,
} from "obsidian";

// Near where Obsidian's own suggesters land; the exact value does not matter.
const MAX_SUGGESTIONS = 50;

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
    const matches = this.getAll().filter((item) =>
      item.path.toLowerCase().contains(lowerQuery),
    );
    // Capped, because an empty query matches everything: the field is empty
    // when the user first focuses it, so an uncapped list offered the entire
    // vault. Prefix matches sort first so the cap keeps the useful entries
    // rather than whichever fifty the vault walk happened to reach.
    matches.sort((a, b) => {
      const aPrefix = a.path.toLowerCase().startsWith(lowerQuery);
      const bPrefix = b.path.toLowerCase().startsWith(lowerQuery);
      if (aPrefix !== bPrefix) return aPrefix ? -1 : 1;
      return 0;
    });
    return matches.slice(0, MAX_SUGGESTIONS);
  }

  renderSuggestion(item: T, el: HTMLElement): void {
    el.setText(item.path);
  }
}
