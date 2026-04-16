# Periodic Notes Walkthrough (v2.1.0)

*2026-04-16T17:33:23Z by Showboat 0.6.1*
<!-- showboat-id: b5d18f98-73ae-4629-b5c4-1e5d2b586d59 -->

## Overview

This is an Obsidian plugin that creates and manages periodic notes at four granularities: day, week, month, and year. Given a date and granularity, it resolves or creates the corresponding Markdown file (following a configurable filename format), renders a template into it, and surfaces navigation commands plus a sidebar calendar view.

**Technology:**

- Obsidian plugin API (desktop + mobile), TypeScript strict mode
- Bun runtime for tooling; Biome for lint+format; Vite for bundling
- Svelte 5 with runes (`$state`, `$effect`, `$derived`) for the calendar sidebar only
- Moment.js (provided by Obsidian as `window.moment`) for all date math

**Public API surface** (augmented onto Obsidian's `Workspace`):

```bash
sed -n '1,22p' src/obsidian.d.ts
```

```output
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
      callback: (
        granularity: import("./types").Granularity,
        file: TFile,
      ) => void,
      // biome-ignore lint/suspicious/noExplicitAny: Obsidian API lacks type
      ctx?: any,
    ): EventRef;
  }
}
```

## Architecture

The source tree is organized around two boundaries. Files at the top level of `src/` handle plugin lifecycle, cache, templates, and command wiring. Files in `src/calendar/` own the Svelte sidebar.

Within each area the layout follows one rule: **obsidian-coupled modules are separated from pure ones**, so the pure ones can be unit-tested directly without mocking Obsidian.

```bash
ls src/ && echo && ls src/calendar/
```

```output
cache.test.ts
cache.ts
cacheIndex.test.ts
cacheIndex.ts
cacheSearch.test.ts
cacheSearch.ts
calendar
commands.ts
constants.ts
fileSuggest.ts
format.test.ts
format.ts
icons.ts
main.ts
obsidian.d.ts
platform.ts
settings.ts
styles.css
template.test.ts
template.ts
templateRender.ts
test-preload.ts
types.ts

Arrow.svelte
Calendar.svelte
calendarStore.svelte.ts
Day.svelte
displayedMonth.svelte.ts
Month.svelte
Nav.svelte
store.test.ts
store.ts
types.ts
utils.test.ts
utils.ts
view.ts
Week.svelte
```

**Module boundaries:**

- `main.ts` — Plugin lifecycle, ribbon, command registration, view registration, public API surface
- `cache.ts` — Obsidian-coupled orchestration: vault/metadata event handlers, folder scanning, template-apply trigger
- `cacheIndex.ts` — Pure dual-index state (byPath + byKey) with lazy per-granularity sorted-key cache
- `cacheSearch.ts` — Pure helpers: `canonicalKey` and binary-search `findAdjacentKey`
- `template.ts` — Obsidian-coupled template I/O: read from vault, write rendered output, ensure folders exist
- `templateRender.ts` — Pure token replacement; hoisted regex constants
- `format.ts` — Pure format helpers (validation, parsing, path join)
- `commands.ts` — Command factory per granularity + context menu
- `settings.ts` — Native Obsidian `Setting` API settings tab
- `constants.ts`, `types.ts`, `icons.ts`, `platform.ts`, `fileSuggest.ts` — Supporting modules
- `calendar/` — Svelte 5 sidebar (see its own section below)

## Entry point: `main.ts`

The plugin class extends Obsidian's `Plugin`. `onload` registers icons, loads settings, configures the locale (to avoid week-start surprises), constructs the cache, adds the settings tab, wires ribbon and commands, and registers the calendar view.

```bash
sed -n '73,110p' src/main.ts
```

```output
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
```

### The central public API

Other code (commands, the calendar view) reaches back into the plugin through four methods: `openPeriodicNote`, `getPeriodicNote`, `isPeriodic`, and `findAdjacent`. `openPeriodicNote` is the single entry point for "navigate to a date" — if no file exists, it creates one.

```bash
sed -n '191,224p' src/main.ts
```

```output
  public getPeriodicNote(granularity: Granularity, date: Moment): TFile | null {
    return this.cache.getPeriodicNote(granularity, date);
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

### Settings: plain object, not reactive state

Settings are a plain `Settings` object persisted via `Plugin.saveData()`. There's no Svelte store wrapping it; consumers subscribe to a custom workspace event (`periodic-notes:settings-updated`) when they need to react to settings changes. Loading merges saved fields onto a cloned defaults object — new fields get defaults, removed fields are silently dropped.

```bash
sed -n '146,166p' src/main.ts
```

```output
  async loadSettings(): Promise<void> {
    const saved = await this.loadData();
    const settings = structuredClone(DEFAULT_SETTINGS);
    if (saved?.granularities) {
      for (const g of granularities) {
        if (saved.granularities[g]) {
          settings.granularities[g] = {
            ...settings.granularities[g],
            ...saved.granularities[g],
          };
        }
      }
    }
    this.settings = settings;
  }

  public async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.configureRibbonIcons();
    this.app.workspace.trigger("periodic-notes:settings-updated");
  }
