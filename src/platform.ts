import { Notice, Platform } from "obsidian";

export function isMetaPressed(e: MouseEvent | KeyboardEvent): boolean {
  return Platform.isMacOS ? e.metaKey : e.ctrlKey;
}

/**
 * The plugin's one failure report: a prefixed console line carrying the error
 * object, and a Notice the user will actually see.
 *
 * The detail clause is why this is worth sharing rather than repeating. The
 * folder-collision error from ensureFolderExists says exactly what is wrong and
 * where, which is no use in a console the user does not have open — so a message
 * is carried through when there is one, and only otherwise does the Notice point
 * at the console. That behaviour existed at one of the six sites; now it is the
 * default at all of them.
 *
 * `summary` is reused verbatim in both, so console lines stay greppable.
 */
export function reportFailure(summary: string, err: unknown): void {
  console.error(`[Periodic Notes] ${summary}`, err);
  const detail =
    err instanceof Error ? ` — ${err.message}` : ". See console for details.";
  new Notice(`Periodic Notes: ${summary}${detail}`);
}
