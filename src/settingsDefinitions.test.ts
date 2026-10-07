import { describe, expect, it } from "bun:test";
import type {
  SettingDefinition,
  SettingDefinitionItem,
  SettingDefinitionPage,
} from "obsidian";
import { DEFAULT_SETTINGS } from "./constants";
import {
  parseSettingKey,
  reject,
  type SettingsChecks,
  settingDefinitions,
  settingKey,
  valid,
  warn,
} from "./settingsDefinitions";
import type { Settings } from "./types";

// The tab is data (#335), so it is tested as data: no DOM and no Obsidian.
const allValid: SettingsChecks = { folder: () => valid, template: () => valid };

function settingsWith(week: Partial<Settings["granularities"]["week"]> = {}) {
  const settings = structuredClone(DEFAULT_SETTINGS);
  Object.assign(settings.granularities.week, { enabled: true, ...week });
  return settings;
}

function page(items: SettingDefinitionItem[], name: string) {
  const found = items.find(
    (i): i is SettingDefinitionPage =>
      "type" in i && i.type === "page" && i.name === name,
  );
  if (!found) throw new Error(`no page ${name}`);
  return found;
}

function row(p: SettingDefinitionPage, name: string): SettingDefinition {
  const found = (p.items as SettingDefinition[]).find((r) => r.name === name);
  if (!found) throw new Error(`no row ${name}`);
  return found;
}

const evaluate = <T>(v: T | (() => T)) =>
  typeof v === "function" ? (v as () => T)() : v;

async function validate(r: SettingDefinition, value: string) {
  if (!("control" in r) || !r.control || !("validate" in r.control)) {
    throw new Error(`${r.name} has no validate`);
  }
  const fn = r.control.validate as (v: string) => unknown;
  return (await fn(value)) || undefined;
}

describe("settingDefinitions", () => {
  it("has one page per period", () => {
    const names = settingDefinitions(DEFAULT_SETTINGS, allValid).map(
      (p) => (p as SettingDefinitionPage).name,
    );
    expect(names).toEqual([
      "Daily notes",
      "Weekly notes",
      "Monthly notes",
      "Yearly notes",
    ]);
  });

  it("binds each row to its period's field", () => {
    const week = page(
      settingDefinitions(settingsWith(), allValid),
      "Weekly notes",
    );
    const keys = (week.items as SettingDefinition[]).map((r) =>
      "control" in r && r.control ? [r.control.key, r.control.type] : [],
    );
    expect(keys).toEqual([
      ["week.enabled", "toggle"],
      ["week.format", "text"],
      ["week.folder", "folder"],
      ["week.templatePath", "file"],
    ]);
  });

  it("summarizes the period on its page entry", () => {
    const items = settingDefinitions(
      settingsWith({ format: "GGGG-[W]WW", folder: "Journals" }),
      allValid,
    );
    expect(evaluate(page(items, "Weekly notes").displayValue)).toBe(
      "GGGG-[W]WW · Journals",
    );
    expect(evaluate(page(items, "Daily notes").displayValue)).toBe("Off");
  });

  it("warns on the page when the folder or template is missing", () => {
    const missing: SettingsChecks = {
      folder: () => warn("Folder not found in vault"),
      template: () => valid,
    };
    const items = settingDefinitions(settingsWith(), missing);
    const week = page(items, "Weekly notes");
    expect(evaluate(week.status)).toBe("warning");
    expect(row(week, "Folder").desc).toBe("Folder not found in vault");
    // A disabled period has nothing to warn about.
    expect(evaluate(page(items, "Daily notes").status)).toBeNull();
    expect(
      evaluate(
        page(settingDefinitions(settingsWith(), allValid), "Weekly notes")
          .status,
      ),
    ).toBeNull();
  });

  it("hides a disabled period's fields", () => {
    const off = page(
      settingDefinitions(settingsWith({ enabled: false }), allValid),
      "Weekly notes",
    );
    expect(evaluate(row(off, "Enabled").visible ?? true)).toBe(true);
    for (const name of ["Format", "Folder", "Template"]) {
      expect(evaluate(row(off, name).visible)).toBe(false);
    }
  });

  it("rejects a blocking folder but stores an advisory one", async () => {
    const checks: SettingsChecks = {
      folder: (v) =>
        v.startsWith("..") ? reject("outside the vault") : warn("not found"),
      template: () => valid,
    };
    const week = page(
      settingDefinitions(settingsWith(), checks),
      "Weekly notes",
    );
    expect(await validate(row(week, "Folder"), "../x")).toBe(
      "outside the vault",
    );
    expect(await validate(row(week, "Folder"), "New folder")).toBeUndefined();
  });

  it("rejects a format that would leave the vault", async () => {
    const week = page(
      settingDefinitions(settingsWith(), allValid),
      "Weekly notes",
    );
    expect(await validate(row(week, "Format"), "[..]/YYYY")).toBeTruthy();
    expect(await validate(row(week, "Format"), "GGGG-[W]WW")).toBeUndefined();
  });
});

describe("setting keys", () => {
  it("round-trips a period and field", () => {
    expect(parseSettingKey(settingKey("week", "folder"))).toEqual({
      granularity: "week",
      field: "folder",
    });
  });

  it("rejects anything else", () => {
    expect(parseSettingKey("week.color")).toBeNull();
    expect(parseSettingKey("decade.format")).toBeNull();
    expect(parseSettingKey("week")).toBeNull();
  });
});