```

## Domain types

Four granularities, one `NoteConfig` per granularity, one `Settings` wrapper, and one `CacheEntry` value type — that's the entire domain vocabulary.

```bash
sed -n '1,22p' src/types.ts
```

```output
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

## The cache layer

The cache is the heart of the plugin. It maps between the filesystem world (file paths) and the date world (granularity + Moment), and it does so via a **dual index** so that lookups in either direction are O(1).

The cache is split into three files: a pure `cacheSearch.ts` with the canonical-key and binary-search helpers, a pure `cacheIndex.ts` that owns the dual-index state, and an Obsidian-coupled `cache.ts` that wires vault events into the index.

### Canonical keys (`cacheSearch.ts`)

A canonical key is a string derived from a granularity and a Moment. Two dates in the same week produce the same week-granularity key, because `startOf("week")` collapses them to the week's start timestamp. The `.toISOString()` suffix guarantees that string sort order matches chronological order — that's what makes binary search work.

```bash
sed -n '1,27p' src/cacheSearch.ts
```

```output
import type { Moment } from "moment";

import type { Granularity } from "./types";

export function canonicalKey(granularity: Granularity, date: Moment): string {
  return `${granularity}:${date.clone().startOf(granularity).toISOString()}`;
}

export function findAdjacentKey(
  sorted: string[],
  key: string,
  direction: "forwards" | "backwards",
): string | null {
  let lo = 0;
  let hi = sorted.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const midKey = sorted[mid];
    if (midKey === key) {
      const offset = direction === "forwards" ? 1 : -1;
      return sorted[mid + offset] ?? null;
    }
    if (midKey < key) lo = mid + 1;
    else hi = mid - 1;
  }
  return null;
}
```

### Dual-index state (`cacheIndex.ts`)

`CacheIndex` is the pure kernel. Two `Map`s are the primary indexes:

- `byPath`: file path → `CacheEntry`
- `byKey`: canonical key → `CacheEntry`

Plus a lazy cache of sorted key lists per granularity, with a dirty-flag set. Lookups (`get`, `getByKey`) are O(1). The sorted cache is only built (and sorted) when `findAdjacent` is called, and only for the one granularity being navigated.

The `set` method enforces the invariant that `byPath` and `byKey` stay in sync, including two eviction edge cases:

```bash
sed -n '7,33p' src/cacheIndex.ts
```

```output
  private byPath = new Map<string, CacheEntry>();
  private byKey = new Map<string, CacheEntry>();
  private sortedByGranularity = new Map<Granularity, string[]>();
  private dirtyGranularities = new Set<Granularity>(granularities);

  set(entry: CacheEntry): void {
    const newKey = canonicalKey(entry.granularity, entry.date);
    const oldByPath = this.byPath.get(entry.filePath);
    if (oldByPath) {
      const oldKey = canonicalKey(oldByPath.granularity, oldByPath.date);
      if (oldKey !== newKey) {
        this.byKey.delete(oldKey);
        this.dirtyGranularities.add(oldByPath.granularity);
      }
    }
    // Evict any other file that claims the same canonical key
    const oldByKey = this.byKey.get(newKey);
    if (oldByKey && oldByKey.filePath !== entry.filePath) {
      this.byPath.delete(oldByKey.filePath);
    }
    const isNewKey = !this.byKey.has(newKey);
    this.byPath.set(entry.filePath, entry);
    this.byKey.set(newKey, entry);
    if (isNewKey) {
      this.dirtyGranularities.add(entry.granularity);
    }
  }
```

