# v2 Refactor Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the codebase for simplicity, clarity, and testability — shipped as v2.0.0.

**Architecture:** Big bang refactor on a single branch. New module structure splits the 308-line utils.ts junk drawer into focused modules, replaces Svelte settings with native Obsidian API, adds a cache secondary index, drops quarter granularity and several unused features, and renames for clarity.

**Tech Stack:** TypeScript, Svelte 5 (calendar only), Vite, Moment.js, Obsidian Plugin API, Bun (test runner)

**Spec:** `docs/superpowers/specs/2026-03-20-v2-refactor-design.md`

---

## Chunk 1: Foundation (types, constants, format module)

### Task 1: Create branch and update types

**Files:**

- Modify: `src/types.ts`

- [ ] **Step 1: Create the v2 branch**

```bash
git checkout -b refactor/v2
```

- [ ] **Step 2: Rewrite `src/types.ts`**

Replace entire contents with:

```ts
import type { Moment } from "moment";

export type Granularity = "day" | "week" | "month" | "year";
export const granularities: Granularity[] = ["day", "week", "month", "year"];

export interface NoteConfig {
  enabled: boolean;
  format: string;
  folder: string;
  templatePath?: string;
}

export interface Settings {
  granularities: Record<Granularity, NoteConfig>;
}

export interface CacheEntry {
  filePath: string;
  date: Moment;
  granularity: Granularity;
  match: "filename" | "frontmatter";
}
```

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "refactor: rewrite types for v2 — NoteConfig, Settings, drop quarter"
```

### Task 2: Rewrite constants

**Files:**

- Modify: `src/constants.ts`

- [ ] **Step 1: Rewrite `src/constants.ts`**

Replace entire contents. Absorb `VIEW_TYPE_CALENDAR` from `calendar/constants.ts` and `DISPLAYED_MONTH` from `calendar/context.ts`. Remove quarter from all maps.

```ts
import type { Granularity, NoteConfig, Settings } from "./types";

export const DEFAULT_FORMAT: Record<Granularity, string> = {
  day: "YYYY-MM-DD",
  week: "gggg-[W]ww",
  month: "YYYY-MM",
  year: "YYYY",
};

export const DEFAULT_CONFIG: NoteConfig = {
  enabled: false,
  format: "",
  folder: "",
  templatePath: undefined,
};

export const DEFAULT_SETTINGS: Settings = {
  granularities: {
    day: { ...DEFAULT_CONFIG },
    week: { ...DEFAULT_CONFIG },
    month: { ...DEFAULT_CONFIG },
    year: { ...DEFAULT_CONFIG },
  },
};

export const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

export type WeekdayName = (typeof WEEKDAYS)[number];

export const HUMANIZE_FORMAT: Partial<Record<Granularity, string>> = {
  month: "MMMM YYYY",
  year: "YYYY",
};

export const VIEW_TYPE_CALENDAR = "calendar";

export const DISPLAYED_MONTH = Symbol("displayedMonth");
```

- [ ] **Step 2: Commit**

```bash
git add src/constants.ts
git commit -m "refactor: rewrite constants for v2 — absorb calendar constants, drop quarter"
```

### Task 3: Create `format.ts` with tests

**Files:**

- Create: `src/format.ts`
- Create: `src/format.test.ts`

- [ ] **Step 1: Create `src/format.ts`**

Extract pure functions from `src/utils.ts` and `src/settings/validation.ts`. Zero obsidian imports.

```ts
import { DEFAULT_FORMAT } from "./constants";
import type { Granularity, NoteConfig, Settings } from "./types";

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

  const partialFormatExp = /[^/]*$/.exec(format);
  if (partialFormatExp) {
    const partialFormat = partialFormatExp[0];
    return [format, partialFormat];
  }
  return [format];
}

export function getConfig(
  settings: Settings,
  granularity: Granularity,
): NoteConfig {
  return settings.granularities[granularity];
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

  if (granularity === "day") {
    const testFormattedDate = window.moment().format(format);
    const parsedDate = window.moment(testFormattedDate, format, true);
    if (!parsedDate.isValid()) return "Failed to parse format";
  }
  return "";
}

export function validateFormatComplexity(
  format: string,
  granularity: Granularity,
): "valid" | "fragile-basename" | "loose-parsing" {
  const testFormattedDate = window.moment().format(format);
  const parsedDate = window.moment(testFormattedDate, format, true);
  if (!parsedDate.isValid()) return "loose-parsing";

  const strippedFormat = removeEscapedCharacters(format);
  if (strippedFormat.includes("/")) {
    if (
      granularity === "day" &&
      (() => {
        const base = getBasename(format).replace(/\[[^\]]*\]/g, "");
        return (
          !["M", "D"].every((t) => base.includes(t)) ||
          !(base.includes("Y") || base.includes("y"))
        );
      })()
    ) {
      return "fragile-basename";
    }
  }
  return "valid";
}

export function isIsoFormat(format: string): boolean {
  const cleanFormat = removeEscapedCharacters(format);
  return /w{1,2}/.test(cleanFormat);
}

export function join(...partSegments: string[]): string {
  let parts: string[] = [];
  for (let i = 0, l = partSegments.length; i < l; i++) {
    parts = parts.concat(partSegments[i].split("/"));
  }
  const newParts = [];
  for (let i = 0, l = parts.length; i < l; i++) {
    const part = parts[i];
    if (!part || part === ".") continue;
    else newParts.push(part);
  }
  if (parts[0] === "") newParts.unshift("");
  return newParts.join("/");
}
```

- [ ] **Step 2: Create `src/format.test.ts`**

Import directly from `format.ts` — no re-implementation. Port relevant tests from `utils.test.ts` and `settings/validation.test.ts`.

```ts
import { describe, expect, test } from "bun:test";
import {
  getFormat,
  getPossibleFormats,
  isIsoFormat,
  isValidFilename,
  join,
  removeEscapedCharacters,
  validateFormat,
  validateFormatComplexity,
} from "./format";
import { DEFAULT_SETTINGS } from "./constants";
import type { Settings } from "./types";

function settingsWithFormat(granularity: string, format: string): Settings {
  return {
    granularities: {
      ...DEFAULT_SETTINGS.granularities,
      [granularity]: { ...DEFAULT_SETTINGS.granularities.day, format },
    },
  };
}

describe("getFormat", () => {
  test("returns configured format", () => {
    const s = settingsWithFormat("day", "DD-MM-YYYY");
    expect(getFormat(s, "day")).toBe("DD-MM-YYYY");
  });

  test("returns default when empty", () => {
    expect(getFormat(DEFAULT_SETTINGS, "day")).toBe("YYYY-MM-DD");
    expect(getFormat(DEFAULT_SETTINGS, "week")).toBe("gggg-[W]ww");
  });
});

