import {
  extractDateStringFromPath,
  getEnabledGranularities,
  getFormat,
  type PathParts,
} from "./format";
import { isInFolder } from "./paths";
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
    const folder = settings.granularities[granularity].folder;
    if (!isInFolder(file.path, folder)) continue;

    const format = getFormat(settings, granularity);
    const dateInput = extractDateStringFromPath(file, format);
    const date = window.moment(dateInput, format, true);
    if (date.isValid()) {
      return { filePath: file.path, date, granularity, match: "filename" };
    }
  }
  return null;
}