**The two eviction cases in `set()`:**

1. Same file, new date — delete the old canonical key from `byKey`, mark the old granularity dirty.
2. Two different files claim the same canonical key (e.g., duplicate filenames in different folders parsed to the same date) — evict the loser from `byPath`. Last write wins; no user-visible error.

The dirty flag is only added when the sorted key list would actually change — when the same file is re-set with the same key (common when Obsidian's `metadataCache:changed` fires on a save that didn't touch the date), the sorted cache stays warm.

### `findAdjacent` — binary search over a lazy sorted list

```bash
sed -n '67,95p' src/cacheIndex.ts
```

```output
  findAdjacent(
    filePath: string,
    direction: "forwards" | "backwards",
  ): CacheEntry | null {
    const curr = this.get(filePath);
    if (!curr) return null;

    const sorted = this.getSortedKeys(curr.granularity);
    const key = canonicalKey(curr.granularity, curr.date);
    const adjKey = findAdjacentKey(sorted, key, direction);
    return adjKey ? (this.byKey.get(adjKey) ?? null) : null;
  }

  private getSortedKeys(granularity: Granularity): string[] {
    if (!this.dirtyGranularities.has(granularity)) {
      const cached = this.sortedByGranularity.get(granularity);
      if (cached) return cached;
    }
    const prefix = `${granularity}:`;
    const keys: string[] = [];
    for (const k of this.byKey.keys()) {
      if (k.startsWith(prefix)) keys.push(k);
    }
    keys.sort();
    this.sortedByGranularity.set(granularity, keys);
    this.dirtyGranularities.delete(granularity);
    return keys;
  }
}
```

### Obsidian-coupled shell (`cache.ts`)

`NoteCache extends Component` and owns a `CacheIndex`. In `onLayoutReady`, it scans the configured folders, wires vault/metadata events, and listens for the `periodic-notes:settings-updated` custom event to reset.

The `resolve` path is how a file becomes a periodic note. For each enabled granularity (in order day → week → month → year), it checks that the file is under the configured folder, computes a date-parseable input from the filename, tries `moment(input, formats, true)`, and if valid calls `index.set(...)`. First match wins.

```bash
sed -n '161,201p' src/cache.ts
```

```output
  private resolve(
    file: TFile,
    reason: "create" | "rename" | "initialize" = "create",
  ): void {
    const settings = this.plugin.settings;
    const active = getEnabledGranularities(settings);
    if (active.length === 0) return;

    const existing = this.index.get(file.path);
    if (existing && existing.match === "frontmatter") return;

    for (const granularity of active) {
      const folder = settings.granularities[granularity].folder || "/";
      if (!file.path.startsWith(folder === "/" ? "" : `${folder}/`)) continue;

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
        this.index.set(entry);

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
```

**Frontmatter takes priority.** If an entry already exists and its match source is `"frontmatter"`, `resolve` short-circuits — filename-based re-resolution won't overwrite a frontmatter claim. The `onMetadataChanged` handler is what creates frontmatter entries: it parses the granularity key from frontmatter (e.g., `day: 2026-04-16`) and indexes under `match: "frontmatter"`.

**Template application is triggered from here.** When `resolve` is called with `reason === "create"` and the file is zero bytes, it fires `applyTemplateToFile` in the background. This is a no-op for notes created via `plugin.createPeriodicNote()` (which writes rendered content at creation time) — it exists for files created by the user or other plugins that happen to match a periodic format.

**`getPeriodicNote` is self-healing.** If the index has an entry but the vault no longer contains the file, the stale entry is removed and null is returned.

```bash
sed -n '203,229p' src/cache.ts
```

```output
  public getPeriodicNote(
    granularity: Granularity,
    targetDate: Moment,
  ): TFile | null {
    const entry = this.index.getByKey(granularity, targetDate);
    if (!entry) return null;
    const file = this.app.vault.getAbstractFileByPath(entry.filePath);
    if (file instanceof TFile) return file;
    this.index.remove(entry.filePath);
    return null;
  }

  public isPeriodic(targetPath: string, granularity?: Granularity): boolean {
    return this.index.has(targetPath, granularity);
  }

  public find(filePath: string | undefined): CacheEntry | null {
    return this.index.get(filePath);
  }

  public findAdjacent(
    filePath: string,
    direction: "forwards" | "backwards",
  ): CacheEntry | null {
    return this.index.findAdjacent(filePath, direction);
  }
}
```