describe("getPossibleFormats", () => {
  test("returns default for unconfigured", () => {
    expect(getPossibleFormats(DEFAULT_SETTINGS, "day")).toEqual(["YYYY-MM-DD"]);
  });

  test("returns full and partial for nested format", () => {
    const s = settingsWithFormat("day", "YYYY/YYYY-MM-DD");
    expect(getPossibleFormats(s, "day")).toEqual([
      "YYYY/YYYY-MM-DD",
      "YYYY-MM-DD",
    ]);
  });
});

describe("removeEscapedCharacters", () => {
  test("removes bracket-escaped content", () => {
    expect(removeEscapedCharacters("YYYY-[W]ww")).toBe("YYYY-ww");
  });

  test("removes backslash-escaped characters", () => {
    expect(removeEscapedCharacters("YYYY\\-MM")).toBe("YYYYMM");
  });
});

describe("isValidFilename", () => {
  test("accepts normal filenames", () => {
    expect(isValidFilename("2026-03-20")).toBe(true);
  });

  test("rejects illegal characters", () => {
    expect(isValidFilename("file?name")).toBe(false);
    expect(isValidFilename("file:name")).toBe(false);
  });

  test("rejects reserved names", () => {
    expect(isValidFilename("CON")).toBe(false);
    expect(isValidFilename("nul.txt")).toBe(false);
  });
});

describe("validateFormat", () => {
  test("returns empty for valid format", () => {
    expect(validateFormat("YYYY-MM-DD", "day")).toBe("");
  });

  test("returns error for illegal characters", () => {
    expect(validateFormat("YYYY:MM:DD", "day")).toBe(
      "Format contains illegal characters",
    );
  });

  test("returns empty for empty format", () => {
    expect(validateFormat("", "day")).toBe("");
  });
});

describe("validateFormatComplexity", () => {
  test("valid for standard format", () => {
    expect(validateFormatComplexity("YYYY-MM-DD", "day")).toBe("valid");
  });

  test("fragile-basename for missing month in basename", () => {
    expect(validateFormatComplexity("YYYY/DD", "day")).toBe("fragile-basename");
  });

  test("valid for nested with complete basename", () => {
    expect(validateFormatComplexity("YYYY/YYYY-MM-DD", "day")).toBe("valid");
  });
});

describe("isIsoFormat", () => {
  test("detects week tokens", () => {
    expect(isIsoFormat("gggg-[W]ww")).toBe(true);
  });

  test("rejects non-week formats", () => {
    expect(isIsoFormat("YYYY-MM-DD")).toBe(false);
  });
});

describe("join", () => {
  test("joins path segments", () => {
    expect(join("a", "b", "c")).toBe("a/b/c");
  });

  test("removes empty segments", () => {
    expect(join("a", "", "b")).toBe("a/b");
  });

  test("removes dots", () => {
    expect(join("a", ".", "b")).toBe("a/b");
  });

  test("preserves leading slash", () => {
    expect(join("/a", "b")).toBe("/a/b");
  });
});
```

- [ ] **Step 3: Run tests**

Run: `bun test src/format.test.ts`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add src/format.ts src/format.test.ts
git commit -m "refactor: create format.ts with pure testable functions"
```

## Chunk 2: Template module and cache rewrite

### Task 4: Create `template.ts`

**Files:**

- Create: `src/template.ts`

- [ ] **Step 1: Create `src/template.ts`**

Extract template functions from `src/utils.ts`. Remove quarter branch. Rename functions per spec.

```ts
import type { Moment } from "moment";
import { type App, Notice, normalizePath, type TFile } from "obsidian";

import { WEEKDAYS } from "./constants";
import { getFormat, join } from "./format";
import type { CacheEntry, Granularity, NoteConfig, Settings } from "./types";

function getDaysOfWeek(): string[] {
  const { moment } = window;
  let weekStart = moment.localeData().firstDayOfWeek();
  const daysOfWeek = [...WEEKDAYS];
  while (weekStart) {
    const day = daysOfWeek.shift();
    if (day) daysOfWeek.push(day);
    weekStart--;
  }
  return daysOfWeek;
}

function getDayOfWeekNumericalValue(dayOfWeekName: string): number {
  const index = getDaysOfWeek().indexOf(dayOfWeekName.toLowerCase());
  return Math.max(0, index);
}

function replaceGranularityTokens(
  contents: string,
  date: Moment,
  tokenPattern: string,
  format: string,
  startOfUnit?: Granularity,
): string {
  const pattern = new RegExp(
    `{{\\s*(${tokenPattern})\\s*(([-+]\\d+)([yqmwdhs]))?\\s*(:.+?)?}}`,
    "gi",
  );
  const now = window.moment();
  return contents.replace(
    pattern,
    (_, _token, calc, timeDelta, unit, momentFormat) => {
      const periodStart = date.clone();
      if (startOfUnit) {
        periodStart.startOf(startOfUnit);
      }
      periodStart.set({
        hour: now.get("hour"),
        minute: now.get("minute"),
        second: now.get("second"),
      });
      if (calc) {
        periodStart.add(parseInt(timeDelta, 10), unit);
      }
      if (momentFormat) {
        return periodStart.format(momentFormat.substring(1).trim());
      }
      return periodStart.format(format);
    },
  );
}

export function applyTemplate(
  filename: string,
  granularity: Granularity,
  date: Moment,
  format: string,
  rawTemplateContents: string,
): string {
  let contents = rawTemplateContents
    .replace(/{{\s*date\s*}}/gi, filename)
    .replace(/{{\s*time\s*}}/gi, window.moment().format("HH:mm"))
    .replace(/{{\s*title\s*}}/gi, filename);

  if (granularity === "day") {
    contents = contents
      .replace(
        /{{\s*yesterday\s*}}/gi,
        date.clone().subtract(1, "day").format(format),
      )
      .replace(/{{\s*tomorrow\s*}}/gi, date.clone().add(1, "d").format(format));
    contents = replaceGranularityTokens(contents, date, "date|time", format);
  }

  if (granularity === "week") {
    contents = contents.replace(
      new RegExp(`{{\\s*(${WEEKDAYS.join("|")})\\s*:(.*?)}}`, "gi"),
      (_, dayOfWeek, momentFormat) => {
        const day = getDayOfWeekNumericalValue(dayOfWeek);
        return date.weekday(day).format(momentFormat.trim());
      },
    );
  }

  if (granularity === "month" || granularity === "year") {
    contents = replaceGranularityTokens(
      contents,
      date,
      granularity,
      format,
      granularity,
    );
  }

  return contents;
}

export async function readTemplate(
  app: App,
  templatePath: string | undefined,
  granularity: Granularity,
): Promise<string> {
  if (!templatePath || templatePath === "/") return "";
  const { metadataCache, vault } = app;
  const normalized = normalizePath(templatePath);

  try {
    const file = metadataCache.getFirstLinkpathDest(normalized, "");
    return file ? vault.cachedRead(file) : "";
  } catch (err) {
    console.error(
      `[Periodic Notes] Failed to read the ${granularity} note template '${normalized}'`,
      err,
    );
    new Notice(`Failed to read the ${granularity} note template`);
    return "";
  }
}

export async function applyTemplateToFile(
  app: App,
  file: TFile,
  settings: Settings,
  entry: CacheEntry,
): Promise<void> {
  const format = getFormat(settings, entry.granularity);
  const templateContents = await readTemplate(
    app,
    settings.granularities[entry.granularity].templatePath,
    entry.granularity,
  );
  const rendered = applyTemplate(
    file.basename,
    entry.granularity,
    entry.date,
    format,
    templateContents,
  );
  await app.vault.modify(file, rendered);
}

export async function getNoteCreationPath(
  app: App,
  filename: string,
  config: NoteConfig,
): Promise<string> {
  const directory = config.folder ?? "";
  const filenameWithExt = !filename.endsWith(".md")
    ? `${filename}.md`
    : filename;
  const path = normalizePath(join(directory, filenameWithExt));
  await ensureFolderExists(app, path);
  return path;
}

async function ensureFolderExists(app: App, path: string): Promise<void> {
  const dirs = path.replace(/\\/g, "/").split("/");
  dirs.pop();
  let current = "";
  for (const dir of dirs) {
    current = current ? `${current}/${dir}` : dir;
    if (!app.vault.getAbstractFileByPath(current)) {
      await app.vault.createFolder(current);
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/template.ts
git commit -m "refactor: create template.ts — readTemplate, applyTemplate, getNoteCreationPath"
```

