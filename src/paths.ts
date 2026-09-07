// Pure path helpers shared by the settings boundary, the cache's two folder
// match paths, and note creation. No obsidian import, so this stays testable:
// callers apply Obsidian's normalizePath and hand the result in.

// Obsidian's normalizePath converts backslashes to slashes, and
// ensureFolderExists does the same, so a backslash is a separator here too —
// checking only "/" would let "..\..\x" through as a single segment and let
// normalizePath turn it back into a traversal afterwards.
const SEPARATOR = /[\\/]/;

/** True when any segment of a path is exactly "..". */
export function hasDotDotSegment(path: string): boolean {
  return path.split(SEPARATOR).some((segment) => segment === "..");
}

/**
 * Renders a moment format's bracket escapes so a persisted format can be
 * checked for path segments without running moment: `[..]` yields `..`.
 * Backslashes are left alone — moment escapes with brackets only, so a
 * backslash reaches the filename intact and must stay visible to the
 * separator check. An approximation of the formatted output, used only as a
 * load-time guard; validateFormat checks the real sample.
 */
export function literalizeFormat(format: string): string {
  return format.replace(/\[([^\]]*)\]/g, "$1");
}

/** The vault root is spelled "", matching DEFAULT_CONFIG.folder — never "/". */
export function canonicalFolder(normalized: string): string {
  return normalized === "/" ? "" : normalized;
}

/** A file is in a folder when the folder is the vault root or a path prefix. */
export function isInFolder(filePath: string, folder: string): boolean {
  if (folder === "" || folder === "/") return true;
  return filePath.startsWith(`${folder}/`);
}

/**
 * Joins a folder and filename into a vault path, dropping empty and "."
 * segments. Throws rather than returning a path that escapes the vault — the
 * last line of defense before vault.createFolder/vault.create.
 */
export function buildNotePath(folder: string, filenameWithExt: string): string {
  const segments = `${folder}/${filenameWithExt}`
    .split(SEPARATOR)
    .filter((segment) => segment !== "" && segment !== ".");
  if (segments.includes("..")) {
    throw new Error(
      `Refusing to create a note outside the vault: "${folder}/${filenameWithExt}"`,
    );
  }
  return segments.join("/");
}
