import { DEFAULT_FORMAT } from "./constants";
import { hasDotDotSegment, literalizeFormat } from "./paths";
import { type Granularity, granularities, type Settings } from "./types";

export function getFormat(
  settings: Settings,
  granularity: Granularity,
): string {
  return (
    settings.granularities[granularity].format || DEFAULT_FORMAT[granularity]
  );
}

export function getEnabledGranularities(settings: Settings): Granularity[] {
  return granularities.filter((g) => settings.granularities[g].enabled);
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

// Structural subset of TFile, so this module stays importable in tests.
export type PathParts = {
  path: string;
  basename: string;
  extension: string;
};

/**
 * The part of a path that should parse as the date: as many trailing segments
 * as the format actually renders, with the extension stripped.
 *
 * One rule for flat and nested formats alike. A flat format renders no
 * separator, so this degenerates to the basename; a nested one takes the whole
 * rendered shape, which is what keeps the year in play when it lives in a
 * directory rather than the filename.
 *
 * Counted with literalizeFormat, not by stripping escapes: moment renders
 * "[d/]" as the literal "d/", which is a real directory separator on disk. The
 * count has to match what format() writes, for the same reason validateFormat
 * checks the rendered sample rather than the format.
 */
export function extractDateStringFromPath(
  file: PathParts,
  format: string,
): string {
  // TFile.extension is "" for an extensionless file, and initialize()'s walk
  // does not filter by extension — slicing -(0 + 1) would eat a real
  // character of the path rather than a separator.
  const withoutExtension = file.extension
    ? file.path.slice(0, -(file.extension.length + 1))
    : file.path;
  const depth = literalizeFormat(format).split("/").length;
  return withoutExtension.split("/").slice(-depth).join("/");
}