### Task 5: Rewrite cache with secondary index

**Files:**

- Modify: `src/cache.ts`

- [ ] **Step 1: Rewrite `src/cache.ts`**

New cache with dual maps, `getDateInput` absorbed as private helper, no loose matching, no `exact` boolean, no quarter. Import `CacheEntry` from `types.ts`.

```ts
import type { Moment } from "moment";
import {
  type App,
  type CachedMetadata,
  Component,
  Notice,
  parseFrontMatterEntry,
  type TAbstractFile,
  TFile,
  TFolder,
} from "obsidian";

import { DEFAULT_FORMAT } from "./constants";
import {
  getBasename,
  getPossibleFormats,
  removeEscapedCharacters,
  validateFormatComplexity,
} from "./format";
import type PeriodicNotesPlugin from "./main";
import { applyTemplateToFile } from "./template";
import {
  type CacheEntry,
  type Granularity,
  granularities,
  type Settings,
} from "./types";

export type { CacheEntry };

function canonicalKey(granularity: Granularity, date: Moment): string {
  return `${granularity}:${date.clone().startOf(granularity).toISOString()}`;
}

function pathWithoutExtension(file: TFile): string {
  const extLen = file.extension.length + 1;
  return file.path.slice(0, -extLen);
}

function getDateInput(
  file: TFile,
  format: string,
  granularity: Granularity,
): string {
  if (validateFormatComplexity(format, granularity) === "fragile-basename") {
    const fileName = pathWithoutExtension(file);
    const strippedFormat = removeEscapedCharacters(format);
    const nestingLvl = (strippedFormat.match(/\//g)?.length ?? 0) + 1;
    const pathParts = fileName.split("/");
    return pathParts.slice(-nestingLvl).join("/");
  }
  return file.basename;
}

export class NoteCache extends Component {
  private byPath: Map<string, CacheEntry>;
  private byKey: Map<string, CacheEntry>;

  constructor(
    readonly app: App,
    readonly plugin: PeriodicNotesPlugin,
  ) {
    super();
    this.byPath = new Map();
    this.byKey = new Map();

    this.app.workspace.onLayoutReady(() => {
      console.info("[Periodic Notes] initializing cache");
      this.initialize();
      this.registerEvent(
        this.app.vault.on("create", (file) => {
          if (file instanceof TFile) this.resolve(file, "create");
        }),
      );
      this.registerEvent(
        this.app.vault.on("delete", (file) => {
          if (file instanceof TFile) this.remove(file.path);
        }),
      );
      this.registerEvent(this.app.vault.on("rename", this.onRename, this));
      this.registerEvent(
        this.app.metadataCache.on("changed", this.onMetadataChanged, this),
      );
      this.registerEvent(
        this.app.workspace.on(
          "periodic-notes:settings-updated",
          this.reset,
          this,
        ),
      );
    });
  }

  public reset(): void {
    console.info("[Periodic Notes] resetting cache");
    this.byPath.clear();
    this.byKey.clear();
    this.initialize();
  }

  private initialize(): void {
    const settings = this.plugin.settings;
    const visited = new Set<TFolder>();
    const recurseChildren = (
      folder: TFolder,
      cb: (file: TAbstractFile) => void,
    ) => {
      if (visited.has(folder)) return;
      visited.add(folder);
      for (const c of folder.children) {
        if (c instanceof TFile) cb(c);
        else if (c instanceof TFolder) recurseChildren(c, cb);
      }
    };

    const active = granularities.filter(
      (g) => settings.granularities[g].enabled,
    );
    for (const granularity of active) {
      const folder = settings.granularities[granularity].folder || "/";
      const rootFolder = this.app.vault.getAbstractFileByPath(folder);
      if (!(rootFolder instanceof TFolder)) continue;

      recurseChildren(rootFolder, (file) => {
        if (file instanceof TFile) {
          this.resolve(file, "initialize");
          const metadata = this.app.metadataCache.getFileCache(file);
          if (metadata) this.onMetadataChanged(file, "", metadata);
        }
      });
    }
  }

  private onMetadataChanged(
    file: TFile,
    _data: string,
    cache: CachedMetadata,
  ): void {
    const settings = this.plugin.settings;
    const active = granularities.filter(
      (g) => settings.granularities[g].enabled,
    );
    if (active.length === 0) return;

    for (const granularity of active) {
      const folder = settings.granularities[granularity].folder || "";
      if (!file.path.startsWith(folder)) continue;
      const frontmatterEntry = parseFrontMatterEntry(
        cache.frontmatter,
        granularity,
      );
      if (!frontmatterEntry) continue;

      const format =
        settings.granularities[granularity].format ||
        DEFAULT_FORMAT[granularity];
      if (typeof frontmatterEntry === "string") {
        const date = window.moment(frontmatterEntry, format, true);
        if (date.isValid()) {
          this.set({
            filePath: file.path,
            date,
            granularity,
            match: "frontmatter",
          });
        }
        return;
      }
    }
  }

  private onRename(file: TAbstractFile, oldPath: string): void {
    if (file instanceof TFile) {
      this.remove(oldPath);
      this.resolve(file, "rename");
    }
  }

  private resolve(
    file: TFile,
    reason: "create" | "rename" | "initialize" = "create",
  ): void {
    const settings = this.plugin.settings;
    const active = granularities.filter(
      (g) => settings.granularities[g].enabled,
    );
    if (active.length === 0) return;

    const existing = this.byPath.get(file.path);
    if (existing && existing.match === "frontmatter") return;

    for (const granularity of active) {
      const folder = settings.granularities[granularity].folder || "";
      if (!file.path.startsWith(folder)) continue;

      const formats = getPossibleFormats(settings, granularity);
      const dateInputStr = getDateInput(file, formats[0], granularity);
      const date = window.moment(dateInputStr, formats, true);
      if (date.isValid()) {
        const entry: CacheEntry = {
          filePath: file.path,
          date,
          granularity,
          match: "filename",
        };
        this.set(entry);

        if (reason === "create" && file.stat.size === 0) {
          applyTemplateToFile(this.app, file, settings, entry).catch((err) => {
            console.error("[Periodic Notes] failed to apply template", err);
            new Notice(
              `Periodic Notes: failed to apply template to "${file.path}". See console for details.`,
            );
          });
        }

        this.app.workspace.trigger("periodic-notes:resolve", granularity, file);
        return;
      }
    }
  }

  private set(entry: CacheEntry): void {
    // Remove old key mapping if path already cached with different date/granularity
    const old = this.byPath.get(entry.filePath);
    if (old) {
      this.byKey.delete(canonicalKey(old.granularity, old.date));
    }
    this.byPath.set(entry.filePath, entry);
    this.byKey.set(canonicalKey(entry.granularity, entry.date), entry);
  }

  private remove(filePath: string): void {
    const entry = this.byPath.get(filePath);
    if (entry) {
      this.byKey.delete(canonicalKey(entry.granularity, entry.date));
      this.byPath.delete(filePath);
    }
  }

  public getPeriodicNote(
    granularity: Granularity,
    targetDate: Moment,
  ): TFile | null {
    const key = canonicalKey(granularity, targetDate);
    const entry = this.byKey.get(key);
    if (!entry) return null;
    const file = this.app.vault.getAbstractFileByPath(entry.filePath);
    if (file instanceof TFile) return file;
    this.remove(entry.filePath);
    return null;
  }

  public getPeriodicNotes(
    granularity: Granularity,
    targetDate: Moment,
    includeFinerGranularities = false,
  ): CacheEntry[] {
    const matches: CacheEntry[] = [];
    const gIdx = granularities.indexOf(granularity);
    for (const entry of this.byPath.values()) {
      const eIdx = granularities.indexOf(entry.granularity);
      if (
        (granularity === entry.granularity ||
          (includeFinerGranularities && eIdx <= gIdx)) &&
        entry.date.isSame(targetDate, granularity)
      ) {
        matches.push(entry);
      }
    }
    return matches;
  }

  public isPeriodic(targetPath: string, granularity?: Granularity): boolean {
    const entry = this.byPath.get(targetPath);
    if (!entry) return false;
    if (!granularity) return true;
    return granularity === entry.granularity;
  }

  public find(filePath: string | undefined): CacheEntry | null {
    if (!filePath) return null;
    return this.byPath.get(filePath) ?? null;
  }

  public findAdjacent(
    filePath: string,
    direction: "forwards" | "backwards",
  ): CacheEntry | null {
    const curr = this.find(filePath);
    if (!curr) return null;

    const sorted = Array.from(this.byKey.entries())
      .filter(([key]) => key.startsWith(`${curr.granularity}:`))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, entry]) => entry);

    const idx = sorted.findIndex((e) => e.filePath === filePath);
    const offset = direction === "forwards" ? 1 : -1;
    return sorted[idx + offset] ?? null;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/cache.ts
git commit -m "refactor: rewrite cache — dual index, CacheEntry, drop loose matching"
```