## Template rendering

Templates support a small DSL of `{{tokens}}` that expand to formatted Moment values. Pure rendering logic lives in `templateRender.ts`; file I/O lives in `template.ts`.

### Token patterns (pre-compiled)

Four static regexes handle the granularity-specific tokens. They're defined at module load rather than rebuilt per call.

```bash
sed -n '1,13p' src/templateRender.ts
```

```output
import type { Moment } from "moment";

import { WEEKDAYS } from "./constants";
import type { Granularity } from "./types";

const DATE_TIME_TOKEN =
  /{{\s*(date|time)\s*(([-+]\d+)([ymwdhs]))?\s*(:.+?)?}}/gi;
const MONTH_TOKEN = /{{\s*(month)\s*(([-+]\d+)([ymwdhs]))?\s*(:.+?)?}}/gi;
const YEAR_TOKEN = /{{\s*(year)\s*(([-+]\d+)([ymwdhs]))?\s*(:.+?)?}}/gi;
const WEEKDAY_TOKEN = new RegExp(
  `{{\\s*(${WEEKDAYS.join("|")})\\s*:(.*?)}}`,
  "gi",
);
```

### `applyTemplate` — layered by granularity

Universal tokens (`{{date}}`, `{{time}}`, `{{title}}`) are replaced first. Then granularity-specific branches run:

- **day** — `{{yesterday}}`, `{{tomorrow}}`, and `{{date±Nunit}}` / `{{time±Nunit}}`
- **week** — `{{monday:format}}` through `{{sunday:format}}`
- **month** / **year** — `{{month±Nunit:format}}` / `{{year±Nunit:format}}`

A token from one granularity left in another granularity's template is preserved literally — templates are not accidentally granularity-polymorphic.

```bash
sed -n '63,118p' src/templateRender.ts
```

```output
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
    contents = replaceGranularityTokens(
      contents,
      date,
      DATE_TIME_TOKEN,
      format,
    );
  }

  if (granularity === "week") {
    contents = contents.replace(WEEKDAY_TOKEN, (_, dayOfWeek, momentFormat) => {
      const day = getDayOfWeekNumericalValue(dayOfWeek);
      return date.weekday(day).format(momentFormat.trim());
    });
  }

  if (granularity === "month") {
    contents = replaceGranularityTokens(
      contents,
      date,
      MONTH_TOKEN,
      format,
      "month",
    );
  }

  if (granularity === "year") {
    contents = replaceGranularityTokens(
      contents,
      date,
      YEAR_TOKEN,
      format,
      "year",
    );
  }

  return contents;
}
```

### Template I/O shell (`template.ts`)

`readTemplate` resolves a template path via Obsidian's metadata cache and reads it. Errors log + toast + return empty string — the caller gets a rendered-but-empty note rather than a hard failure.

`applyTemplateToFile` is the write path used by `NoteCache.resolve` for externally-created periodic notes. `createPeriodicNote` in `main.ts` takes a different path: it renders the template eagerly and calls `vault.create(path, rendered)` directly.

```bash
sed -n '7,49p' src/template.ts
```

```output
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
```

## Format helpers

`format.ts` is pure and deals with Moment format strings: fetching the configured (or default) format, generating the set of formats to try during parsing (full and basename), and validating formats.

The `validateFormatComplexity` classifier is load-bearing — it detects nested paths in formats (e.g., `YYYY/YYYY-MM-DD`) and flags whether the filename alone is sufficient to parse the date, which determines how `NoteCache.getDateInput` constructs the parse input.

```bash
sed -n '9,31p' src/format.ts
```

```output
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
```

```bash
sed -n '54,107p' src/format.ts
```

```output
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

function isMissingRequiredTokens(format: string): boolean {
  const base = getBasename(format).replace(/\[[^\]]*\]/g, "");
  return (
    !["M", "D"].every((t) => base.includes(t)) ||
    !(base.includes("Y") || base.includes("y"))
  );
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
    if (granularity === "day" && isMissingRequiredTokens(format)) {
      return "fragile-basename";
    }
  }
  return "valid";
}
```

## Commands

