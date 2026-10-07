import type { SettingDefinitionItem, TFile } from "obsidian";
import { DEFAULT_FORMAT } from "./constants";
import { validateFormat } from "./format";
import { type Granularity, granularities, type Settings } from "./types";

/**
 * A field's verdict. A `blocking` value is rejected by the control and never
 * stored — it would corrupt note resolution or escape the vault. Anything else
 * is advisory: the value is stored, so a folder can be configured before the
 * note that creates it, and the period's page entry carries a warning.
 */
export type Validation = { error: string; blocking: boolean };

export const valid: Validation = { error: "", blocking: false };
export const warn = (error: string): Validation => ({ error, blocking: false });
export const reject = (error: string): Validation => ({
  error,
  blocking: true,
});

/** The checks that need the vault, injected so this module stays importable in tests. */
export interface SettingsChecks {
  folder(value: string): Validation;
  template(value: string): Validation;
}

type Field = "enabled" | "format" | "folder" | "templatePath";
const FIELDS: readonly Field[] = [
  "enabled",
  "format",
  "folder",
  "templatePath",
];

const LABELS: Record<Granularity, string> = {
  day: "Daily notes",
  week: "Weekly notes",
  month: "Monthly notes",
  year: "Yearly notes",
};

/** A control key names one field of one period: `week.format`. */
export function settingKey(granularity: Granularity, field: Field): string {
  return `${granularity}.${field}`;
}

export function parseSettingKey(
  key: string,
): { granularity: Granularity; field: Field } | null {
  const [granularity, field] = key.split(".");
  return granularities.includes(granularity as Granularity) &&
    FIELDS.includes(field as Field)
    ? { granularity: granularity as Granularity, field: field as Field }
    : null;
}

const blockingError = (check: Validation) =>
  check.blocking ? check.error : undefined;

/**
 * The settings tab as data (Obsidian 1.13 declarative settings, #335): one page
 * per period. The page entry shows the period's format and folder, and a
 * warning when its folder or template does not exist yet.
 */
export function settingDefinitions(
  settings: Settings,
  checks: SettingsChecks,
): SettingDefinitionItem[] {
  return granularities.map((granularity) => {
    const config = () => settings.granularities[granularity];
    const enabled = () => config().enabled;
    const advisory = () =>
      [
        checks.folder(config().folder),
        checks.template(config().templatePath ?? ""),
      ]
        .map((c) => c.error)
        .filter(Boolean);

    return {
      type: "page" as const,
      name: LABELS[granularity],
      displayValue: () =>
        enabled()
          ? `${config().format || DEFAULT_FORMAT[granularity]} · ${config().folder || "/"}`
          : "Off",
      status: () => (enabled() && advisory().length > 0 ? "warning" : null),
      items: [
        {
          name: "Enabled",
          control: {
            type: "toggle" as const,
            key: settingKey(granularity, "enabled"),
          },
        },
        {
          name: "Format",
          desc: "Moment.js date format string.",
          visible: enabled,
          control: {
            type: "text" as const,
            key: settingKey(granularity, "format"),
            placeholder: DEFAULT_FORMAT[granularity],
            validate: (value: string) =>
              validateFormat(value, granularity) || undefined,
          },
        },
        {
          name: "Folder",
          desc:
            checks.folder(config().folder).error || "Where these notes live.",
          visible: enabled,
          control: {
            type: "folder" as const,
            key: settingKey(granularity, "folder"),
            includeRoot: true,
            validate: (value: string) => blockingError(checks.folder(value)),
          },
        },
        {
          name: "Template",
          desc:
            checks.template(config().templatePath ?? "").error ||
            "Note used to fill a new note.",
          visible: enabled,
          control: {
            type: "file" as const,
            key: settingKey(granularity, "templatePath"),
            filter: (file: TFile) => file.extension === "md",
            validate: (value: string) => blockingError(checks.template(value)),
          },
        },
      ],
    };
  });
}