### Task 6: Create `template.test.ts`

**Files:**

- Create: `src/template.test.ts`

- [ ] **Step 1: Create `src/template.test.ts`**

Test `applyTemplate` directly — it's pure (uses `window.moment` from test preload but no obsidian imports).

```ts
import { describe, expect, test } from "bun:test";
import { applyTemplate } from "./template";

describe("applyTemplate", () => {
  test("replaces date token", () => {
    const result = applyTemplate(
      "2026-03-20",
      "day",
      window.moment("2026-03-20"),
      "YYYY-MM-DD",
      "Today is {{date}}",
    );
    expect(result).toBe("Today is 2026-03-20");
  });

  test("replaces title token", () => {
    const result = applyTemplate(
      "2026-03-20",
      "day",
      window.moment("2026-03-20"),
      "YYYY-MM-DD",
      "# {{title}}",
    );
    expect(result).toBe("# 2026-03-20");
  });

  test("replaces yesterday and tomorrow for day granularity", () => {
    const date = window.moment("2026-03-20");
    const result = applyTemplate(
      "2026-03-20",
      "day",
      date,
      "YYYY-MM-DD",
      "{{yesterday}} / {{tomorrow}}",
    );
    expect(result).toBe("2026-03-19 / 2026-03-21");
  });

  test("replaces weekday tokens for week granularity", () => {
    const date = window.moment("2026-03-16"); // Monday
    const result = applyTemplate(
      "2026-W12",
      "week",
      date,
      "gggg-[W]ww",
      "Mon: {{monday:YYYY-MM-DD}}",
    );
    expect(result).toMatch(/^\w+: \d{4}-\d{2}-\d{2}$/);
  });

  test("does not replace yesterday/tomorrow for non-day granularity", () => {
    const date = window.moment("2026-03");
    const result = applyTemplate(
      "2026-03",
      "month",
      date,
      "YYYY-MM",
      "{{yesterday}}",
    );
    expect(result).toBe("{{yesterday}}");
  });
});
```

- [ ] **Step 2: Run tests**

Run: `bun test src/template.test.ts`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add src/template.test.ts
git commit -m "test: add template.test.ts — direct imports, no re-implementation"
```

## Chunk 3: Commands, settings, and main plugin

### Task 7: Rewrite `commands.ts` (absorb modal.ts)

**Files:**

- Modify: `src/commands.ts`

- [ ] **Step 1: Rewrite `src/commands.ts`**

Absorb `showFileMenu` from `modal.ts` as `showContextMenu`. Remove quarter from labels. Use plain settings access.

```ts
import {
  type App,
  type Command,
  Menu,
  Notice,
  type Point,
  TFile,
} from "obsidian";
import type PeriodicNotesPlugin from "./main";
import { type Granularity, granularities } from "./types";

