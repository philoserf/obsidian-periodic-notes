import {
  extractDateStringFromPath,
  getEnabledGranularities,
  getPossibleFormats,
  type PathParts,
} from "./format";
import type { CacheEntry, Settings } from "./types";

/**
 * Pure core of NoteCache.resolve(): given a file's path parts, the current
 * settings, and any existing index entry for the path, compute the
 * CacheEntry to store — or null when the file is not a periodic note.
 * Frontmatter matches win: a path already indexed via frontmatter is never
 * re-resolved by filename.
 */
export function resolveEntry(
  file: PathParts,
  settings: Settings,
  existing: CacheEntry | null,
): CacheEntry | null {
  if (existing && existing.match === "frontmatter") return null;

  for (const granularity of getEnabledGranularities(settings)) {
    const folder = settings.granularities[granularity].folder || "/";
    if (!file.path.startsWith(folder === "/" ? "" : `${folder}/`)) continue;

    const formats = getPossibleFormats(settings, granularity);
    const dateInput = extractDateStringFromPath(file, formats[0], granularity);
    const date = window.moment(dateInput, formats, true);
    if (date.isValid()) {
      return { filePath: file.path, date, granularity, match: "filename" };
    }
  }
  return null;
}