For each granularity, `getCommands` returns five commands: open-now, jump-next, jump-prev, open-next, open-prev. "Jump" means navigate to the nearest _existing_ periodic note (via `findAdjacent`) and notice if none exists. "Open" means navigate to the adjacent _date_, creating the note if needed (via `openPeriodicNote`).

All commands use Obsidian's `checkCallback` pattern so they hide from the palette when disabled or when the active file isn't periodic.

```bash
sed -n '41,80p' src/commands.ts
```

```output
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

```

## The calendar sidebar

The calendar is an Obsidian `ItemView` that mounts a Svelte 5 component tree. Two boundaries make it work:

- **Obsidian ↔ Svelte via exported functions + callback props.** `CalendarView` calls `calendar.tick()` and `calendar.setActiveFilePath(path)` when Obsidian-side events fire. Svelte calls back through `onHover`, `onClick`, `onContextMenu` props for user interaction.
- **Plugin state ↔ Svelte via a `$state` version counter.** `CalendarStore` exposes a numeric `version` field (`$state(0)`). Any vault event that might have changed the periodic-note landscape bumps the counter. `Calendar.svelte` reads `fileStore.version` inside an `$effect` so Svelte's reactivity tracks it automatically.

### `CalendarView` (the Obsidian host)

```bash
sed -n '14,62p' src/calendar/view.ts
```

```output

export class CalendarView extends ItemView {
  private calendar!: CalendarExports;
  private plugin: PeriodicNotesPlugin;

  constructor(leaf: WorkspaceLeaf, plugin: PeriodicNotesPlugin) {
    super(leaf);
    this.plugin = plugin;

    this.registerEvent(
      this.app.workspace.on("file-open", this.onFileOpen.bind(this)),
    );
  }

  getViewType(): string {
    return VIEW_TYPE_CALENDAR;
  }

  getDisplayText(): string {
    return "Calendar";
  }

  getIcon(): string {
    return "calendar-day";
  }

  async onClose(): Promise<void> {
    if (this.calendar) {
      unmount(this.calendar);
    }
  }

  async onOpen(): Promise<void> {
    const fileStore = new CalendarStore(this, this.plugin);

    const cal = mount(Calendar, {
      target: this.contentEl,
      props: {
        fileStore,
        onHover: this.onHover.bind(this),
        onClick: this.onClick.bind(this),
        onContextMenu: this.onContextMenu.bind(this),
      },
    });
    if (!("tick" in cal && "setActiveFilePath" in cal)) {
      throw new Error("Calendar component missing expected exports");
    }
    this.calendar = cal as CalendarExports;
  }
```

### `CalendarStore` — reactive data bridge

Lives in `calendarStore.svelte.ts`. The `.svelte.ts` extension is required for Svelte's compiler to process `$state` outside of a component.

Vault events that may have changed the landscape call `bump(file)`, which increments `version` only if the affected path is still periodic. Events fired _after_ the cache has already mutated (delete, rename) use `bumpUnconditionally` to avoid the race — the fileMap re-derivation is cheap enough to run on every delete/rename, and `getPeriodicNote` self-heals stale entries.

```bash
sed -n '7,51p' src/calendar/calendarStore.svelte.ts
```

```output
export default class CalendarStore {
  // Bumped on any vault/metadata event that may have changed the
  // periodic-note landscape. Consumers read this inside a $derived
  // or $effect to re-compute derived state (e.g., the FileMap).
  version = $state(0);
  private plugin: PeriodicNotesPlugin;

  constructor(component: Component, plugin: PeriodicNotesPlugin) {
    this.plugin = plugin;

    plugin.app.workspace.onLayoutReady(() => {
      const { vault, metadataCache, workspace } = plugin.app;
      component.registerEvent(vault.on("create", this.bump, this));
      // Delete and rename fire after NoteCache's handler, which already
      // removed the old entry from the index. isPeriodic(path) can return
      // false even for a file that was just a periodic note, so bump
      // unconditionally — getPeriodicNote self-heals stale entries.
      component.registerEvent(
        vault.on("delete", this.bumpUnconditionally, this),
      );
      component.registerEvent(
        vault.on("rename", this.bumpUnconditionally, this),
      );
      component.registerEvent(metadataCache.on("changed", this.bump, this));
      component.registerEvent(
        workspace.on("periodic-notes:resolve", this.bumpUnconditionally, this),
      );
      component.registerEvent(
        workspace.on(
          "periodic-notes:settings-updated",
          this.bumpUnconditionally,
          this,
        ),
      );
      this.bump();
    });
  }

  private bump(file?: TAbstractFile): void {
    if (file && !this.plugin.isPeriodic(file.path)) return;
    this.version++;
  }

  private bumpUnconditionally(): void {
    this.version++;
```

