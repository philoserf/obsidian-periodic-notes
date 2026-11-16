import { DEFAULT_SETTINGS } from "./constants";
import { hasDotDotSegment, hasDotOnlySegment, literalizeFormat } from "./paths";
import {
  granularities,
  isWeekStart,
  type NoteConfig,
  type Settings,
} from "./types";

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
 * Formats are not round-tripped here: this runs before the locale is applied —
 * at load, and on every save, ahead of applySettings reapplying it for a new
 * week start — so a parse would check against the wrong locale, and rejecting
 * would silently reset a working format on upgrade. Only values that would
 * escape the vault are refused.
 */
export function sanitizeSettings(
  saved: unknown,
  normalizeFolder: (folder: string) => string,
): Settings {
  const settings = structuredClone(DEFAULT_SETTINGS);
  if (!isRecord(saved)) return settings;
  if (isWeekStart(saved.weekStart)) settings.weekStart = saved.weekStart;
  if (!isRecord(saved.granularities)) return settings;

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
    // Both rules, not just traversal: the settings tab refuses a dot-only
    // segment too, and a value that reaches data.json another way -- a hand
    // edit, a sync conflict, an older build -- has never been through it.
    if (!hasDotDotSegment(folder) && !hasDotOnlySegment(folder)) {
      config.folder = folder;
    }
  }

  if (typeof saved.templatePath === "string") {
    config.templatePath = saved.templatePath;
  }

  return config;
}

// Only `enabled`, `format`, `folder` and the week start decide what the cache
// indexes — the week start moves every weekly key, since keys come from
// startOf("week"). templatePath does not, so editing it must not trigger a
// rescan.
export function indexingSnapshotOf(settings: Settings): string {
  return JSON.stringify([
    settings.weekStart,
    granularities.map((g) => {
      const { enabled, format, folder } = settings.granularities[g];
      return [enabled, format, folder];
    }),
  ]);
}