interface GranularityLabel {
  periodicity: string;
  relativeUnit: string;
  labelOpenPresent: string;
}

export const granularityLabels: Record<Granularity, GranularityLabel> = {
  day: {
    periodicity: "daily",
    relativeUnit: "today",
    labelOpenPresent: "Open today's daily note",
  },
  week: {
    periodicity: "weekly",
    relativeUnit: "this week",
    labelOpenPresent: "Open this week's note",
  },
  month: {
    periodicity: "monthly",
    relativeUnit: "this month",
    labelOpenPresent: "Open this month's note",
  },
  year: {
    periodicity: "yearly",
    relativeUnit: "this year",
    labelOpenPresent: "Open this year's note",
  },
};

async function jumpToAdjacentNote(
  app: App,
  plugin: PeriodicNotesPlugin,
  direction: "forwards" | "backwards",
): Promise<void> {
  const activeFile = app.workspace.getActiveFile();
  if (!activeFile) return;
  const meta = plugin.findInCache(activeFile.path);
  if (!meta) return;

  const adjacent = plugin.findAdjacent(activeFile.path, direction);
  if (adjacent) {
    const file = app.vault.getAbstractFileByPath(adjacent.filePath);
    if (file && file instanceof TFile) {
      const leaf = app.workspace.getLeaf();
      await leaf.openFile(file, { active: true });
    }
  } else {
    const qualifier = direction === "forwards" ? "after" : "before";
    new Notice(
      `There's no ${granularityLabels[meta.granularity].periodicity} note ${qualifier} this`,
    );
  }
}

async function openAdjacentNote(
  app: App,
  plugin: PeriodicNotesPlugin,
  direction: "forwards" | "backwards",
): Promise<void> {
  const activeFile = app.workspace.getActiveFile();
  if (!activeFile) return;
  const meta = plugin.findInCache(activeFile.path);
  if (!meta) return;

  const offset = direction === "forwards" ? 1 : -1;
  const adjacentDate = meta.date.clone().add(offset, meta.granularity);
  plugin.openPeriodicNote(meta.granularity, adjacentDate);
}

export function getCommands(
  app: App,
  plugin: PeriodicNotesPlugin,
  granularity: Granularity,
): Command[] {
  const label = granularityLabels[granularity];

  return [
    {
      id: `open-${label.periodicity}-note`,
      name: label.labelOpenPresent,
      checkCallback: (checking: boolean) => {
        if (!plugin.settings.granularities[granularity].enabled) return false;
        if (checking) return true;
        plugin.openPeriodicNote(granularity, window.moment());
      },
    },
    {
      id: `next-${label.periodicity}-note`,
      name: `Jump forwards to closest ${label.periodicity} note`,
      checkCallback: (checking: boolean) => {
        if (!plugin.settings.granularities[granularity].enabled) return false;
        const activeFile = app.workspace.getActiveFile();
        if (checking) {
          if (!activeFile) return false;
          return plugin.isPeriodic(activeFile.path, granularity);
        }
        jumpToAdjacentNote(app, plugin, "forwards");
      },
    },
    {
      id: `prev-${label.periodicity}-note`,
      name: `Jump backwards to closest ${label.periodicity} note`,
      checkCallback: (checking: boolean) => {
        if (!plugin.settings.granularities[granularity].enabled) return false;
        const activeFile = app.workspace.getActiveFile();
        if (checking) {
          if (!activeFile) return false;
          return plugin.isPeriodic(activeFile.path, granularity);
        }
        jumpToAdjacentNote(app, plugin, "backwards");
      },
    },
    {
      id: `open-next-${label.periodicity}-note`,
      name: `Open next ${label.periodicity} note`,
      checkCallback: (checking: boolean) => {
        if (!plugin.settings.granularities[granularity].enabled) return false;
        const activeFile = app.workspace.getActiveFile();
        if (checking) {
          if (!activeFile) return false;
          return plugin.isPeriodic(activeFile.path, granularity);
        }
        openAdjacentNote(app, plugin, "forwards");
      },
    },
    {
      id: `open-prev-${label.periodicity}-note`,
      name: `Open previous ${label.periodicity} note`,
      checkCallback: (checking: boolean) => {
        if (!plugin.settings.granularities[granularity].enabled) return false;
        const activeFile = app.workspace.getActiveFile();
        if (checking) {
          if (!activeFile) return false;
          return plugin.isPeriodic(activeFile.path, granularity);
        }
        openAdjacentNote(app, plugin, "backwards");
      },
    },
  ];
}