### `DisplayedMonth` — shared navigation state

The navigation state (which month the user is viewing) is shared between `Calendar.svelte`, `Nav.svelte`, `Day.svelte`, and `Month.svelte` via Svelte's context API with a rune-backed class. `$state.raw` is used because Moment instances are mutable third-party objects that don't benefit from the default proxy (and the write pattern is clone-and-reassign, which is what `.raw` tracks).

```bash
sed -n '1,6p' src/calendar/displayedMonth.svelte.ts
```

```output
import type { Moment } from "moment";

export class DisplayedMonth {
  current = $state.raw<Moment>(window.moment());
}
```

### The FileMap pattern

`Calendar.svelte` pre-computes a `Map<string, TFile | null>` covering every cell visible in the current month (up to 42 days + 6 weeks + 1 month + 1 year). Child components (`Day`, `Week`, `Month`) do synchronous `$derived` lookups via `fileMapKey(granularity, date)` instead of each running their own cache query. This replaces ~50 potential cache queries per render with one traversal.

```bash
sed -n '30,55p' src/calendar/Calendar.svelte
```

```output

  const displayedMonth = new DisplayedMonth();
  setContext(DISPLAYED_MONTH, displayedMonth);

  let month: Month = $state.raw(getMonth(window.moment()));
  let showWeeks: boolean = $state(false);
  let fileMap: FileMap = $state.raw(new Map());

  $effect(() => {
    month = getMonth(displayedMonth.current);
  });

  $effect(() => {
    // Track fileStore.version so mutations re-run this effect.
    void fileStore.version;
    showWeeks = fileStore.isGranularityEnabled("week");
    fileMap = computeFileMap(
      month,
      (date, granularity) => fileStore.getFile(date, granularity),
      fileStore.getEnabledGranularities(),
    );
  });

  let eventHandlers: EventHandlers = $derived({
    onHover,
    onClick,
```

```bash
sed -n '8,42p' src/calendar/store.ts
```

```output
export function fileMapKey(granularity: Granularity, date: Moment): string {
  return `${granularity}:${date.format(DEFAULT_FORMAT[granularity])}`;
}

export function computeFileMap(
  month: Month,
  getFile: (date: Moment, granularity: Granularity) => TFile | null,
  enabledGranularities: Granularity[],
): FileMap {
  const map: FileMap = new Map();
  const displayedMonth = month[1].days[0];

  for (const week of month) {
    for (const day of week.days) {
      map.set(fileMapKey("day", day), getFile(day, "day"));
    }
    if (enabledGranularities.includes("week")) {
      const weekStart = week.days[0];
      map.set(fileMapKey("week", weekStart), getFile(weekStart, "week"));
    }
  }

  if (enabledGranularities.includes("month")) {
    map.set(
      fileMapKey("month", displayedMonth),
      getFile(displayedMonth, "month"),
    );
  }
  if (enabledGranularities.includes("year")) {
    map.set(
      fileMapKey("year", displayedMonth),
      getFile(displayedMonth, "year"),
    );
  }

```

## Build and test

### Build

Vite bundles `src/main.ts` to `main.js` at the project root (CommonJS, `obsidian` and Electron built-ins externalized). A small plugin copies `src/styles.css` to `styles.css` during the build. The `outDir: "."` with `emptyOutDir: false` combination is the Obsidian plugin convention — never change it.

```bash
sed -n '6,33p' vite.config.ts
```

```output
export default defineConfig({
  plugins: [
    svelte({ emitCss: false }),
    {
      name: "copy-styles",
      writeBundle() {
        copyFileSync("src/styles.css", "styles.css");
      },
    },
  ],
  resolve: {
    alias: { src: path.resolve(__dirname, "src") },
  },
  build: {
    lib: {
      entry: "src/main.ts",
      formats: ["cjs"],
      fileName: () => "main.js",
    },
    outDir: ".",
    emptyOutDir: false,
    sourcemap: process.env.NODE_ENV === "DEV" ? "inline" : false,
    rollupOptions: {
      external: ["obsidian", "electron", "fs", "os", "path"],
      output: { exports: "default" },
    },
  },
});
```

