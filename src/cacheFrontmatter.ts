import { getEnabledGranularities, getFormat } from "./format";
import { isInFolder } from "./paths";
import type { CacheEntry, Granularity, Settings } from "./types";

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
 * Pure core of NoteCache's frontmatter matching: given a file path, the current
 * settings and a reader for that file's frontmatter, compute the CacheEntry to
 * store — or null when no enabled granularity claims the file.
 *
 * Every enabled granularity is tried. A property that is present but unusable
 * is reported and skipped rather than taken as the answer, so a file carrying
 * `day: junk` alongside `week: 2026-W37` is still indexed as a week note.
 */
export function resolveFrontmatterEntry(
  filePath: string,
  settings: Settings,
  read: (granularity: Granularity) => unknown,
): CacheEntry | null {
  for (const granularity of getEnabledGranularities(settings)) {
    const folder = settings.granularities[granularity].folder;
    if (!isInFolder(filePath, folder)) continue;

    const raw = read(granularity);
    if (raw === undefined || raw === null || raw === "") continue;

    const dateString = asDateString(raw);
    if (dateString === null) {
      refuse(filePath, granularity, raw, "is not a date value");
      continue;
    }

    const format = getFormat(settings, granularity);
    const date = window.moment(dateString, format, true);
    if (!date.isValid()) {
      refuse(filePath, granularity, raw, `does not parse as "${format}"`);
      continue;
    }

    return { filePath, date, granularity, match: "frontmatter" };
  }
  return null;
}
