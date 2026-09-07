import { DEFAULT_FORMAT } from "./constants";
import { hasDotDotSegment } from "./paths";
import { type Granularity, granularities, type Settings } from "./types";

export function getFormat(
  settings: Settings,
  granularity: Granularity,
): string {
  return (
    settings.granularities[granularity].format || DEFAULT_FORMAT[granularity]
  );
}

export function getPossibleFormats(
  settings: Settings,
  granularity: Granularity,
): string[] {
  const format = settings.granularities[granularity].format;
  if (!format) return [DEFAULT_FORMAT[granularity]];

  // `[^/]*` matches the empty string at minimum, so exec never returns null.
  // For a format with no "/" the partial equals the format, and handing moment
  // the same candidate twice is only noise.
  const partialFormat = /[^/]*$/.exec(format)?.[0] ?? format;
  return partialFormat === format ? [format] : [format, partialFormat];
}

export function getEnabledGranularities(settings: Settings): Granularity[] {
  return granularities.filter((g) => settings.granularities[g].enabled);
}

export function removeEscapedCharacters(format: string): string {
  const withoutBrackets = format.replace(/\[[^\]]*\]/g, "");
  return withoutBrackets.replace(/\\./g, "");
}

export function getBasename(format: string): string {
  const isTemplateNested = format.indexOf("/") !== -1;
  return isTemplateNested ? (format.split("/").pop() ?? "") : format;
}

export function isValidFilename(filename: string): boolean {
  const illegalRe = /[?<>\\:*|"]/g;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional filename validation
  const controlRe = /[\x00-\x1f\x80-\x9f]/g;
  const reservedRe = /^\.+$/;
  const windowsReservedRe = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

  return (
    !illegalRe.test(filename) &&
    !controlRe.test(filename) &&
    !reservedRe.test(filename) &&
    !windowsReservedRe.test(filename)
  );
}

export function validateFormat(
  format: string,
  granularity: Granularity,
): string {
  if (!format) return "";
  if (!isValidFilename(format)) return "Format contains illegal characters";

  // Checked on the formatted sample, not the format: unrecognized tokens pass
  // through literally, so "[..]/YYYY" only reveals its ".." once rendered.
  const testFormattedDate = window.moment().format(format);
  if (hasDotDotSegment(testFormattedDate)) {
    return "Format would place notes outside the vault";
  }

  if (granularity === "day") {
    const parsedDate = window.moment(testFormattedDate, format, true);
    if (!parsedDate.isValid()) return "Failed to parse format";
  }
  return "";
}

function isMissingRequiredTokens(format: string): boolean {
  const base = getBasename(format).replace(/\[[^\]]*\]/g, "");
  return (
    !["M", "D"].every((t) => base.includes(t)) ||
    !(base.includes("Y") || base.includes("y"))
  );
}

/**
 * True when a nested daily format leaves too little in the last path segment
 * to identify a date on its own — "YYYY/MM/DD" gives a basename of "DD", so
 * the date has to be read back out of the surrounding directories.
 *
 * Deliberately does no moment work. This is called once per file per enabled
 * granularity during NoteCache.initialize's folder walk, which re-runs on
 * every settings change that touches indexing.
 */
export function isFragileBasename(
  format: string,
  granularity: Granularity,
): boolean {
  return (
    granularity === "day" &&
    removeEscapedCharacters(format).includes("/") &&
    isMissingRequiredTokens(format)
  );
}

// Structural subset of TFile, so this module stays importable in tests.
export type PathParts = {
  path: string;
  basename: string;
  extension: string;
};

export function extractDateStringFromPath(
  file: PathParts,
  format: string,
  granularity: Granularity,
): string {
  if (isFragileBasename(format, granularity)) {
    // TFile.extension is "" for an extensionless file, and initialize()'s walk
    // does not filter by extension — slicing -(0 + 1) would eat a real
    // character of the path rather than a separator.
    const withoutExtension = file.extension
      ? file.path.slice(0, -(file.extension.length + 1))
      : file.path;
    const strippedFormat = removeEscapedCharacters(format);
    const nestingLvl = (strippedFormat.match(/\//g)?.length ?? 0) + 1;
    const pathParts = withoutExtension.split("/");
    return pathParts.slice(-nestingLvl).join("/");
  }
  return file.basename;
}
