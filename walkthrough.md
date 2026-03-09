# obsidian-periodic-notes Code Walkthrough

*2026-03-09T04:02:08Z by Showboat 0.6.1*
<!-- showboat-id: 18134e83-73ee-44a0-a970-7391089bc414 -->

## Overview

This plugin creates and manages periodic notes — daily, weekly, monthly, quarterly, and yearly — inside an Obsidian vault. Users configure a date format, folder, and template for each granularity. The plugin indexes existing notes by parsing filenames and frontmatter, then lets users open, create, and navigate between periodic notes via commands, a ribbon icon, or a natural-language date switcher.

**Stack:** TypeScript + Svelte 5 for settings UI, Vite bundling to CommonJS, Moment.js for dates, Obsidian Plugin API.

**Key data flow:**
1. Plugin loads → registers icons, commands, settings tab, cache
2. Cache scans vault files, matching filenames/frontmatter to date formats
3. User triggers "open periodic note" → cache lookup → create if missing → open file
4. New files get template content applied via regex-based variable interpolation

The walkthrough follows this flow linearly, starting from types and constants through to the UI layer.

---

## 1. Foundation: Types and Constants

### Types (`src/types.ts`)

The type system is minimal. `Granularity` is a string union of the five supported periods. The `granularities` array provides iteration order (finest to coarsest), which matters for the cache's "finer granularities" queries. `PeriodicConfig` holds per-granularity user settings.

```bash
sed -n "1,29p" src/types.ts
```

```output
export type Granularity = "day" | "week" | "month" | "quarter" | "year";

export const granularities: Granularity[] = [
  "day",
  "week",
  "month",
  "quarter",
  "year",
];

export interface PeriodicConfig {
  enabled: boolean;
  openAtStartup: boolean;

  format: string;
  folder: string;
  templatePath?: string;
}

export interface DateNavigationItem {
  granularity: Granularity;
  date: import("moment").Moment;
  label: string;
  matchData?: {
    exact: boolean;
    matchType: import("./cache").MatchType;
  };
}
```

`DateNavigationItem` is the data structure passed through the switcher UI — it carries a date, its granularity, a display label, and optional match metadata indicating whether it was an exact filename match or a loose/frontmatter match.

### Constants (`src/constants.ts`)

Default date formats follow Moment.js syntax. Note `gggg-[W]ww` for ISO weeks (locale-aware year + week number) versus `YYYY` for calendar year.

```bash
cat src/constants.ts
```

```output
const DEFAULT_DAILY_NOTE_FORMAT = "YYYY-MM-DD";
const DEFAULT_WEEKLY_NOTE_FORMAT = "gggg-[W]ww";
const DEFAULT_MONTHLY_NOTE_FORMAT = "YYYY-MM";
const DEFAULT_QUARTERLY_NOTE_FORMAT = "YYYY-[Q]Q";
const DEFAULT_YEARLY_NOTE_FORMAT = "YYYY";

export const DEFAULT_FORMAT = Object.freeze({
  day: DEFAULT_DAILY_NOTE_FORMAT,
  week: DEFAULT_WEEKLY_NOTE_FORMAT,
  month: DEFAULT_MONTHLY_NOTE_FORMAT,
  quarter: DEFAULT_QUARTERLY_NOTE_FORMAT,
  year: DEFAULT_YEARLY_NOTE_FORMAT,
});

export const DEFAULT_PERIODIC_CONFIG = Object.freeze({
  enabled: false,
  openAtStartup: false,
  format: "",
  templatePath: undefined,
  folder: "",
});

export const HUMANIZE_FORMAT = Object.freeze({
  month: "MMMM YYYY",
  quarter: "YYYY Q[Q]",
  year: "YYYY",
});
```

`DEFAULT_PERIODIC_CONFIG` is the zero-value for a granularity config: disabled, no format (falls back to `DEFAULT_FORMAT`), no template, root folder. `Object.freeze()` prevents accidental mutation of these shared defaults.

---

## 2. Type Augmentation (`src/obsidian.d.ts`)

The plugin extends the Obsidian module's type declarations to type private/undocumented APIs it depends on.

```bash
cat src/obsidian.d.ts
```

```output
import "obsidian";
import type { LocaleOverride, WeekStartOption } from "./settings/localization";

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

  interface VaultSettings {
    localeOverride: LocaleOverride;
    weekStart: WeekStartOption;
  }

  interface Vault {
    config: Record<string, unknown>;
    getConfig<T extends keyof VaultSettings>(setting: T): VaultSettings[T];
    // biome-ignore lint/suspicious/noExplicitAny: Obsidian API lacks type
    setConfig<T extends keyof VaultSettings>(setting: T, value: any): void;
  }

  export interface PluginInstance {
    id: string;
  }

  export interface DailyNotesSettings {
    autorun?: boolean;
    format?: string;
    folder?: string;
    template?: string;
  }

  class DailyNotesPlugin implements PluginInstance {
    options?: DailyNotesSettings;
  }

  export interface App {
    internalPlugins: InternalPlugins;
    plugins: CommunityPluginManager;
  }

  export interface CommunityPluginManager {
    getPlugin(id: string): Plugin;
  }

  export interface InstalledPlugin {
    disable: (onUserDisable: boolean) => void;
    enabled: boolean;
    instance: PluginInstance;
  }

  export interface InternalPlugins {
    plugins: Record<string, InstalledPlugin>;
    getPluginById(id: string): InstalledPlugin;
  }

  interface NLDResult {
    formattedString: string;
    date: Date;
    moment: Moment;
  }

  interface NLDatesPlugin extends Plugin {
    parseDate(dateStr: string): NLDResult;
  }
}
```