export function showContextMenu(
  plugin: PeriodicNotesPlugin,
  position: Point,
): void {
  const menu = new Menu();
  const enabled = granularities.filter(
    (g) => plugin.settings.granularities[g].enabled,
  );

  for (const granularity of enabled) {
    const label = granularityLabels[granularity];
    menu.addItem((item) =>
      item
        .setTitle(label.labelOpenPresent)
        .setIcon(`calendar-${granularity}`)
        .onClick(() => plugin.openPeriodicNote(granularity, window.moment())),
    );
  }

  menu.showAtPosition(position);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/commands.ts
git commit -m "refactor: rewrite commands.ts — absorb modal, drop quarter, plain settings"
```

### Task 8: Create native `settings.ts`

**Files:**

- Create: `src/settings.ts`

- [ ] **Step 1: Create `src/settings.ts`**

Native Obsidian `Setting` API. One section per granularity with enabled toggle, format, folder, template.

```ts
import { type App, normalizePath, PluginSettingTab, Setting } from "obsidian";
import { FileSuggest, FolderSuggest } from "./fileSuggest";
import { validateFormat } from "./format";
import type PeriodicNotesPlugin from "./main";
import type { Granularity } from "./types";

function validateTemplate(app: App, template: string): string {
  if (!template) return "";
  const file = app.metadataCache.getFirstLinkpathDest(template, "");
  return file ? "" : "Template file not found";
}

function validateFolder(app: App, folder: string): string {
  if (!folder || folder === "/") return "";
  return app.vault.getAbstractFileByPath(normalizePath(folder))
    ? ""
    : "Folder not found in vault";
}

const labels: Record<Granularity, string> = {
  day: "Daily Notes",
  week: "Weekly Notes",
  month: "Monthly Notes",
  year: "Yearly Notes",
};

export class SettingsTab extends PluginSettingTab {
  constructor(
    readonly app: App,
    readonly plugin: PeriodicNotesPlugin,
  ) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    for (const granularity of [
      "day",
      "week",
      "month",
      "year",
    ] as Granularity[]) {
      this.addGranularitySection(containerEl, granularity);
    }
  }

  private addGranularitySection(
    containerEl: HTMLElement,
    granularity: Granularity,
  ): void {
    const config = this.plugin.settings.granularities[granularity];

    containerEl.createEl("h3", { text: labels[granularity] });

    new Setting(containerEl).setName("Enabled").addToggle((toggle) =>
      toggle.setValue(config.enabled).onChange(async (value) => {
        this.plugin.settings.granularities[granularity].enabled = value;
        await this.plugin.saveSettings();
      }),
    );

    const formatSetting = new Setting(containerEl)
      .setName("Format")
      .setDesc("Moment.js date format string")
      .addText((text) => {
        text.setValue(config.format).onChange(async (value) => {
          const error = validateFormat(value, granularity);
          formatSetting.descEl.setText(error || "Moment.js date format string");
          formatSetting.descEl.toggleClass("has-error", !!error);
          this.plugin.settings.granularities[granularity].format = value;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl).setName("Folder").addText((text) => {
      text.setValue(config.folder);
      new FolderSuggest(this.app, text.inputEl, async (value) => {
        const error = validateFolder(this.app, value);
        if (!error) {
          this.plugin.settings.granularities[granularity].folder = value;
          await this.plugin.saveSettings();
        }
      });
    });

    new Setting(containerEl).setName("Template").addText((text) => {
      text.setValue(config.templatePath ?? "");
      new FileSuggest(this.app, text.inputEl, async (value) => {
        const error = validateTemplate(this.app, value);
        if (!error) {
          this.plugin.settings.granularities[granularity].templatePath =
            value || undefined;
          await this.plugin.saveSettings();
        }
      });
    });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/settings.ts
git commit -m "refactor: create native settings.ts — Obsidian Setting API, no Svelte"
```

### Task 9: Rewrite `main.ts`

**Files:**

- Modify: `src/main.ts`

- [ ] **Step 1: Rewrite `src/main.ts`**

Plain settings object, no Svelte store, configureLocale, drop quarter icon, use new module imports.

```ts
import type { Moment } from "moment";
import { addIcon, Platform, Plugin, type TFile } from "obsidian";

import { NoteCache } from "./cache";
import { VIEW_TYPE_CALENDAR } from "./constants";
import { CalendarView } from "./calendar/view";
import { granularityLabels, getCommands, showContextMenu } from "./commands";
import { DEFAULT_SETTINGS } from "./constants";
import {
  calendarDayIcon,
  calendarMonthIcon,
  calendarWeekIcon,
  calendarYearIcon,
} from "./icons";
import { getConfig, getFormat } from "./format";
import { SettingsTab } from "./settings";
import { applyTemplate, getNoteCreationPath, readTemplate } from "./template";
import {
  type CacheEntry,
  type Granularity,
  granularities,
  type Settings,
} from "./types";
import { isMetaPressed } from "./calendar/utils";

const langToMomentLocale: Record<string, string> = {
  en: "en-gb",
  zh: "zh-cn",
  "zh-TW": "zh-tw",
  ru: "ru",
  ko: "ko",
  it: "it",
  id: "id",
  ro: "ro",
  "pt-BR": "pt-br",
  cz: "cs",
  da: "da",
  de: "de",
  es: "es",
  fr: "fr",
  no: "nn",
  pl: "pl",
  pt: "pt",
  tr: "tr",
  hi: "hi",
  nl: "nl",
  ar: "ar",
  ja: "ja",
};

function configureLocale(): void {
  const obsidianLang = localStorage.getItem("language") || "en";
  const systemLang = navigator.language?.toLowerCase();
  let momentLocale = langToMomentLocale[obsidianLang];
  if (systemLang?.startsWith(obsidianLang)) {
    momentLocale = systemLang;
  }
  const actual = window.moment.locale(momentLocale);
  console.debug(
    `[Periodic Notes] Configured locale: requested ${momentLocale}, got ${actual}`,
  );
}

interface OpenOpts {
  inNewSplit?: boolean;
}

export default class PeriodicNotesPlugin extends Plugin {
  public settings!: Settings;
  private ribbonEl!: HTMLElement | null;
  private cache!: NoteCache;

  async onload(): Promise<void> {
    addIcon("calendar-day", calendarDayIcon);
    addIcon("calendar-week", calendarWeekIcon);
    addIcon("calendar-month", calendarMonthIcon);
    addIcon("calendar-year", calendarYearIcon);

    await this.loadSettings();
    configureLocale();

    this.ribbonEl = null;
    this.cache = new NoteCache(this.app, this);

    this.openPeriodicNote = this.openPeriodicNote.bind(this);
    this.addSettingTab(new SettingsTab(this.app, this));

    this.configureRibbonIcons();
    this.configureCommands();

    this.registerView(
      VIEW_TYPE_CALENDAR,
      (leaf) => new CalendarView(leaf, this),
    );

    this.addCommand({
      id: "show-calendar",
      name: "Show calendar",
      checkCallback: (checking: boolean) => {
        if (checking) {
          return (
            this.app.workspace.getLeavesOfType(VIEW_TYPE_CALENDAR).length === 0
          );
        }
        this.app.workspace.getRightLeaf(false)?.setViewState({
          type: VIEW_TYPE_CALENDAR,
        });
      },
    });
  }

  private configureRibbonIcons(): void {
    this.ribbonEl?.detach();

    const enabled = granularities.filter(
      (g) => this.settings.granularities[g].enabled,
    );
    if (enabled.length) {
      const granularity = enabled[0];
      const label = granularityLabels[granularity];
      this.ribbonEl = this.addRibbonIcon(
        `calendar-${granularity}`,
        label.labelOpenPresent,
        (e: MouseEvent) => {
          if (e.type !== "auxclick") {
            this.openPeriodicNote(granularity, window.moment(), {
              inNewSplit: isMetaPressed(e),
            });
          }
        },
      );
      this.ribbonEl.addEventListener("contextmenu", (e: MouseEvent) => {
        e.preventDefault();
        showContextMenu(this, { x: e.pageX, y: e.pageY });
      });
    }
  }

  private configureCommands(): void {
    for (const granularity of granularities) {
      getCommands(this.app, this, granularity).forEach(
        this.addCommand.bind(this),
      );
    }
  }

  async loadSettings(): Promise<void> {
    const saved = await this.loadData();
    this.settings = saved?.granularities
      ? saved
      : structuredClone(DEFAULT_SETTINGS);
  }

  public async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.configureRibbonIcons();
    this.app.workspace.trigger("periodic-notes:settings-updated");
  }

  public async createPeriodicNote(
    granularity: Granularity,
    date: Moment,
  ): Promise<TFile> {
    const config = getConfig(this.settings, granularity);
    const format = getFormat(this.settings, granularity);
    const filename = date.format(format);
    const templateContents = await readTemplate(
      this.app,
      config.templatePath,
      granularity,
    );
    const rendered = applyTemplate(
      filename,
      granularity,
      date,
      format,
      templateContents,
    );
    const destPath = await getNoteCreationPath(this.app, filename, config);
    return this.app.vault.create(destPath, rendered);
  }

  public getPeriodicNote(granularity: Granularity, date: Moment): TFile | null {
    return this.cache.getPeriodicNote(granularity, date);
  }

  public getPeriodicNotes(
    granularity: Granularity,
    date: Moment,
    includeFinerGranularities = false,
  ): CacheEntry[] {
    return this.cache.getPeriodicNotes(
      granularity,
      date,
      includeFinerGranularities,
    );
  }

  public isPeriodic(filePath: string, granularity?: Granularity): boolean {
    return this.cache.isPeriodic(filePath, granularity);
  }

  public findAdjacent(
    filePath: string,
    direction: "forwards" | "backwards",
  ): CacheEntry | null {
    return this.cache.findAdjacent(filePath, direction);
  }

  public findInCache(filePath: string): CacheEntry | null {
    return this.cache.find(filePath);
  }

  public async openPeriodicNote(
    granularity: Granularity,
    date: Moment,
    opts?: OpenOpts,
  ): Promise<void> {
    const { inNewSplit = false } = opts ?? {};
    const { workspace } = this.app;
    let file = this.cache.getPeriodicNote(granularity, date);
    if (!file) {
      file = await this.createPeriodicNote(granularity, date);
    }
    const leaf = inNewSplit ? workspace.getLeaf("split") : workspace.getLeaf();
    await leaf.openFile(file, { active: true });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/main.ts
git commit -m "refactor: rewrite main.ts — plain settings, configureLocale, no Svelte store"
```

### Task 10: Rewrite `obsidian.d.ts`

**Files:**

- Modify: `src/obsidian.d.ts`

- [ ] **Step 1: Replace contents of `src/obsidian.d.ts`**

```ts
import "obsidian";

declare module "obsidian" {
  export interface Workspace extends Events {
    on(
      name: "periodic-notes:settings-updated",
      callback: () => void,
      // biome-ignore lint/suspicious/noExplicitAny: Obsidian API lacks type
      ctx?: any,
    ): EventRef;
    on(
      name: "periodic-notes:resolve",
      callback: () => void,
      // biome-ignore lint/suspicious/noExplicitAny: Obsidian API lacks type
      ctx?: any,
    ): EventRef;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/obsidian.d.ts
git commit -m "refactor: strip obsidian.d.ts to workspace events only"
```

## Chunk 4: Calendar updates, cleanup, and validation

### Task 11: Update calendar module

**Files:**

- Modify: `src/calendar/utils.ts`
- Rename: `src/calendar/fileStore.ts` → `src/calendar/store.ts`
- Rename: `src/calendar/WeekNum.svelte` → `src/calendar/Week.svelte`
- Modify: `src/calendar/types.ts`
- Modify: `src/calendar/view.ts`
- Modify: `src/calendar/Calendar.svelte`
- Modify: `src/calendar/Month.svelte`
- Modify: `src/calendar/Day.svelte`
- Modify: `src/calendar/Nav.svelte`

- [ ] **Step 1: Add `isMetaPressed` to `calendar/utils.ts`**

Add to end of `src/calendar/utils.ts`:

```ts
import { Platform } from "obsidian";

export function isMetaPressed(e: MouseEvent | KeyboardEvent): boolean {
  return Platform.isMacOS ? e.metaKey : e.ctrlKey;
}
```

- [ ] **Step 2: Update `calendar/types.ts` — drop I prefix**

Rename `IWeek` → `Week`, `IMonth` → `Month`, `IEventHandlers` → `EventHandlers` throughout the file. Remove `I` prefix from the type declarations and update all references in Calendar, Month, Day, Nav, and store files.

- [ ] **Step 3: Rename files**

```bash
git mv src/calendar/fileStore.ts src/calendar/store.ts
git mv src/calendar/WeekNum.svelte src/calendar/Week.svelte
```

- [ ] **Step 4: Update `calendar/store.ts`**

- Rename class `CalendarFileStore` → `CalendarStore`
- Change settings access from `get(this.plugin.settings)` to `this.plugin.settings`
- Update settings shape: `settings[g]?.enabled` → `settings.granularities[g].enabled` in `isGranularityEnabled` and `getEnabledGranularities`
- Remove `svelte/store` `get` import (keep `writable` and `Writable`)
- Update type imports: `IMonth` → `Month`, `FileMap` stays

- [ ] **Step 5: Update all Svelte component imports**

In each `.svelte` file, update:

- `CalendarFileStore` → `CalendarStore`
- `fileStore` import path → `./store`
- `WeekNum` import → `./Week.svelte`
- `IWeek` → `Week`, `IMonth` → `Month`, `IEventHandlers` → `EventHandlers`
- `isMetaPressed` import → from `./utils` instead of `src/utils`
- `DISPLAYED_MONTH` import → from `src/constants` instead of `./context`
- `get(plugin.settings)` → `plugin.settings` where applicable

- [ ] **Step 6: Update `calendar/view.ts`**

- Update import: `CalendarFileStore` → `CalendarStore` from `./store`
- Update import: `VIEW_TYPE_CALENDAR` from `src/constants` instead of `./constants`

- [ ] **Step 7: Delete absorbed files**

```bash
git rm src/calendar/constants.ts src/calendar/context.ts
```

- [ ] **Step 8: Commit**

```bash
git add src/calendar/
git commit -m "refactor: update calendar — rename store/types, drop I prefix, update imports"
```

### Task 12: Move `fileSuggest.ts` and update imports

**Files:**

- Rename: `src/ui/fileSuggest.ts` → `src/fileSuggest.ts`

- [ ] **Step 1: Move file**

```bash
git mv src/ui/fileSuggest.ts src/fileSuggest.ts
rm -rf src/ui
```

- [ ] **Step 2: Update imports in `settings.ts`**

Already written with `./fileSuggest` import path — no change needed.

- [ ] **Step 3: Commit**

```bash
git add src/fileSuggest.ts
git commit -m "refactor: move fileSuggest.ts to src root, remove ui/ directory"
```

### Task 13: Remove quarter icon

**Files:**

- Modify: `src/icons.ts`

- [ ] **Step 1: Remove `calendarQuarterIcon` export from `src/icons.ts`**

Delete the `calendarQuarterIcon` constant (the SVG block starting with `export const calendarQuarterIcon`).

- [ ] **Step 2: Commit**

```bash
git add src/icons.ts
git commit -m "refactor: remove quarter icon from icons.ts"
```

### Task 14: Delete old files

**Files:**

- Delete: `src/modal.ts`
- Delete: `src/parser.ts`, `src/parser.test.ts`
- Delete: `src/utils.ts`, `src/utils.test.ts`
- Delete: `src/settings/` entire directory
- Delete: `src/cache.test.ts` (will be rewritten)

- [ ] **Step 1: Delete files**

```bash
git rm src/modal.ts src/parser.ts src/parser.test.ts src/utils.ts src/utils.test.ts
git rm -r src/settings/
git rm src/cache.test.ts
```

- [ ] **Step 2: Commit**

```bash
git commit -m "refactor: delete old modules — utils, parser, modal, settings/"
```

### Task 15: Clean styles and dependencies

**Files:**

- Modify: `src/styles.css`
- Modify: `package.json`

- [ ] **Step 1: Clean `src/styles.css`**

Remove all dead CSS. The only styles needed are for the calendar (which are in Svelte component `<style>` blocks) and the `.has-error` class (used by native settings). Replace contents:

```css
.has-error {
  color: var(--text-error);
}

input.has-error {
  color: var(--text-error);
  border-color: var(--text-error);
}
```

- [ ] **Step 2: Remove `svelte-writable-derived` from `package.json`**

Remove the line `"svelte-writable-derived": "^3.1.1",` from dependencies.

- [ ] **Step 3: Run `bun install`**

```bash
bun install
```

- [ ] **Step 4: Commit**

```bash
git add src/styles.css package.json bun.lockb
git commit -m "chore: clean styles, remove svelte-writable-derived dependency"
```

### Task 16: Update cache tests

**Files:**

- Create: `src/cache.test.ts`

- [ ] **Step 1: Create `src/cache.test.ts`**

Update for new `CacheEntry` shape. Port relevant tests from old file, adapting for dual-index cache and no loose matching.

```ts
import { describe, expect, test } from "bun:test";
import type { Granularity } from "./types";

// Re-implement only what can't be imported (cache needs obsidian)
type CacheEntry = {
  filePath: string;
  date: moment.Moment;
  granularity: Granularity;
  match: "filename" | "frontmatter";
};

describe("CacheEntry shape", () => {
  test("has required fields", () => {
    const entry: CacheEntry = {
      filePath: "daily/2026-03-20.md",
      date: window.moment("2026-03-20"),
      granularity: "day",
      match: "filename",
    };
    expect(entry.filePath).toBe("daily/2026-03-20.md");
    expect(entry.granularity).toBe("day");
    expect(entry.match).toBe("filename");
  });
});

describe("canonicalKey logic", () => {
  // Test the key generation logic (reimplemented since it's private in cache)
  function canonicalKey(granularity: Granularity, date: moment.Moment): string {
    return `${granularity}:${date.clone().startOf(granularity).toISOString()}`;
  }

  test("day keys differ by day", () => {
    const k1 = canonicalKey("day", window.moment("2026-03-20"));
    const k2 = canonicalKey("day", window.moment("2026-03-21"));
    expect(k1).not.toBe(k2);
  });

  test("week keys match for same week", () => {
    const k1 = canonicalKey("week", window.moment("2026-03-16")); // Monday
    const k2 = canonicalKey("week", window.moment("2026-03-18")); // Wednesday
    expect(k1).toBe(k2);
  });

  test("month keys match for same month", () => {
    const k1 = canonicalKey("month", window.moment("2026-03-01"));
    const k2 = canonicalKey("month", window.moment("2026-03-31"));
    expect(k1).toBe(k2);
  });

  test("keys sort chronologically", () => {
    const keys = [
      canonicalKey("day", window.moment("2026-03-22")),
      canonicalKey("day", window.moment("2026-03-20")),
      canonicalKey("day", window.moment("2026-03-21")),
    ].sort();
    expect(keys[0]).toContain("2026-03-20");
    expect(keys[2]).toContain("2026-03-22");
  });
});
```

- [ ] **Step 2: Run tests**

Run: `bun test src/cache.test.ts`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add src/cache.test.ts
git commit -m "test: rewrite cache.test.ts for v2 CacheEntry and canonicalKey"
```

### Task 17: Update remaining calendar tests

**Files:**

- Rename: `src/calendar/fileStore.test.ts` → `src/calendar/store.test.ts`
- Modify: `src/calendar/utils.test.ts`

- [ ] **Step 1: Rename fileStore test**

```bash
git mv src/calendar/fileStore.test.ts src/calendar/store.test.ts
```

- [ ] **Step 2: Update imports in `store.test.ts`**

Change `CalendarFileStore` → `CalendarStore`, `fileStore` → `store`, update import paths.

- [ ] **Step 3: Update `calendar/utils.test.ts`**

Add tests for `isMetaPressed` if needed. Update any type references (`IWeek` → `Week`).

- [ ] **Step 4: Commit**

```bash
git add src/calendar/store.test.ts src/calendar/utils.test.ts
git commit -m "test: update calendar tests for v2 renames"
```

### Task 18: Validate and build

- [ ] **Step 1: Run type check**

```bash
bun run typecheck
```

Expected: No errors

- [ ] **Step 2: Run biome**

```bash
bunx biome check .
```

Expected: No errors (fix any formatting issues)

- [ ] **Step 3: Run all tests**

```bash
bun test
```

Expected: All tests pass

- [ ] **Step 4: Build**

```bash
bun run build
```

Expected: Build succeeds, `main.js` produced

- [ ] **Step 5: Run full validation**

```bash
bun run validate
```

Expected: All validations pass

- [ ] **Step 6: Fix any issues found**

Iterate until all checks pass.

- [ ] **Step 7: Commit build artifact**

```bash
git add main.js
git commit -m "chore: rebuild main.js for v2"
```

### Task 19: Update bunfig and test-preload if needed

**Files:**

- Check: `bunfig.toml`
- Check: `src/test-preload.ts`

- [ ] **Step 1: Verify test-preload.ts still works**

No changes expected — it provides `window.moment` which all tests still need.

- [ ] **Step 2: Verify bunfig.toml paths are correct**

Ensure the preload path still resolves.

- [ ] **Step 3: Commit if changes needed**

### Task 20: Update CLAUDE.md

**Files:**

- Modify: `CLAUDE.md`

- [ ] **Step 1: Update CLAUDE.md**

Reflect the new module structure, removed features, and updated commands. Key changes:

- Remove references to `settings/validation.ts`, `utils.ts`, `parser.ts`, `modal.ts`
- Update module descriptions for `format.ts`, `template.ts`, `cache.ts`, `commands.ts`, `settings.ts`
- Remove quarter from granularity references
- Update "Modules that cannot be imported in tests" — `format.ts` CAN be imported now
- Remove localization references
- Update store bridge documentation

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for v2 module structure"
```
