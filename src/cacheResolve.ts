import { extractDateStringFromPath, getFormat, type PathParts } from "./format";
import { isInFolder } from "./paths";
import {
  type CacheEntry,
  type Granularity,
  getEnabledGranularities,
  type Settings,
} from "./types";

/**
 * Coerce a frontmatter value into something moment can parse. YAML types the
 * obvious `year: 2026` as a number and `day: [2026-09-07]` as a list, so a
 * strict `typeof === "string"` check rejects the values users actually write.
 * Returns null for anything with no sensible reading as a date.
 */
function asDateString(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (Array.isArray(value) && value.length === 1) return asDateString(value[0]);
  return null;
}

function refuse(
  filePath: string,
  granularity: Granularity,
  value: unknown,
  reason: string,
): void {
  console.warn(
    `[Periodic Notes] ignoring ${granularity} frontmatter in "${filePath}": ${JSON.stringify(value)} ${reason}`,
  );
}

/**
 * Every enabled granularity is tried. A property that is present but unusable
 * is reported and skipped rather than taken as the answer, so a file carrying
 * `day: junk` alongside `week: 2026-W37` is still indexed as a week note.
 */
function resolveFrontmatterEntry(
  file: PathParts,
  settings: Settings,
  read: (granularity: Granularity) => unknown,
): CacheEntry | null {
  for (const granularity of getEnabledGranularities(settings)) {
    const folder = settings.granularities[granularity].folder;
    if (!isInFolder(file.path, folder)) continue;

    const raw = read(granularity);
    if (raw === undefined || raw === null || raw === "") continue;

    const dateString = asDateString(raw);
    if (dateString === null) {
      refuse(file.path, granularity, raw, "is not a date value");
      continue;
    }

    const format = getFormat(settings, granularity);
    const date = window.moment(dateString, format, true);
    if (!date.isValid()) {
      refuse(file.path, granularity, raw, `does not parse as "${format}"`);
      continue;
    }

    return { filePath: file.path, date, granularity, match: "frontmatter" };
  }
  return null;
}

/** A path that renders from the granularity's format is the note for that date. */
function resolveFilenameEntry(
  file: PathParts,
  settings: Settings,
): CacheEntry | null {
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

/**
 * Is this file a periodic note, and for which granularity?
 *
 * Frontmatter is an explicit statement about the note's date, so it is tried
 * first; a filename that merely parses is the fallback. **This ordering is the
 * precedence rule.** It used to be reconstructed at runtime from four separate
 * mechanisms — a refusal to re-resolve, a call order, a remove-and-re-offer,
 * and a rename branch — none of which stated it. `match` records which answer
 * was taken, and CacheIndex.preferred breaks a collision the same way round.
 *
 * Creation is Markdown-only — getNoteCreationPath appends ".md", readTemplate
 * reads Markdown, the template suggester is backed by getMarkdownFiles — so
 * recognition is too. Without this guard an attachment named 2026-09-07.png
 * becomes the day note, a .canvas outranks the real .md on the lexical
 * tiebreak, and an empty non-Markdown file whose name parses gets the
 * granularity's template written into it.
 */
export function resolveFile(
  file: PathParts,
  settings: Settings,
  read: (granularity: Granularity) => unknown,
): CacheEntry | null {
  if (file.extension !== "md") return null;
  return (
    resolveFrontmatterEntry(file, settings, read) ??
    resolveFilenameEntry(file, settings)
  );
}