**Concern: Private API surface.** This file types several undocumented APIs:
- `Vault.getConfig()` / `Vault.setConfig()` — used for locale and week-start settings (issue #16)
- `App.internalPlugins` — used to detect/disable the built-in Daily Notes plugin
- `App.plugins.getPlugin()` — used to integrate with the nldates-obsidian community plugin
- `NLDatesPlugin.parseDate()` — typed here but owned by a third-party plugin

The custom workspace events (`periodic-notes:settings-updated` and `periodic-notes:resolve`) are properly typed via module augmentation — this is the correct Obsidian pattern for plugin-to-plugin communication.

---

## 3. Plugin Entry Point (`src/main.ts`)

This is where Obsidian loads the plugin. The class extends `Plugin` and wires everything together in `onload()`.

```bash
sed -n "41,90p" src/main.ts
```

```output
export default class PeriodicNotesPlugin extends Plugin {
  public settings!: Writable<Settings>;
  private ribbonEl!: HTMLElement | null;

  private cache!: PeriodicNotesCache;

  async onload(): Promise<void> {
    addIcon("calendar-day", calendarDayIcon);
    addIcon("calendar-week", calendarWeekIcon);
    addIcon("calendar-month", calendarMonthIcon);
    addIcon("calendar-quarter", calendarQuarterIcon);
    addIcon("calendar-year", calendarYearIcon);

    this.settings = writable<Settings>();
    await this.loadSettings();
    this.register(this.settings.subscribe(this.onUpdateSettings.bind(this)));

    initializeLocaleConfigOnce(this.app);

    this.ribbonEl = null;
    this.cache = new PeriodicNotesCache(this.app, this);

    this.openPeriodicNote = this.openPeriodicNote.bind(this);
    this.addSettingTab(new PeriodicNotesSettingsTab(this.app, this));

    this.configureRibbonIcons();
    this.configureCommands();

    this.addCommand({
      id: "show-date-switcher",
      name: "Show date switcher...",
      checkCallback: (checking: boolean) => {
        if (!this.app.plugins.getPlugin("nldates-obsidian")) {
          return false;
        }
        if (checking) {
          return !!this.app.workspace.getMostRecentLeaf();
        }
        new NLDNavigator(this.app, this).open();
      },
      hotkeys: [],
    });

    this.app.workspace.onLayoutReady(() => {
      const startupGranularity = findStartupNoteConfig(this.settings);
      if (startupGranularity) {
        this.openPeriodicNote(startupGranularity, window.moment());
      }
    });
  }
```

The initialization sequence:

1. **Register icons** — Custom SVG calendar icons (from `icons.ts`) for each granularity. These show up in the ribbon and command palette.
2. **Load settings** — Reads persisted data, merges with defaults. Settings live in a Svelte `writable` store so the UI reacts to changes.
3. **Subscribe to settings changes** — `this.register()` ensures the subscription is cleaned up on unload. Every settings change triggers `onUpdateSettings`, which persists to disk and fires a workspace event.
4. **Initialize locale** — Configures Moment.js locale/week-start globally (once per vault session).
5. **Create cache** — The `PeriodicNotesCache` starts indexing vault files.
6. **Register settings tab, ribbon, and commands.**
7. **Date switcher command** — Only available when `nldates-obsidian` is installed (checked via `checkCallback`).
8. **Startup note** — After workspace layout is ready, opens a periodic note if configured.

### Settings persistence and the ribbon

```bash
sed -n "92,149p" src/main.ts
```

```output
  private configureRibbonIcons() {
    this.ribbonEl?.detach();

    const configuredGranularities = getEnabledGranularities(get(this.settings));
    if (configuredGranularities.length) {
      const granularity = configuredGranularities[0];
      const config = displayConfigs[granularity];
      this.ribbonEl = this.addRibbonIcon(
        `calendar-${granularity}`,
        config.labelOpenPresent,
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
        showFileMenu(this.app, this, {
          x: e.pageX,
          y: e.pageY,
        });
      });
    }
  }

  private configureCommands() {
    for (const granularity of granularities) {
      getCommands(this.app, this, granularity).forEach(
        this.addCommand.bind(this),
      );
    }
  }

  async loadSettings(): Promise<void> {
    const savedSettings = await this.loadData();
    const settings = Object.assign({}, DEFAULT_SETTINGS, savedSettings || {});

    if (
      !settings.day &&
      !settings.week &&
      !settings.month &&
      !settings.quarter &&
      !settings.year
    ) {
      settings.day = { ...DEFAULT_PERIODIC_CONFIG, enabled: true };
    }

    this.settings.set(settings);
  }

  private async onUpdateSettings(newSettings: Settings): Promise<void> {
    await this.saveData(newSettings);
    this.configureRibbonIcons();
    this.app.workspace.trigger("periodic-notes:settings-updated");
  }
```

Key details:
- **Ribbon shows the first enabled granularity.** If daily notes are enabled, the icon is `calendar-day`. Right-click shows a context menu with all enabled granularities.
- **First-run default:** If no granularity is configured, daily notes are auto-enabled. This is the only place where settings are mutated outside the settings UI.
- **Settings update cascade:** `onUpdateSettings` → save to disk → reconfigure ribbon → fire `periodic-notes:settings-updated` → cache resets.

### Creating and opening notes

```bash
sed -n "151,220p" src/main.ts
```

```output
  public async createPeriodicNote(
    granularity: Granularity,
    date: Moment,
  ): Promise<TFile> {
    const settings = get(this.settings);
    const config = getConfig(settings, granularity);
    const format = getFormat(settings, granularity);
    const filename = date.format(format);
    const templateContents = await getTemplateContents(
      this.app,
      config.templatePath,
    );
    const renderedContents = applyTemplateTransformations(
      filename,
      granularity,
      date,
      format,
      templateContents,
    );
    const destPath = await getNoteCreationPath(this.app, filename, config);
    return this.app.vault.create(destPath, renderedContents);
  }

  public getPeriodicNote(granularity: Granularity, date: Moment): TFile | null {
    return this.cache.getPeriodicNote(granularity, date);
  }

  public getPeriodicNotes(
    granularity: Granularity,
    date: Moment,
    includeFinerGranularities = false,
  ): PeriodicNoteCachedMetadata[] {
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
  ): PeriodicNoteCachedMetadata | null {
    return this.cache.findAdjacent(filePath, direction);
  }

  public findInCache(filePath: string): PeriodicNoteCachedMetadata | null {
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

`createPeriodicNote` is the core creation path:
1. Format the date into a filename using the configured Moment format
2. Read template file contents from the vault
3. Apply template transformations (variable interpolation)
4. Ensure the destination folder exists, then create the file

`openPeriodicNote` is the primary user-facing entry point: check the cache for an existing note, create one if missing, then open it in the current or a split leaf.

The public API methods (`getPeriodicNote`, `getPeriodicNotes`, `isPeriodic`, `findAdjacent`, `findInCache`) are thin wrappers around the cache — they exist so other plugins or commands can query periodic note data without touching the cache directly.

---

## 4. The Cache (`src/cache.ts`)

The cache is the most complex module. It maintains a `Map<filePath, PeriodicNoteCachedMetadata>` that indexes every file in the vault that matches a periodic note pattern.

```bash
sed -n "22,82p" src/cache.ts
```

```output
export type MatchType = "filename" | "frontmatter" | "date-prefixed";

interface PeriodicNoteMatchData {
  matchType: MatchType;
  exact: boolean;
}

function compareGranularity(a: Granularity, b: Granularity) {
  const idxA = granularities.indexOf(a);
  const idxB = granularities.indexOf(b);
  if (idxA === idxB) return 0;
  if (idxA < idxB) return -1;
  return 1;
}

export interface PeriodicNoteCachedMetadata {
  filePath: string;
  date: Moment;
  granularity: Granularity;
  canonicalDateStr: string;
  matchData: PeriodicNoteMatchData;
}

function getCanonicalDateString(
  _granularity: Granularity,
  date: Moment,
): string {
  return date.toISOString();
}

export class PeriodicNotesCache extends Component {
  public cachedFiles: Map<string, PeriodicNoteCachedMetadata>;

  constructor(
    readonly app: App,
    readonly plugin: PeriodicNotesPlugin,
  ) {
    super();
    this.cachedFiles = new Map();

    this.app.workspace.onLayoutReady(() => {
      console.info("[Periodic Notes] initializing cache");
      this.initialize();
      this.registerEvent(
        this.app.vault.on("create", (file) => {
          if (file instanceof TFile) this.resolve(file, "create");
        }),
      );
      this.registerEvent(this.app.vault.on("rename", this.resolveRename, this));
      this.registerEvent(
        this.app.metadataCache.on("changed", this.resolveChangedMetadata, this),
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
```

The cache extends `Component` (not `Plugin`) — this gives it `registerEvent` for automatic event cleanup without being a full plugin. It waits for `onLayoutReady` before scanning, which ensures the vault's file index is populated.

**Event listeners:**
- `vault.on("create")` — resolve new files against configured formats
- `vault.on("rename")` — delete old path, re-resolve under new path
- `metadataCache.on("changed")` — check frontmatter for date keys
- `periodic-notes:settings-updated` — full cache reset when settings change

### Cache initialization

```bash
sed -n "84,124p" src/cache.ts
```

```output
  public reset(): void {
    console.info("[Periodic Notes] resetting cache");
    this.cachedFiles.clear();
    this.initialize();
  }

  public initialize(): void {
    const settings = get(this.plugin.settings);
    const memoizedRecurseChildren = memoize(
      (rootFolder: TFolder, cb: (file: TAbstractFile) => void) => {
        if (!rootFolder) return;
        for (const c of rootFolder.children) {
          if (c instanceof TFile) {
            cb(c);
          } else if (c instanceof TFolder) {
            memoizedRecurseChildren(c, cb);
          }
        }
      },
    );

    const activeGranularities = granularities.filter(
      (g) => settings[g]?.enabled,
    );
    for (const granularity of activeGranularities) {
      const config = settings[granularity] as PeriodicConfig;
      const rootFolder = this.app.vault.getAbstractFileByPath(
        config.folder || "/",
      ) as TFolder;

      memoizedRecurseChildren(rootFolder, (file: TAbstractFile) => {
        if (file instanceof TFile) {
          this.resolve(file, "initialize");
          const metadata = this.app.metadataCache.getFileCache(file);
          if (metadata) {
            this.resolveChangedMetadata(file, "", metadata);
          }
        }
      });
    }
  }
```

Initialization walks each enabled granularity's configured folder, recursing into subfolders. For each file, it:
1. Calls `resolve()` to try filename-based matching
2. Checks the metadata cache for frontmatter-based matching

The `memoize` from Lodash prevents re-traversing the same folder if multiple granularities share a root. However, Lodash `memoize` only caches by the first argument (the folder), so the callback `cb` is effectively ignored for cache-key purposes — this works because `resolve` internally checks all active granularities anyway.

**Concern:** The `as TFolder` cast on line 112 is unsafe. If the configured folder doesn't exist or is a file, `getAbstractFileByPath` returns `null`, and the cast produces a null `TFolder`. The `memoizedRecurseChildren` guards against this with `if (!rootFolder) return`, but the cast masks the type error.

### File resolution — the heart of the cache

```bash
sed -n "173,240p" src/cache.ts
```

```output
  private resolve(
    file: TFile,
    reason: "create" | "rename" | "initialize" = "create",
  ): void {
    const settings = get(this.plugin.settings);
    const activeGranularities = granularities.filter(
      (g) => settings[g]?.enabled,
    );
    if (activeGranularities.length === 0) return;

    // 'frontmatter' entries should supercede 'filename'
    const existingEntry = this.cachedFiles.get(file.path);
    if (existingEntry && existingEntry.matchData.matchType === "frontmatter") {
      return;
    }

    for (const granularity of activeGranularities) {
      const folder = settings[granularity]?.folder || "";
      if (!file.path.startsWith(folder)) continue;

      const formats = getPossibleFormats(settings, granularity);
      const dateInputStr = getDateInput(file, formats[0], granularity);
      const date = window.moment(dateInputStr, formats, true);
      if (date.isValid()) {
        const metadata = {
          filePath: file.path,
          date,
          granularity,
          canonicalDateStr: getCanonicalDateString(granularity, date),
          matchData: {
            exact: true,
            matchType: "filename",
          },
        } as PeriodicNoteCachedMetadata;
        this.set(file.path, metadata);

        if (reason === "create" && file.stat.size === 0) {
          applyPeriodicTemplateToFile(this.app, file, settings, metadata);
        }

        this.app.workspace.trigger("periodic-notes:resolve", granularity, file);
        return;
      }
    }

    const nonStrictDate = getLooselyMatchedDate(file.basename);
    if (nonStrictDate) {
      this.set(file.path, {
        filePath: file.path,
        date: nonStrictDate.date,
        granularity: nonStrictDate.granularity,
        canonicalDateStr: getCanonicalDateString(
          nonStrictDate.granularity,
          nonStrictDate.date,
        ),
        matchData: {
          exact: false,
          matchType: "filename",
        },
      });

      this.app.workspace.trigger(
        "periodic-notes:resolve",
        nonStrictDate.granularity,
        file,
      );
    }
  }
```

Resolution strategy (in priority order):

1. **Frontmatter match** — If a file already has a frontmatter-based cache entry, skip filename resolution. Frontmatter is authoritative.
2. **Strict filename match** — Try to parse the file's name (or path segments for nested formats) using each enabled granularity's configured format. Uses `moment(input, formats, true)` — the `true` enables strict parsing.
3. **Loose filename match** — Falls back to `getLooselyMatchedDate()` which uses regex patterns to extract dates from filenames that don't match any configured format.

**Critical concern (issue #20):** On line 210, when a newly created file is empty, `applyPeriodicTemplateToFile()` is called **without `await`**. This async function reads the template and writes to the file, but if it fails (template not found, vault error), the error is silently lost. The user sees an empty note.

**Concern:** The first granularity that matches wins (due to `return` on line 214). If a filename like `2025-01` could match both monthly (`YYYY-MM`) and be part of a daily format, the iteration order (`day → week → month → quarter → year`) determines the match. This is generally correct since finer granularities are more specific.

### Cache queries and navigation

```bash
sed -n "242,314p" src/cache.ts
```

```output
  public getPeriodicNote(
    granularity: Granularity,
    targetDate: Moment,
  ): TFile | null {
    for (const [filePath, cacheData] of this.cachedFiles) {
      if (
        cacheData.granularity === granularity &&
        cacheData.matchData.exact === true &&
        cacheData.date.isSame(targetDate, granularity)
      ) {
        return this.app.vault.getAbstractFileByPath(filePath) as TFile;
      }
    }
    return null;
  }

  public getPeriodicNotes(
    granularity: Granularity,
    targetDate: Moment,
    includeFinerGranularities = false,
  ): PeriodicNoteCachedMetadata[] {
    const matches: PeriodicNoteCachedMetadata[] = [];
    for (const [, cacheData] of this.cachedFiles) {
      if (
        (granularity === cacheData.granularity ||
          (includeFinerGranularities &&
            compareGranularity(cacheData.granularity, granularity) <= 0)) &&
        cacheData.date.isSame(targetDate, granularity)
      ) {
        matches.push(cacheData);
      }
    }
    return matches;
  }

  private set(filePath: string, metadata: PeriodicNoteCachedMetadata) {
    this.cachedFiles.set(filePath, metadata);
  }

  public isPeriodic(targetPath: string, granularity?: Granularity): boolean {
    const metadata = this.cachedFiles.get(targetPath);
    if (!metadata) return false;
    if (!granularity) return true;
    return granularity === metadata.granularity;
  }

  public find(filePath: string | undefined): PeriodicNoteCachedMetadata | null {
    if (!filePath) return null;
    return this.cachedFiles.get(filePath) ?? null;
  }

  public findAdjacent(
    filePath: string,
    direction: "forwards" | "backwards",
  ): PeriodicNoteCachedMetadata | null {
    const currMetadata = this.find(filePath);
    if (!currMetadata) return null;

    const granularity = currMetadata.granularity;
    const sortedCache = sortBy(
      Array.from(this.cachedFiles.values()).filter(
        (m) => m.granularity === granularity,
      ),
      ["canonicalDateStr"],
    );
    const activeNoteIndex = sortedCache.findIndex(
      (m) => m.filePath === filePath,
    );

    const offset = direction === "forwards" ? 1 : -1;
    return sortedCache[activeNoteIndex + offset] ?? null;
  }
}
```

- `getPeriodicNote()` finds a single exact-match note for a date and granularity. Uses `date.isSame(targetDate, granularity)` — Moment's unit-aware comparison (e.g., two dates in the same week are "same" at `week` granularity).

- **Concern (issue #24):** Line 252 casts the result of `getAbstractFileByPath` to `TFile` without a null check. If the file was deleted but the cache hasn't been updated yet, this returns null typed as TFile.

- `getPeriodicNotes()` returns all cached notes within a period, optionally including finer granularities (e.g., all daily notes within a given month). The `compareGranularity` function uses the `granularities` array index order.

- `findAdjacent()` enables forward/backward navigation. It sorts all notes of the same granularity by `canonicalDateStr` (ISO 8601), finds the current note's index, then returns the next or previous entry. The `sortBy` runs on every call — not memoized, but the cache is typically small enough that this doesn't matter.

---

## 5. Date Parsing (`src/parser.ts`)

The loose date parser provides a fallback when filenames don't match any configured format. It uses three progressively less specific regex patterns.

```bash
cat src/parser.ts
```

```output
import type { Moment } from "moment";

import type { Granularity } from "./types";

interface ParseData {
  granularity: Granularity;
  date: Moment;
}

const FULL_DATE_PATTERN =
  /(\d{4})[-.]?(0[1-9]|1[0-2])[-.]?(0[1-9]|[12][0-9]|3[01])/;
const MONTH_PATTERN = /(\d{4})[-.]?(0[1-9]|1[0-2])/;
const YEAR_PATTERN = /(\d{4})/;

export function getLooselyMatchedDate(inputStr: string): ParseData | null {
  const fullDateExp = FULL_DATE_PATTERN.exec(inputStr);
  if (fullDateExp) {
    return {
      date: window.moment({
        day: Number(fullDateExp[3]),
        month: Number(fullDateExp[2]) - 1,
        year: Number(fullDateExp[1]),
      }),
      granularity: "day",
    };
  }

  const monthDateExp = MONTH_PATTERN.exec(inputStr);
  if (monthDateExp) {
    return {
      date: window.moment({
        day: 1,
        month: Number(monthDateExp[2]) - 1,
        year: Number(monthDateExp[1]),
      }),
      granularity: "month",
    };
  }

  const yearExp = YEAR_PATTERN.exec(inputStr);
  if (yearExp) {
    return {
      date: window.moment({
        day: 1,
        month: 0,
        year: Number(yearExp[1]),
      }),
      granularity: "year",
    };
  }

  return null;
}
```

The patterns try most-specific first: `YYYY-MM-DD` → `YYYY-MM` → `YYYY`. The separators are optional or can be dots. This matches filenames like `Meeting notes 2025-03-08` or `202503` — any filename containing a recognizable date substring.

Note that `week` and `quarter` granularities are not handled by loose matching. Only `day`, `month`, and `year` have regex patterns. Loose-matched entries are marked `exact: false` and are used by the Related Files Switcher to find notes associated with a period.

---

## 6. Utilities (`src/utils.ts`)

This is the largest source file. It handles template processing, path manipulation, and config helpers.

### Template transformations

```bash
sed -n "49,177p" src/utils.ts
```

```output
export function applyTemplateTransformations(
  filename: string,
  granularity: Granularity,
  date: Moment,
  format: string,
  rawTemplateContents: string,
): string {
  let templateContents = rawTemplateContents;

  templateContents = rawTemplateContents
    .replace(/{{\s*date\s*}}/gi, filename)
    .replace(/{{\s*time\s*}}/gi, window.moment().format("HH:mm"))
    .replace(/{{\s*title\s*}}/gi, filename);

  if (granularity === "day") {
    templateContents = templateContents
      .replace(
        /{{\s*yesterday\s*}}/gi,
        date.clone().subtract(1, "day").format(format),
      )
      .replace(/{{\s*tomorrow\s*}}/gi, date.clone().add(1, "d").format(format))
      .replace(
        /{{\s*(date|time)\s*(([+-]\d+)([yqmwdhs]))?\s*(:.+?)?}}/gi,
        (_, _timeOrDate, calc, timeDelta, unit, momentFormat) => {
          const now = window.moment();
          const currentDate = date.clone().set({
            hour: now.get("hour"),
            minute: now.get("minute"),
            second: now.get("second"),
          });
          if (calc) {
            currentDate.add(parseInt(timeDelta, 10), unit);
          }

          if (momentFormat) {
            return currentDate.format(momentFormat.substring(1).trim());
          }
          return currentDate.format(format);
        },
      );
  }

  if (granularity === "week") {
    templateContents = templateContents.replace(
      /{{\s*(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\s*:(.*?)}}/gi,
      (_, dayOfWeek, momentFormat) => {
        const day = getDayOfWeekNumericalValue(dayOfWeek);
        return date.weekday(day).format(momentFormat.trim());
      },
    );
  }

  if (granularity === "month") {
    templateContents = templateContents.replace(
      /{{\s*(month)\s*(([+-]\d+)([yqmwdhs]))?\s*(:.+?)?}}/gi,
      (_, _timeOrDate, calc, timeDelta, unit, momentFormat) => {
        const now = window.moment();
        const monthStart = date
          .clone()
          .startOf("month")
          .set({
            hour: now.get("hour"),
            minute: now.get("minute"),
            second: now.get("second"),
          });
        if (calc) {
          monthStart.add(parseInt(timeDelta, 10), unit);
        }

        if (momentFormat) {
          return monthStart.format(momentFormat.substring(1).trim());
        }
        return monthStart.format(format);
      },
    );
  }

  if (granularity === "quarter") {
    templateContents = templateContents.replace(
      /{{\s*(quarter)\s*(([+-]\d+)([yqmwdhs]))?\s*(:.+?)?}}/gi,
      (_, _timeOrDate, calc, timeDelta, unit, momentFormat) => {
        const now = window.moment();
        const monthStart = date
          .clone()
          .startOf("quarter")
          .set({
            hour: now.get("hour"),
            minute: now.get("minute"),
            second: now.get("second"),
          });
        if (calc) {
          monthStart.add(parseInt(timeDelta, 10), unit);
        }

        if (momentFormat) {
          return monthStart.format(momentFormat.substring(1).trim());
        }
        return monthStart.format(format);
      },
    );
  }

  if (granularity === "year") {
    templateContents = templateContents.replace(
      /{{\s*(year)\s*(([+-]\d+)([yqmwdhs]))?\s*(:.+?)?}}/gi,
      (_, _timeOrDate, calc, timeDelta, unit, momentFormat) => {
        const now = window.moment();
        const monthStart = date
          .clone()
          .startOf("year")
          .set({
            hour: now.get("hour"),
            minute: now.get("minute"),
            second: now.get("second"),
          });
        if (calc) {
          monthStart.add(parseInt(timeDelta, 10), unit);
        }

        if (momentFormat) {
          return monthStart.format(momentFormat.substring(1).trim());
        }
        return monthStart.format(format);
      },
    );
  }

  return templateContents;
}
```

**Universal variables** (all granularities):
- `{{date}}` / `{{title}}` → formatted filename
- `{{time}}` → current time as `HH:mm`

**Daily-specific:**
- `{{yesterday}}` / `{{tomorrow}}` → adjacent dates in the configured format
- `{{date +Nd}}` or `{{time -1w:YYYY-MM-DD}}` → offset dates with optional custom format

**Weekly-specific:**
- `{{monday:YYYY-MM-DD}}` → specific weekday within the week, with a format

**Monthly/Quarterly/Yearly:**
- `{{month}}`, `{{quarter}}`, `{{year}}` → period start date, with optional offset and format
- Example: `{{month +1:MMMM YYYY}}` → next month's name and year

**Concern (issue #13): Duplicated pattern.** The month, quarter, and year handlers (lines 101-173) are structurally identical — same regex shape, same callback body, differing only in the `startOf()` argument and the regex keyword. This is ~70 lines of duplication that could be a parameterized helper.

**Concern (issue #12): Misleading variable name.** The local variable `monthStart` is used in the quarter and year handlers, even though it represents the start of a quarter or year. This makes the code confusing to read and maintain.

### File creation helpers

```bash
sed -n "220,315p" src/utils.ts
```

```output
export async function applyPeriodicTemplateToFile(
  app: App,
  file: TFile,
  settings: Settings,
  metadata: PeriodicNoteCachedMetadata,
) {
  const format = getFormat(settings, metadata.granularity);
  const templateContents = await getTemplateContents(
    app,
    settings[metadata.granularity]?.templatePath,
  );
  const renderedContents = applyTemplateTransformations(
    file.basename,
    metadata.granularity,
    metadata.date,
    format,
    templateContents,
  );
  return app.vault.modify(file, renderedContents);
}

export async function getTemplateContents(
  app: App,
  templatePath: string | undefined,
): Promise<string> {
  const { metadataCache, vault } = app;
  const normalizedTemplatePath = normalizePath(templatePath ?? "");
  if (templatePath === "/") {
    return Promise.resolve("");
  }

  try {
    const templateFile = metadataCache.getFirstLinkpathDest(
      normalizedTemplatePath,
      "",
    );
    return templateFile ? vault.cachedRead(templateFile) : "";
  } catch (err) {
    console.error(
      `Failed to read the daily note template '${normalizedTemplatePath}'`,
      err,
    );
    new Notice("Failed to read the daily note template");
    return "";
  }
}

export async function getNoteCreationPath(
  app: App,
  filename: string,
  periodicConfig: PeriodicConfig,
): Promise<string> {
  const directory = periodicConfig.folder ?? "";
  const filenameWithExt = !filename.endsWith(".md")
    ? `${filename}.md`
    : filename;

  const path = normalizePath(join(directory, filenameWithExt));
  await ensureFolderExists(app, path);
  return path;
}

// Credit: @creationix/path.js
export function join(...partSegments: string[]): string {
  // Split the inputs into a list of path commands.
  let parts: string[] = [];
  for (let i = 0, l = partSegments.length; i < l; i++) {
    parts = parts.concat(partSegments[i].split("/"));
  }
  // Interpret the path commands to get the new resolved path.
  const newParts = [];
  for (let i = 0, l = parts.length; i < l; i++) {
    const part = parts[i];
    // Remove leading and trailing slashes
    // Also remove "." segments
    if (!part || part === ".") continue;
    // Push new path segments.
    else newParts.push(part);
  }
  // Preserve the initial slash if there was one.
  if (parts[0] === "") newParts.unshift("");
  // Turn back into a single string path.
  return newParts.join("/");
}

async function ensureFolderExists(app: App, path: string): Promise<void> {
  const dirs = path.replace(/\\/g, "/").split("/");
  dirs.pop(); // remove basename

  if (dirs.length) {
    const dir = join(...dirs);
    if (!app.vault.getAbstractFileByPath(dir)) {
      await app.vault.createFolder(dir);
    }
  }
}
```

- `applyPeriodicTemplateToFile()` — the function called (without await) from the cache on file creation. Reads template, transforms it, writes to file.
- `getTemplateContents()` — resolves the template path via Obsidian's link resolution, reads it with `cachedRead`. Returns empty string if no template is configured.
- `getNoteCreationPath()` — combines folder + filename + `.md` extension, creates intermediate folders if needed.
- `join()` — a custom path joiner (credited to `@creationix/path.js`). Handles slash normalization without Node's `path` module (which is external in the Obsidian environment).
- `ensureFolderExists()` — extracts the directory portion from a path and creates it if missing. Only handles a single level of nesting.

---

## 7. Settings Validation (`src/settings/validation.ts`)

Format strings are validated before being used to ensure they produce parseable filenames.

```bash
cat src/settings/validation.ts
```

```output
import { type App, normalizePath, type TFile } from "obsidian";
import type { Granularity } from "src/types";

export function removeEscapedCharacters(format: string): string {
  const withoutBrackets = format.replace(/\[[^\]]*\]/g, ""); // remove everything within brackets

  return withoutBrackets.replace(/\\./g, "");
}

function pathWithoutExtension(file: TFile): string {
  const extLen = file.extension.length + 1;
  return file.path.slice(0, -extLen);
}

function getBasename(format: string): string {
  const isTemplateNested = format.indexOf("/") !== -1;
  return isTemplateNested ? (format.split("/").pop() ?? "") : format;
}

function isValidFilename(filename: string): boolean {
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
  if (!format) {
    return "";
  }

  if (!isValidFilename(format)) {
    return "Format contains illegal characters";
  }

  if (granularity === "day") {
    const testFormattedDate = window.moment().format(format);
    const parsedDate = window.moment(testFormattedDate, format, true);

    if (!parsedDate.isValid()) {
      return "Failed to parse format";
    }
  }

  return "";
}

export function validateFormatComplexity(
  format: string,
  granularity: Granularity,
): "valid" | "fragile-basename" | "loose-parsing" {
  const testFormattedDate = window.moment().format(format);
  const parsedDate = window.moment(testFormattedDate, format, true);
  if (!parsedDate.isValid()) {
    return "loose-parsing";
  }

  const strippedFormat = removeEscapedCharacters(format);
  if (strippedFormat.includes("/")) {
    if (
      granularity === "day" &&
      !["m", "d", "y"].every(
        (requiredChar) =>
          getBasename(format)
            .replace(/\[[^\]]*\]/g, "") // remove everything within brackets
            .toLowerCase()
            .indexOf(requiredChar) !== -1,
      )
    ) {
      return "fragile-basename";
    }
  }

  return "valid";
}

export function getDateInput(
  file: TFile,
  format: string,
  granularity: Granularity,
): string {
  // pseudo-intelligently find files when the format is YYYY/MM/DD for example
  if (validateFormatComplexity(format, granularity) === "fragile-basename") {
    const fileName = pathWithoutExtension(file);
    const strippedFormat = removeEscapedCharacters(format);
    const nestingLvl = (strippedFormat.match(/\//g)?.length ?? 0) + 1;
    const pathParts = fileName.split("/");
    return pathParts.slice(-nestingLvl).join("/");
  }
  return file.basename;
}

export function validateTemplate(app: App, template: string): string {
  if (!template) {
    return "";
  }

  const file = app.metadataCache.getFirstLinkpathDest(template, "");
  if (!file) {
    return "Template file not found";
  }

  return "";
}

export function validateFolder(app: App, folder: string): string {
  if (!folder || folder === "/") {
    return "";
  }

  if (!app.vault.getAbstractFileByPath(normalizePath(folder))) {
    return "Folder not found in vault";
  }

  return "";
}
```

Key validation concepts:

- **`removeEscapedCharacters`** strips Moment.js escape sequences (`[text]` and `\x`) from formats before analysis. This is critical because `gggg-[W]ww` contains a literal "W" that shouldn't be treated as a format token.

- **`isValidFilename`** checks against OS restrictions: illegal characters (`?<>:*|"`), control characters, reserved names (`.`, `..`), and Windows reserved device names (CON, PRN, COM1, LPT, etc.).

- **`validateFormat`** does a round-trip test: format today → parse it back → check if valid. Only runs the parse test for daily notes (other granularities may have formats that don't survive strict round-trip parsing).

- **`validateFormatComplexity`** detects nested formats like `YYYY/MM/DD` where the basename alone (`DD`) isn't enough to uniquely identify a date. Returns `"fragile-basename"` if daily format's basename lacks month/day/year tokens.

- **`getDateInput`** handles the inverse problem: given a file with a nested path format, extract the right number of path segments to reconstruct the full date string for parsing.

---

## 8. Localization (`src/settings/localization.ts`)

Configures Moment.js locale and week-start globally for the vault.

```bash
sed -n "63,138p" src/settings/localization.ts
```

```output
function overrideGlobalMomentWeekStart(weekStart: WeekStartOption): void {
  const { moment } = window;
  const currentLocale = moment.locale();

  // Save the initial locale weekspec so that we can restore
  // it when toggling between the different options in settings.
  if (!window._bundledLocaleWeekSpec) {
    // biome-ignore lint/suspicious/noExplicitAny: Obsidian API lacks type
    window._bundledLocaleWeekSpec = (<any>moment.localeData())._week;
  }

  if (weekStart === "locale") {
    moment.updateLocale(currentLocale, {
      week: window._bundledLocaleWeekSpec,
    });
  } else {
    moment.updateLocale(currentLocale, {
      week: {
        dow: weekdays.indexOf(weekStart) || 0,
      },
    });
  }
}

/**
 * Sets the locale used by the calendar. This allows the calendar to
 * default to the user's locale (e.g. Start Week on Sunday/Monday/Friday)
 *
 * @param localeOverride locale string (e.g. "en-US")
 */
export function configureGlobalMomentLocale(
  localeOverride: LocaleOverride = "system-default",
  weekStart: WeekStartOption = "locale",
): string {
  const obsidianLang = localStorage.getItem("language") || "en";
  const systemLang = navigator.language?.toLowerCase();

  let momentLocale = langToMomentLocale[obsidianLang];

  if (localeOverride !== "system-default") {
    momentLocale = localeOverride;
  } else if (systemLang.startsWith(obsidianLang)) {
    // If the system locale is more specific (en-gb vs en), use the system locale.
    momentLocale = systemLang;
  }

  const currentLocale = window.moment.locale(momentLocale);
  console.debug(
    `[Periodic Notes] Trying to switch Moment.js global locale to ${momentLocale}, got ${currentLocale}`,
  );

  overrideGlobalMomentWeekStart(weekStart);

  return currentLocale;
}

export function initializeLocaleConfigOnce(app: App) {
  if (window._hasConfiguredLocale) {
    return;
  }

  const localization = getLocalizationSettings(app);
  const { localeOverride, weekStart } = localization;

  configureGlobalMomentLocale(localeOverride, weekStart);

  window._hasConfiguredLocale = true;
}

export function getLocalizationSettings(app: App): LocalizationSettings {
  // private API: vault.getConfig is undocumented
  const localeOverride =
    app.vault.getConfig("localeOverride") ?? "system-default";
  const weekStart = app.vault.getConfig("weekStart") ?? "locale";
  return { localeOverride, weekStart };
}
```

**Private API concerns (issues #15, #16):**
- `moment.localeData()._week` — accesses Moment.js's internal `_week` property to save the bundled locale's week specification before overriding it. This is undocumented and could break with Moment.js updates.
- `vault.getConfig("localeOverride")` / `vault.getConfig("weekStart")` — reads Obsidian's internal vault configuration. Undocumented API.

The `window._bundledLocaleWeekSpec` and `window._hasConfiguredLocale` globals are declared in `localization.ts` and typed in its local `declare global` block. They persist across plugin reloads within the same vault session — the `_hasConfiguredLocale` flag prevents re-initialization.

The `langToMomentLocale` mapping (lines 23-46, not shown) translates Obsidian's language codes to Moment.js locale strings, handling mismatches like `cz` → `cs` and `no` → `nn`.

---

## 9. Settings UI Layer

### Settings Tab (`src/settings/index.ts`)

```bash
cat src/settings/index.ts
```

```output
import { type App, PluginSettingTab } from "obsidian";
import type { PeriodicConfig } from "src/types";
import { mount, unmount } from "svelte";

import type PeriodicNotesPlugin from "../main";
import SettingsPage from "./pages/SettingsPage.svelte";

export interface Settings {
  showGettingStartedBanner: boolean;
  installedVersion: string;

  day?: PeriodicConfig;
  week?: PeriodicConfig;
  month?: PeriodicConfig;
  quarter?: PeriodicConfig;
  year?: PeriodicConfig;
}

export const DEFAULT_SETTINGS: Settings = {
  installedVersion: "1.0.0-beta3",
  showGettingStartedBanner: true,
};

export class PeriodicNotesSettingsTab extends PluginSettingTab {
  private view!: Record<string, unknown>;

  constructor(
    readonly app: App,
    readonly plugin: PeriodicNotesPlugin,
  ) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    this.containerEl.empty();

    this.view = mount(SettingsPage, {
      target: this.containerEl,
      props: {
        app: this.app,
        settings: this.plugin.settings,
      },
    });
  }

  hide() {
    super.hide();
    if (this.view) {
      unmount(this.view);
    }
  }
}
```

The `Settings` interface uses optional `PeriodicConfig` properties for each granularity — `undefined` means the granularity hasn't been configured yet.

The settings tab uses Svelte 5's `mount()`/`unmount()` API (not the legacy `new Component()` constructor). The Svelte component receives the `Writable<Settings>` store as a prop, which enables two-way binding — UI changes update the store, which triggers `onUpdateSettings` in the plugin.

### Settings page structure

The `SettingsPage.svelte` renders:
1. An optional Getting Started banner (for first-time users)
2. A `PeriodicGroup` for each granularity
3. Localization controls (week start, locale)

```bash
sed -n "1,40p" src/settings/pages/details/PeriodicGroup.svelte
```

```output
<script lang="ts">
  import type { App } from "obsidian";
  import { slide } from "svelte/transition";
  import capitalize from "lodash/capitalize";

  import { displayConfigs } from "src/commands";
  import NoteFormatSetting from "src/settings/components/NoteFormatSetting.svelte";
  import NoteTemplateSetting from "src/settings/components/NoteTemplateSetting.svelte";
  import NoteFolderSetting from "src/settings/components/NoteFolderSetting.svelte";
  import type { Granularity } from "src/types";
  import Arrow from "src/settings/components/Arrow.svelte";
  import { DEFAULT_PERIODIC_CONFIG } from "src/constants";
  import type { Settings } from "src/settings";
  import type { Writable } from "svelte/store";
  import writableDerived from "svelte-writable-derived";
  import OpenAtStartupSetting from "src/settings/components/OpenAtStartupSetting.svelte";

  let { app, granularity, settings }: {
    app: App;
    granularity: Granularity;
    settings: Writable<Settings>;
  } = $props();

  let displayConfig = $derived(displayConfigs[granularity]);
  let isExpanded = $state(false);

  // svelte-ignore state_referenced_locally
  let config = writableDerived(
    settings,
    ($settings) => $settings[granularity] ?? { ...DEFAULT_PERIODIC_CONFIG },
    (reflecting, $settings) => {
      $settings[granularity] = reflecting;
      return $settings;
    },
  );

  function toggleExpand() {
    isExpanded = !isExpanded;
  }
</script>
```

Each `PeriodicGroup` uses `svelte-writable-derived` to create a two-way derived store. It reads `$settings[granularity]` (falling back to `DEFAULT_PERIODIC_CONFIG` if undefined), and writes changes back to the parent store with `$settings[granularity] = reflecting`. This pattern lets each group manage its own config slice while keeping the parent store as the single source of truth.

The group renders as a collapsible section (with `slide` transition) containing four setting components: Format, Folder, Template, and Open at Startup. The enable/disable toggle is on the group header itself.

---

## 10. Commands (`src/commands.ts`)

Commands provide keyboard-driven access to periodic note operations.

```bash
sed -n "41,84p" src/commands.ts
```

```output
async function jumpToAdjacentNote(
  app: App,
  plugin: PeriodicNotesPlugin,
  direction: "forwards" | "backwards",
): Promise<void> {
  const activeFile = app.workspace.getActiveFile();
  if (!activeFile) return;
  const activeFileMeta = plugin.findInCache(activeFile.path);
  if (!activeFileMeta) return;

  const adjacentNoteMeta = plugin.findAdjacent(activeFile.path, direction);

  if (adjacentNoteMeta) {
    const file = app.vault.getAbstractFileByPath(adjacentNoteMeta.filePath);
    if (file && file instanceof TFile) {
      const leaf = app.workspace.getLeaf();
      await leaf.openFile(file, { active: true });
    }
  } else {
    const qualifier = direction === "forwards" ? "after" : "before";
    new Notice(
      `There's no ${
        displayConfigs[activeFileMeta.granularity].periodicity
      } note ${qualifier} this`,
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
  const activeFileMeta = plugin.findInCache(activeFile.path);
  if (!activeFileMeta) return;

  const offset = direction === "forwards" ? 1 : -1;
  const adjacentDate = activeFileMeta.date
    .clone()
    .add(offset, activeFileMeta.granularity);

  plugin.openPeriodicNote(activeFileMeta.granularity, adjacentDate);
```

Two navigation patterns:

1. **`jumpToAdjacentNote`** — finds the nearest existing periodic note in the given direction. If there's a daily note for March 5 and March 8 (but not 6 or 7), "jump forwards" from March 5 goes to March 8. Shows a Notice if no note exists in that direction.

2. **`openAdjacentNote`** — calculates the next/previous date mathematically (e.g., tomorrow, next week) and opens or creates it. This always works because it doesn't depend on existing notes.

Each granularity registers 5 commands via `getCommands()`:
- `open-{periodicity}-note` — open today/this week/etc.
- `next-{periodicity}-note` / `prev-{periodicity}-note` — jump to existing adjacent
- `open-next-{periodicity}-note` / `open-prev-{periodicity}-note` — create and open adjacent

The jump and open-adjacent commands use `checkCallback` to only appear in the command palette when the active file is a periodic note of the matching granularity.

Good practice: Note the `instanceof TFile` check in `jumpToAdjacentNote` (line 55) — this is the defensive pattern that's missing in `cache.ts:252`.

---

## 11. Context Menu (`src/modal.ts`)

```bash
cat src/modal.ts
```

```output
import { type App, Menu, type Point } from "obsidian";
import { get } from "svelte/store";
import { displayConfigs } from "./commands";
import type PeriodicNotesPlugin from "./main";
import { getEnabledGranularities } from "./settings/utils";

export function showFileMenu(
  _app: App,
  plugin: PeriodicNotesPlugin,
  position: Point,
): void {
  const contextMenu = new Menu();

  getEnabledGranularities(get(plugin.settings)).forEach((granularity) => {
    const config = displayConfigs[granularity];
    contextMenu.addItem((item) =>
      item
        .setTitle(config.labelOpenPresent)
        .setIcon(`calendar-${granularity}`)
        .onClick(() => {
          plugin.openPeriodicNote(granularity, window.moment());
        }),
    );
  });

  contextMenu.showAtPosition(position);
}
```

Simple context menu that appears on right-clicking the ribbon icon. Lists all enabled granularities with their calendar icons. Each item opens the current period's note for that granularity. Uses Obsidian's `Menu` API and `Point` for positioning.

---

## 12. Date Switcher (`src/switcher/switcher.ts`)

The date switcher integrates with the `nldates-obsidian` plugin to provide natural language date navigation.

```bash
sed -n "25,61p" src/switcher/switcher.ts
```

```output
export class NLDNavigator extends SuggestModal<DateNavigationItem> {
  private nlDatesPlugin: NLDatesPlugin;

  constructor(
    readonly app: App,
    readonly plugin: PeriodicNotesPlugin,
  ) {
    super(app);

    this.setInstructions(DEFAULT_INSTRUCTIONS);
    this.setPlaceholder("Type date to find related notes");

    this.nlDatesPlugin = app.plugins.getPlugin(
      "nldates-obsidian",
    ) as NLDatesPlugin;

    this.scope.register(["Meta"], "Enter", (evt: KeyboardEvent) => {
      // @ts-expect-error this.chooser exists but is not exposed
      this.chooser.useSelectedItem(evt);
    });

    this.scope.register([], "Tab", (evt: KeyboardEvent) => {
      evt.preventDefault();
      this.close();
      new RelatedFilesSwitcher(
        this.app,
        this.plugin,
        this.getSelectedItem(),
        this.inputEl.value,
      ).open();
    });
  }

  private getSelectedItem(): DateNavigationItem {
    // biome-ignore lint/suspicious/noExplicitAny: Obsidian API lacks type
    return (this as any).chooser.values[(this as any).chooser.selectedItem];
  }
```

The switcher extends `SuggestModal` — Obsidian's fuzzy search modal pattern. Key interactions:
- **Meta+Enter** → open in split pane (uses private `this.chooser` API — issue #14)
- **Tab** → close this modal and open `RelatedFilesSwitcher` for the selected date
- **Enter** → default `onChooseSuggestion` handler opens the periodic note

**Concern (issue #14):** `this.chooser` is an internal Obsidian API property. It's used twice: once to trigger selection (line 43) and once to read the selected item (line 60). Both are suppressed with biome-ignore/ts-expect-error comments. If Obsidian renames or restructures this internal, both operations fail silently.

### Suggestion generation

The switcher provides three types of suggestions:
1. **Quick suggestions** — pre-built suggestions for relative dates ("today", "yesterday", "this week", "next month", "last year")
2. **Relative expressions** — patterns like "next Monday", "in 3 days", "5 weeks ago"
3. **NLDates fallback** — arbitrary natural language parsed by the nldates plugin

All suggestions are filtered to only show enabled granularities.

---

## 13. Related Files Switcher (`src/switcher/relatedFilesSwitcher.ts`)

```bash
sed -n "62,112p" src/switcher/relatedFilesSwitcher.ts
```

```output
  private getDatePrefixedNotes(
    item: DateNavigationItem,
    query: string,
  ): DateNavigationItem[] {
    return this.plugin
      .getPeriodicNotes(
        item.granularity,
        item.date,
        this.includeFinerGranularities,
      )
      .filter((e) => e.matchData.exact === false)
      .filter((e) =>
        e.filePath.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
      )
      .map((e) => ({
        label: e.filePath,
        date: e.date,
        granularity: e.granularity,
        matchData: e.matchData,
      }));
  }

  getSuggestions(query: string): DateNavigationItem[] {
    return this.getDatePrefixedNotes(this.selectedItem, query);
  }

  renderSuggestion(value: DateNavigationItem, el: HTMLElement) {
    el.setText(value.label);
    el.createEl("div", {
      cls: "suggestion-note",
      text: value.date.format(DEFAULT_FORMAT[value.granularity]),
    });
    el.createEl("span", { cls: "suggestion-flair", prepend: true }, (el) => {
      setIcon(el, `calendar-${value.granularity}`);
    });
  }

  async onChooseSuggestion(
    item: DateNavigationItem,
    evt: MouseEvent | KeyboardEvent,
  ) {
    const file = this.app.vault.getAbstractFileByPath(item.label);
    if (file && file instanceof TFile) {
      const inNewSplit = evt.shiftKey;
      const leaf = inNewSplit
        ? this.app.workspace.getLeaf("split")
        : this.app.workspace.getLeaf();
      await leaf.openFile(file, { active: true });
    }
  }
}
```

The Related Files Switcher shows non-exact (loosely matched) notes that fall within the selected period. For example, selecting "this week" shows all files whose names contain dates within that week but aren't formal weekly notes.

The `*` (Shift+8) toggle expands to include finer granularities — pressing it while viewing a month's related files would also show daily and weekly notes within that month.

Tab navigates back to the main date switcher, preserving the original query.

Good practice: `onChooseSuggestion` (line 103) uses `instanceof TFile` before opening — the safe pattern.

---

## 14. File Suggest UI (`src/ui/fileSuggest.ts`)

```bash
cat src/ui/fileSuggest.ts
```

```output
import { AbstractInputSuggest, type TFile, type TFolder } from "obsidian";

export class FileSuggest extends AbstractInputSuggest<TFile> {
  getSuggestions(query: string): TFile[] {
    const lowerQuery = query.toLowerCase();
    return this.app.vault
      .getMarkdownFiles()
      .filter((file) => file.path.toLowerCase().contains(lowerQuery));
  }

  renderSuggestion(file: TFile, el: HTMLElement): void {
    el.setText(file.path);
  }

  selectSuggestion(file: TFile): void {
    this.setValue(file.path);
    this.close();
  }
}

export class FolderSuggest extends AbstractInputSuggest<TFolder> {
  getSuggestions(query: string): TFolder[] {
    const lowerQuery = query.toLowerCase();
    return this.app.vault
      .getAllFolders()
      .filter((folder) => folder.path.toLowerCase().contains(lowerQuery));
  }

  renderSuggestion(folder: TFolder, el: HTMLElement): void {
    el.setText(folder.path);
  }

  selectSuggestion(folder: TFolder): void {
    this.setValue(folder.path);
    this.close();
  }
}
```

Two autocomplete components used in settings: `FileSuggest` for template file paths, `FolderSuggest` for note folder paths. Both extend `AbstractInputSuggest` — Obsidian's built-in input suggestion pattern. Simple substring matching against vault contents.

---

## 15. Build System

### Vite Configuration (`vite.config.ts`)

```bash
cat vite.config.ts
```

```output
import { copyFileSync } from "node:fs";
import path from "node:path";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

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

Obsidian plugins must be a single CommonJS file. The Vite config:
- Uses `formats: ["cjs"]` to output CommonJS
- Externals: `obsidian`, `electron`, and Node built-ins are provided by Obsidian's runtime
- `emitCss: false` on the Svelte plugin inlines component styles (Svelte extracts CSS by default)
- A custom `copy-styles` plugin copies the global `styles.css` to the root for Obsidian to load
- `outDir: "."` with `emptyOutDir: false` outputs `main.js` at the repo root (Obsidian expects it there)
- Source maps only in DEV mode
- Path alias `src` → `src/` directory for clean imports like `src/settings/utils`

---

## 16. Summary of Concerns

### Critical
1. **Uncaught async** (`cache.ts:210`) — template application not awaited, errors silently lost (issue #20)
2. **No tests in CI** — `bun test` not run in GitHub Actions workflow (issue #21)

### High
3. **~5% test coverage** — cache, template transforms, validation all untested (issue #22)
4. **Private API usage** without fallbacks — `vault.getConfig`, `moment._week`, `this.chooser` (issues #14-16, #23)
5. **Unsafe TFile cast** (`cache.ts:252`) — no null/type guard (issue #24)

### Medium
6. **Duplicated template pattern** — 70 lines of near-identical code across month/quarter/year (issue #13)
7. **Misleading `monthStart` name** — used for quarter and year start values (issue #12)

### Community Standards
- **Good:** Proper use of Obsidian's `Plugin`, `Component`, `PluginSettingTab`, `SuggestModal`, and event APIs
- **Good:** Svelte 5 runes (`$state`, `$derived`, `$effect`, `$props`) used correctly
- **Good:** Settings stored via `loadData`/`saveData` with proper defaults merging
- **Good:** Custom events namespaced as `periodic-notes:*`
- **Good:** Proper cleanup via `this.register()` and `this.registerEvent()`
- **Good:** `checkCallback` pattern for conditionally available commands
- **Improvement needed:** Should use `instanceof TFile` guards consistently (done in `commands.ts` but not in `cache.ts`)
- **Improvement needed:** Lodash used for only 3 functions (`memoize`, `sortBy`, `capitalize`) — could reduce bundle size with native alternatives (issue #26)