### Tests

Bun's native test runner is used. `bunfig.toml` preloads `src/test-preload.ts`, which stubs `window.moment` globally so pure modules that depend on Moment (but are imported outside a real Obsidian environment) still work.

Pure modules — directly import-and-test:

- `format.ts`, `format.test.ts`
- `cacheSearch.ts`, `cacheSearch.test.ts`
- `cacheIndex.ts`, `cacheIndex.test.ts`
- `templateRender.ts`, `template.test.ts`
- `calendar/store.ts`, `calendar/store.test.ts`
- `calendar/utils.ts`, `calendar/utils.test.ts`

Obsidian-coupled modules — cannot be imported in tests because they import `obsidian` at module load:

- `main.ts`, `cache.ts`, `template.ts`, `settings.ts`, `platform.ts`, `commands.ts`

`cache.test.ts` covers only the `CacheEntry` shape; the real invariant coverage lives in `cacheIndex.test.ts` against the pure inner kernel.

Test count (deterministic):

```bash
grep -rE "^\s*(test|it)\(" src/ | grep -v "^Binary" | wc -l | tr -d " "
```

```output
86
```

## Concerns

### Code quality

1. **`NoteCache.initialize` duplicates the per-granularity folder scan.** The loop scans each configured folder independently, so a file living at the root (or in an overlapping folder) is resolved once per enabled granularity. The `visited` `Set<TFolder>` guards against re-traversing the same folder within one pass, but not across granularities. On a large vault with overlapping folder configs, initialize could touch the same files multiple times.

2. **`getFile` in `CalendarStore` and `getPeriodicNote` in `main.ts` both delegate with the same signature.** `main.ts` hides the cache as a private field, `CalendarStore` uses `this.plugin.getPeriodicNote` as its source of truth. Two names for the same operation across the same call chain.

3. **`dirtyGranularities` initialization is belt-and-suspenders.** `CacheIndex`'s constructor seeds the dirty set with all four granularities even though the sorted cache is empty. `getSortedKeys` would rebuild from empty `byKey` either way. Not a bug, just redundant.

### Community standards

4. **No `minAppVersion` validation at runtime.** `manifest.json` declares `minAppVersion: 1.6.0` but the plugin doesn't check it. Obsidian enforces this at install time, but users running outdated Obsidian after partial updates can hit undefined-API errors.

5. **Settings migration is explicitly absent.** `loadSettings` merges saved fields onto defaults and silently drops anything else. This is intentional (per THEORY.md: "one user — no migration path needed") but a plugin published to the community registry should log a warning when saved data doesn't match the expected shape.

6. **`parseFrontMatterEntry` returns `unknown` but we only handle `string`.** Other plugins might write `day: 2026-04-16` as an unquoted YAML date (parsed to a JS `Date`), array, or object. The cache silently ignores all non-string cases.

### Risks

7. **Event-order coupling.** `CalendarStore`'s event handlers run after `NoteCache`'s for `delete` and `rename` because the calendar sidebar registers listeners later (on sidebar open vs plugin load). The fix (unconditional bump) is correct but documents a fragile contract between two independent components. A future reorganization could silently regress this.

8. **Template failures on creation are non-transactional.** `resolve` calls `applyTemplateToFile` asynchronously. If template reading fails after the file is created, the file is left empty and a Notice fires. The file is still indexed as a periodic note, so navigation works, but the template never gets retried.

9. **`canonicalKey` and `fileMapKey` compute the same concept differently.** `canonicalKey` (cache side) uses `startOf(granularity).toISOString()`. `fileMapKey` (calendar side) uses `date.format(DEFAULT_FORMAT[granularity])`. For a locale where `startOf("week")` and the `gggg-[W]ww` format disagree on week numbering, these keys would diverge and the calendar would lose track of week files. Moment's internals keep them consistent in practice, but nothing in the code enforces it.

10. **No integration tests.** The pure layers have good coverage (86 tests), but the full flow — `onLayoutReady` → scan vault → resolve events → template application → calendar render — has no end-to-end test. Regressions like the delete event-order bug (fixed in v2.1.0) can only be caught by manual smoke testing.

