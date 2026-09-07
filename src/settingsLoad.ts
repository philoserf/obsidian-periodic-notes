import { DEFAULT_SETTINGS } from "./constants";
import { hasDotDotSegment, literalizeFormat } from "./paths";
import { granularities, type NoteConfig, type Settings } from "./types";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

/**
 * Pure core of PeriodicNotesPlugin.loadSettings(): loadData() returns whatever
 * plain JSON was last written, so every field is type-checked individually and
 * falls back to its own default rather than the whole sub-object being trusted.
 * Folder normalization is injected so this module stays importable in tests.
 *
 * Formats are not round-tripped here: loadSettings runs before configureLocale,
 * and rejecting on parse would silently reset a working format on upgrade. Only
 * values that would escape the vault are refused.
 */
export function sanitizeSettings(
  saved: unknown,
  normalizeFolder: (folder: string) => string,
): Settings {
  const settings = structuredClone(DEFAULT_SETTINGS);
  if (!isRecord(saved) || !isRecord(saved.granularities)) return settings;

  for (const granularity of granularities) {
    const savedConfig = saved.granularities[granularity];
    if (!isRecord(savedConfig)) continue;
    settings.granularities[granularity] = sanitizeConfig(
      savedConfig,
      settings.granularities[granularity],
      normalizeFolder,
    );
  }
  return settings;
}

function sanitizeConfig(
  saved: UnknownRecord,
  defaults: NoteConfig,
  normalizeFolder: (folder: string) => string,
): NoteConfig {
  const config: NoteConfig = { ...defaults };

  if (typeof saved.enabled === "boolean") config.enabled = saved.enabled;

  if (
    typeof saved.format === "string" &&
    !hasDotDotSegment(literalizeFormat(saved.format))
  ) {
    config.format = saved.format;
  }

  if (typeof saved.folder === "string") {
    const folder = normalizeFolder(saved.folder);
    if (!hasDotDotSegment(folder)) config.folder = folder;
  }

  if (typeof saved.templatePath === "string") {
    config.templatePath = saved.templatePath;
  }

  return config;
}
