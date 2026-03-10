# obsidian-periodic-notes Code Walkthrough

*2026-03-10T17:01:58Z by Showboat 0.6.1*
<!-- showboat-id: 8aae5267-99ae-4b03-b76b-f625220577f0 -->

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

**Private API surface.** This file types several undocumented APIs:
- `Vault.getConfig()` / `Vault.setConfig()` — used for locale and week-start settings
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
sed -n "151,221p" src/main.ts
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
sed -n "20,80p" src/cache.ts
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
sed -n "82,126p" src/cache.ts
```

```output
  public reset(): void {
    console.info("[Periodic Notes] resetting cache");
    this.cachedFiles.clear();
    this.initialize();
  }

  public initialize(): void {
    const settings = get(this.plugin.settings);
    const visited = new Set<TFolder>();
    const recurseChildren = (
      folder: TFolder,
      cb: (file: TAbstractFile) => void,
    ) => {
      if (visited.has(folder)) return;
      visited.add(folder);
      for (const c of folder.children) {
        if (c instanceof TFile) {
          cb(c);
        } else if (c instanceof TFolder) {
          recurseChildren(c, cb);
        }
      }
    };

    const activeGranularities = granularities.filter(
      (g) => settings[g]?.enabled,
    );
    for (const granularity of activeGranularities) {
      const config = settings[granularity] as PeriodicConfig;
      const rootFolder = this.app.vault.getAbstractFileByPath(
        config.folder || "/",
      );
      if (!(rootFolder instanceof TFolder)) continue;

      recurseChildren(rootFolder, (file: TAbstractFile) => {
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

The `visited` Set prevents re-traversing the same folder if multiple granularities share a root. The `instanceof TFolder` guard on the root folder safely skips misconfigured paths (null or non-folder results from `getAbstractFileByPath`).

### File resolution — the heart of the cache

```bash
sed -n "173,242p" src/cache.ts
```

```output
  }

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

**Concern (issue #20):** On line 213, when a newly created file is empty, `applyPeriodicTemplateToFile()` is called **without `await`**. This async function reads the template and writes to the file, but if it fails (template not found, vault error), the error is silently lost.

**Note:** The first granularity that matches wins (due to `return`). If a filename like `2025-01` could match both monthly (`YYYY-MM`) and be part of a daily format, the iteration order (`day → week → month → quarter → year`) determines the match. This is generally correct since finer granularities are more specific.

### Cache queries and navigation

```bash
sed -n "244,316p" src/cache.ts
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
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (file instanceof TFile) return file;
        this.cachedFiles.delete(filePath);
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
    const sortedCache = Array.from(this.cachedFiles.values())
      .filter((m) => m.granularity === granularity)
      .sort((a, b) => a.canonicalDateStr.localeCompare(b.canonicalDateStr));
    const activeNoteIndex = sortedCache.findIndex(
      (m) => m.filePath === filePath,
    );

    const offset = direction === "forwards" ? 1 : -1;
    return sortedCache[activeNoteIndex + offset] ?? null;
  }
}
```

- `getPeriodicNote()` finds a single exact-match note for a date and granularity. Uses `date.isSame(targetDate, granularity)` — Moment's unit-aware comparison (e.g., two dates in the same week are "same" at `week` granularity). If the cached path no longer resolves to a TFile (file was deleted), the stale entry is evicted and the loop continues looking for other matches.

- `getPeriodicNotes()` returns all cached notes within a period, optionally including finer granularities (e.g., all daily notes within a given month). The `compareGranularity` function uses the `granularities` array index order.

- `findAdjacent()` enables forward/backward navigation. It sorts all notes of the same granularity by `canonicalDateStr` (ISO 8601), finds the current note's index, then returns the next or previous entry. The sort runs on every call — not cached, but the cache is typically small enough that this doesn't matter.

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

**Concern (issue #13): Duplicated pattern.** The month, quarter, and year handlers are structurally identical — same regex shape, same callback body, differing only in the `startOf()` argument and the regex keyword. This is ~70 lines of duplication that could be a parameterized helper.

**Concern (issue #12): Misleading variable name.** The local variable `monthStart` is used in the quarter and year handlers, even though it represents the start of a quarter or year.

### File creation helpers

```bash
sed -n "222,319p" src/utils.ts
```

```output
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

export function getRelativeDate(granularity: Granularity, date: Moment) {
  if (granularity === "week") {
    const thisWeek = window.moment().startOf(granularity);
```

- `applyPeriodicTemplateToFile()` — the function called (without await) from the cache on file creation. Reads template, transforms it, writes to file.
- `getTemplateContents()` — resolves the template path via Obsidian's link resolution, reads it with `cachedRead`. Returns empty string if no template is configured.
- `getNoteCreationPath()` — combines folder + filename + `.md` extension, creates intermediate folders if needed.
- `join()` — a custom path joiner (credited to `@creationix/path.js`). Handles slash normalization without Node's `path` module (which is external in the Obsidian environment).
- `ensureFolderExists()` — extracts the directory portion from a path and creates it if missing. Only handles a single level of nesting.
- `capitalize()` — simple string capitalization helper used by the settings UI.

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

### Settings Validation

`validation.ts` provides three focused validators:

- **`getDateInput`** — Extracts the date string from a file. For daily notes it uses the full basename; for coarser granularities it strips a leading date prefix (everything before `_`). This means weekly/monthly/quarterly/yearly notes can be named like `2024-W01_Sprint Planning` and the parser will still extract `2024-W01`.
- **`validateFormat`** — Checks whether a moment.js format string produces a parseable date when round-tripped through `moment().format(fmt) → moment(result, fmt, true)`. Strict parsing (`true` third arg) ensures the format is unambiguous.
- **`validateTemplate`** / **`validateFolder`** — Simple existence checks against the vault's metadata cache and file tree respectively. Both return empty string on success and an error message on failure — the standard Obsidian settings validation pattern.

**Concern:** `getDateInput` uses `split("_")[1]` for non-daily granularities, which silently drops everything after a _second_ underscore in the filename. A basename like `2024-W01_Sprint_Planning` would yield `Sprint` instead of `Sprint_Planning`. This is unlikely to cause issues in practice (the extracted string is a date, not a title) but the split semantics are fragile.

## 8. Localization

The plugin configures moment.js locale settings globally, affecting date rendering across the entire vault.

```bash
cat src/settings/localization.ts
```

```output
import type { WeekSpec } from "moment";
import type { App } from "obsidian";

declare global {
  interface Window {
    _bundledLocaleWeekSpec: WeekSpec;
    _hasConfiguredLocale: boolean;
  }
}

type LocaleOverride = "system-default" | string;

export type WeekStartOption =
  | "sunday"
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "locale";

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

const weekdays = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

export interface LocalizationSettings {
  localeOverride: LocaleOverride;
  weekStart: WeekStartOption;
}

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

### How Localization Works

The locale system has three layers:

1. **Language mapping** (`langToMomentLocale`) — Translates Obsidian's `language` localStorage key to a moment.js locale string. This handles cases where Obsidian's locale codes don't match moment's (e.g., `cz` → `cs`, `no` → `nn`).

2. **Locale resolution** (`configureGlobalMomentLocale`) — Determines the effective locale using a priority cascade: explicit user override > system locale (if more specific than Obsidian's) > mapped Obsidian language. This is called once during plugin init via `initializeLocaleConfigOnce`, guarded by `window._hasConfiguredLocale`.

3. **Week start override** (`overrideGlobalMomentWeekStart`) — Mutates moment's global locale to change the first day of the week. Saves the original `_week` spec to `window._bundledLocaleWeekSpec` so it can be restored when toggling back to "locale" in settings.

**Concerns:**
- **Private API (Issue #16):** `getLocalizationSettings` uses `app.vault.getConfig()`, which is undocumented. This is the only way to read Obsidian's locale/week-start preferences, so there's no public alternative. The code acknowledges this with a comment.
- **Global mutation:** `moment.updateLocale` mutates the global moment instance, which can affect other plugins. The code documents this trade-off in the settings UI.
- **`_week` access:** Reading `moment.localeData()._week` accesses a private moment.js internal. It's stable across moment versions but technically undocumented.

## 9. Settings UI Layer

The settings UI is a Svelte 5 component tree mounted into Obsidian's `PluginSettingTab`.

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

### Settings Tab Architecture

`PeriodicNotesSettingsTab` extends Obsidian's `PluginSettingTab` and bridges Obsidian's imperative UI model with Svelte's reactive rendering:

- **`display()`** — Called when the user opens settings. Clears the container and mounts the Svelte `SettingsPage` component, passing the app instance and the reactive settings store.
- **`hide()`** — Called when settings close. Unmounts the Svelte component tree to prevent memory leaks.

The `Settings` interface uses optional `PeriodicConfig` properties keyed by granularity (`day?`, `week?`, etc.). This means a fresh install has no granularity configs until the user enables one — the `DEFAULT_PERIODIC_CONFIG` from constants fills in defaults at the component level.

**Note:** `installedVersion` is hardcoded to `"1.0.0-beta3"` in `DEFAULT_SETTINGS`. This string appears to be a leftover from development and isn't updated during the build or release process.

```bash
cat src/settings/pages/SettingsPage.svelte
```

```output
<script lang="ts">
  import type { App } from "obsidian";
  import type { Writable } from "svelte/store";

  import type { Settings } from "src/settings";
  import SettingItem from "src/settings/components/SettingItem.svelte";
  import Dropdown from "src/settings/components/Dropdown.svelte";
  import Footer from "src/settings/components/Footer.svelte";
  import {
    getLocaleOptions,
    getWeekStartOptions,
  } from "src/settings/utils";
  import {
    getLocalizationSettings,
    type WeekStartOption,
  } from "src/settings/localization";
  import { granularities } from "src/types";

  import GettingStartedBanner from "./dashboard/GettingStartedBanner.svelte";
  import PeriodicGroup from "./details/PeriodicGroup.svelte";

  let { app, settings }: {
    app: App;
    settings: Writable<Settings>;
  } = $props();

  // svelte-ignore state_referenced_locally
  let localization = $state(getLocalizationSettings(app));
</script>

{#if $settings.showGettingStartedBanner}
  <GettingStartedBanner
    {app}
    handleTeardown={() => {
      $settings.showGettingStartedBanner = false;
    }}
  />
{/if}

<h3>Periodic Notes</h3>
<div class="periodic-groups">
  {#each granularities as granularity}
    <PeriodicGroup {app} {granularity} {settings} />
  {/each}
</div>

<h3>Localization</h3>
<div class="setting-item-description">
  These settings are applied to your entire vault, meaning the values you
  specify here may impact other plugins as well.
</div>
<SettingItem
  name="Start week on"
  description="Choose what day of the week to start. Select 'locale default' to use the default specified by moment.js"
  type="dropdown"
  isHeading={false}
>
  {#snippet control()}
    <Dropdown
      options={getWeekStartOptions()}
      value={localization.weekStart}
      onChange={(e) => {
        const val = (e.target as HTMLSelectElement).value as WeekStartOption;
        localization.weekStart = val;
        app.vault.setConfig("weekStart", val);
      }}
    />
  {/snippet}
</SettingItem>

<SettingItem
  name="Locale"
  description="Override the locale used by the calendar and other plugins"
  type="dropdown"
  isHeading={false}
>
  {#snippet control()}
    <Dropdown
      options={getLocaleOptions()}
      value={localization.localeOverride}
      onChange={(e) => {
        const val = (e.target as HTMLSelectElement).value;
        localization.localeOverride = val;
        app.vault.setConfig("localeOverride", val);
      }}
    />
  {/snippet}
</SettingItem>

<Footer />

<style>
  .periodic-groups {
    margin-top: 1em;
  }
</style>
```

### SettingsPage Component

The root settings component has two major sections:

1. **Periodic Notes groups** — Iterates `granularities` (day, week, month, quarter, year) and renders a `PeriodicGroup` for each. Each group is an expandable accordion with format, folder, template, and startup settings.

2. **Localization** — Week-start and locale dropdowns that write directly to Obsidian's vault config via `app.vault.setConfig()` — another private API usage (Issue #16). Changes here affect all plugins that use moment.js.

The component uses Svelte 5's `$props()` rune for typed prop destructuring and `$state()` for local localization settings. The `{#snippet control()}` blocks are Svelte 5's replacement for named slots, used here with generic `SettingItem` and `Dropdown` components.

```bash
cat src/settings/pages/details/PeriodicGroup.svelte
```

```output
<script lang="ts">
  import type { App } from "obsidian";
  import { slide } from "svelte/transition";
  import { displayConfigs } from "src/commands";
  import { capitalize } from "src/utils";
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

<div class="periodic-group">
  <div
    class="setting-item setting-item-heading periodic-group-heading"
    role="button"
    tabindex="0"
    onclick={toggleExpand}
    onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') toggleExpand(); }}
  >
    <div class="setting-item-info">
      <h3 class="setting-item-name periodic-group-title">
        <Arrow {isExpanded} />
        {capitalize(displayConfig.periodicity)} Notes
        {#if $config.openAtStartup}
          <span class="badge">Opens at startup</span>
        {/if}
      </h3>
    </div>
    <div class="setting-item-control">
      <label
        class="checkbox-container"
        class:is-enabled={$config.enabled}
      >
        <input
          type="checkbox"
          bind:checked={$config.enabled}
          style="display: none;"
        />
      </label>
    </div>
  </div>
  {#if isExpanded}
    <div
      class="periodic-group-content"
      in:slide={{ duration: 300 }}
      out:slide={{ duration: 300 }}
    >
      <NoteFormatSetting {config} {granularity} />
      <NoteFolderSetting {app} {config} {granularity} />
      <NoteTemplateSetting {app} {config} {granularity} />
      <OpenAtStartupSetting {config} {settings} {granularity} />
    </div>
  {/if}
</div>

<style lang="scss">
  .periodic-group-title {
    display: flex;
  }

  .badge {
    font-style: italic;
    margin-left: 1em;
    color: var(--text-muted);
    font-weight: 500;
    font-size: 70%;
  }

  .periodic-group {
    background: var(--background-primary-alt);
    border: 1px solid var(--background-modifier-border);
    border-radius: 16px;

    &:not(:last-of-type) {
      margin-bottom: 24px;
    }
  }

  .periodic-group-heading {
    cursor: pointer;
    padding: 24px;

    h3 {
      font-size: 1.1em;
      margin: 0;
    }
  }

  .periodic-group-content {
    padding: 24px;
  }
</style>
```

### PeriodicGroup — The Accordion Widget

Each granularity gets its own expandable group. Key patterns:

- **`writableDerived`** — A third-party store adapter that creates a two-way derived store. It reads `$settings[granularity]` (falling back to `DEFAULT_PERIODIC_CONFIG`) and writes changes back into the parent settings store. This avoids prop-drilling individual config fields through four child components.

- **Expand/collapse** — Uses `$state(false)` for `isExpanded` and Svelte's `slide` transition for animation. The heading div has proper ARIA attributes (`role="button"`, `tabindex="0"`, keyboard handlers).

- **Enable toggle** — The checkbox in the heading controls `$config.enabled`. The hidden `<input>` with `bind:checked` drives the visual `.checkbox-container` styling via Obsidian's CSS classes.

The four child settings components (`NoteFormatSetting`, `NoteFolderSetting`, `NoteTemplateSetting`, `OpenAtStartupSetting`) each receive the derived `config` store and validate their input against the vault.

Each settings component that uses `bind:this={inputEl}` includes a null guard (`if (!inputEl) return`) in its `$effect` block. This is necessary because Svelte 5 effects run before the DOM is mounted — `bind:this` assigns the element reference during rendering, but the effect may fire in the same microtask before that assignment completes.

## 10. Commands

The command palette integration registers five commands per enabled granularity.

```bash
cat src/commands.ts
```

```output
import { type App, type Command, Notice, TFile } from "obsidian";
import { get } from "svelte/store";
import type PeriodicNotesPlugin from "./main";

import type { Granularity } from "./types";

interface DisplayConfig {
  periodicity: string;
  relativeUnit: string;
  labelOpenPresent: string;
}

export const displayConfigs: Record<Granularity, DisplayConfig> = {
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
  quarter: {
    periodicity: "quarterly",
    relativeUnit: "this quarter",
    labelOpenPresent: "Open this quarter's note",
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
}

function isGranularityActive(
  plugin: PeriodicNotesPlugin,
  granularity: Granularity,
): boolean {
  const settings = get(plugin.settings);
  return settings[granularity]?.enabled === true;
}

export function getCommands(
  app: App,
  plugin: PeriodicNotesPlugin,
  granularity: Granularity,
): Command[] {
  const config = displayConfigs[granularity];

  return [
    {
      id: `open-${config.periodicity}-note`,
      name: config.labelOpenPresent,
      checkCallback: (checking: boolean) => {
        if (!isGranularityActive(plugin, granularity)) return false;
        if (checking) {
          return true;
        }
        plugin.openPeriodicNote(granularity, window.moment());
      },
    },

    {
      id: `next-${config.periodicity}-note`,
      name: `Jump forwards to closest ${config.periodicity} note`,
      checkCallback: (checking: boolean) => {
        if (!isGranularityActive(plugin, granularity)) return false;
        const activeFile = app.workspace.getActiveFile();
        if (checking) {
          if (!activeFile) return false;
          return plugin.isPeriodic(activeFile.path, granularity);
        }
        jumpToAdjacentNote(app, plugin, "forwards");
      },
    },
    {
      id: `prev-${config.periodicity}-note`,
      name: `Jump backwards to closest ${config.periodicity} note`,
      checkCallback: (checking: boolean) => {
        if (!isGranularityActive(plugin, granularity)) return false;
        const activeFile = app.workspace.getActiveFile();
        if (checking) {
          if (!activeFile) return false;
          return plugin.isPeriodic(activeFile.path, granularity);
        }
        jumpToAdjacentNote(app, plugin, "backwards");
      },
    },
    {
      id: `open-next-${config.periodicity}-note`,
      name: `Open next ${config.periodicity} note`,
      checkCallback: (checking: boolean) => {
        if (!isGranularityActive(plugin, granularity)) return false;
        const activeFile = app.workspace.getActiveFile();
        if (checking) {
          if (!activeFile) return false;
          return plugin.isPeriodic(activeFile.path, granularity);
        }
        openAdjacentNote(app, plugin, "forwards");
      },
    },
    {
      id: `open-prev-${config.periodicity}-note`,
      name: `Open previous ${config.periodicity} note`,
      checkCallback: (checking: boolean) => {
        if (!isGranularityActive(plugin, granularity)) return false;
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
```

### Command Architecture

Each granularity gets five commands registered via `getCommands()`:

| Command | Behavior |
|---------|----------|
| **Open [period]'s note** | Opens or creates the note for the current period (today, this week, etc.) |
| **Jump forwards/backwards** | Navigates to the _nearest existing_ note in that direction using `findAdjacent` from the cache |
| **Open next/previous** | Creates or opens the note for the _next/previous calendar period_ (tomorrow, next week, etc.) |

The distinction between "jump" and "open" is important: jumping finds an existing note with `findAdjacent` (cache-based sorted lookup), while opening calculates the adjacent date arithmetically with `moment.add()` and calls `openPeriodicNote` (which creates the note if it doesn't exist).

All commands use Obsidian's `checkCallback` pattern: when `checking` is `true`, the command returns whether it should appear in the palette. When `false`, it executes. Commands for jump/open-adjacent additionally check that the active file is a periodic note of the matching granularity.

The `displayConfigs` record is also exported and reused by the context menu, settings UI, and switcher components for consistent labeling.

## 11. Context Menu

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

### Context Menu

`showFileMenu` creates a simple Obsidian `Menu` at the ribbon icon's click position. It adds one item per enabled granularity, each opening/creating the current period's note. This reuses `displayConfigs` for labels and `getEnabledGranularities` to filter to only active granularities. The ribbon click handler in `main.ts` calls this function.

## 12. Date Switcher

```bash
cat src/switcher/switcher.ts
```

```output
import type { Moment } from "moment";
import { type App, type NLDatesPlugin, SuggestModal, setIcon } from "obsidian";
import type PeriodicNotesPlugin from "src/main";
import { getEnabledGranularities } from "src/settings/utils";
import {
  getFolder,
  getFormat,
  getRelativeDate,
  isIsoFormat,
  isMetaPressed,
  join,
} from "src/utils";
import { get } from "svelte/store";

import type { DateNavigationItem, Granularity } from "../types";
import { RelatedFilesSwitcher } from "./relatedFilesSwitcher";

const DEFAULT_INSTRUCTIONS = [
  { command: "⇥", purpose: "show related files" },
  { command: "↵", purpose: "to open" },
  { command: "ctrl ↵", purpose: "to open in a new pane" },
  { command: "esc", purpose: "to dismiss" },
];

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

  /** XXX: this is pretty messy currently. Not sure if I like the format yet */
  private getPeriodicNotesFromQuery(query: string, date: Moment) {
    let granularity: Granularity = "day";

    const granularityExp = /\b(week|month|quarter|year)s?\b/.exec(query);
    if (granularityExp) {
      granularity = granularityExp[1] as Granularity;
    }

    let label = "";
    if (granularity === "week") {
      const format = getFormat(get(this.plugin.settings), "week");
      const weekNumber = isIsoFormat(format) ? "WW" : "ww";
      label = date.format(`GGGG [Week] ${weekNumber}`);
    } else if (granularity === "day") {
      label = `${getRelativeDate(granularity, date)}, ${date.format("MMMM DD")}`;
    } else {
      label = query;
    }

    const suggestions = [
      {
        label,
        date,
        granularity,
      },
    ];

    if (granularity !== "day") {
      suggestions.push({
        label: `${getRelativeDate(granularity, date)}, ${date.format("MMMM DD")}`,
        date,
        granularity: "day",
      });
    }

    return suggestions;
  }

  getSuggestions(query: string): DateNavigationItem[] {
    const dateInQuery = this.nlDatesPlugin.parseDate(query);
    const quickSuggestions = this.getDateSuggestions(query);

    if (quickSuggestions.length) {
      return quickSuggestions;
    }

    if (dateInQuery.moment.isValid()) {
      return this.getPeriodicNotesFromQuery(query, dateInQuery.moment);
    }
    return [];
  }

  getDateSuggestions(query: string): DateNavigationItem[] {
    const activeGranularities = getEnabledGranularities(
      get(this.plugin.settings),
    );
    const getSuggestion = (dateStr: string, granularity: Granularity) => {
      const date = this.nlDatesPlugin.parseDate(dateStr);
      return {
        granularity,
        date: date.moment,
        label: dateStr,
      };
    };

    const relativeExpr = query.match(/(next|last|this)/i);
    if (relativeExpr) {
      const reference = relativeExpr[1];
      return [
        getSuggestion(`${reference} Sunday`, "day"),
        getSuggestion(`${reference} Monday`, "day"),
        getSuggestion(`${reference} Tuesday`, "day"),
        getSuggestion(`${reference} Wednesday`, "day"),
        getSuggestion(`${reference} Thursday`, "day"),
        getSuggestion(`${reference} Friday`, "day"),
        getSuggestion(`${reference} Saturday`, "day"),
        getSuggestion(`${reference} week`, "week"),
        getSuggestion(`${reference} month`, "month"),
        // getSuggestion(`${reference} quarter`, "quarter"), TODO include once nldates supports quarters
        getSuggestion(`${reference} year`, "year"),
      ]
        .filter((items) => activeGranularities.includes(items.granularity))
        .filter((items) => items.label.toLowerCase().startsWith(query));
    }

    const relativeDate =
      query.match(/^in ([+-]?\d+)/i) || query.match(/^([+-]?\d+)/i);
    if (relativeDate) {
      const timeDelta = relativeDate[1];
      return [
        getSuggestion(`in ${timeDelta} days`, "day"),
        getSuggestion(`in ${timeDelta} weeks`, "day"),
        getSuggestion(`in ${timeDelta} weeks`, "week"),
        getSuggestion(`in ${timeDelta} months`, "month"),
        getSuggestion(`in ${timeDelta} years`, "day"),
        getSuggestion(`in ${timeDelta} years`, "year"),
        getSuggestion(`${timeDelta} days ago`, "day"),
        getSuggestion(`${timeDelta} weeks ago`, "day"),
        getSuggestion(`${timeDelta} weeks ago`, "week"),
        getSuggestion(`${timeDelta} months ago`, "month"),
        getSuggestion(`${timeDelta} years ago`, "day"),
        getSuggestion(`${timeDelta} years ago`, "year"),
      ]
        .filter((items) => activeGranularities.includes(items.granularity))
        .filter((item) => item.label.toLowerCase().startsWith(query));
    }

    return [
      getSuggestion("today", "day"),
      getSuggestion("yesterday", "day"),
      getSuggestion("tomorrow", "day"),
      getSuggestion("this week", "week"),
      getSuggestion("last week", "week"),
      getSuggestion("next week", "week"),
      getSuggestion("this month", "month"),
      getSuggestion("last month", "month"),
      getSuggestion("next month", "month"),
      // TODO - requires adding new parser to NLDates
      // getSuggestion("this quarter", "quarter"),
      // getSuggestion("last quarter", "quarter"),
      // getSuggestion("next quarter", "quarter"),
      getSuggestion("this year", "year"),
      getSuggestion("last year", "year"),
      getSuggestion("next year", "year"),
    ]
      .filter((items) => activeGranularities.includes(items.granularity))
      .filter((items) => items.label.toLowerCase().startsWith(query));
  }

  renderSuggestion(value: DateNavigationItem, el: HTMLElement) {
    const numRelatedNotes = this.plugin
      .getPeriodicNotes(value.granularity, value.date)
      .filter((e) => e.matchData.exact === false).length;

    const periodicNote = this.plugin.getPeriodicNote(
      value.granularity,
      value.date,
    );

    if (!periodicNote) {
      const settings = get(this.plugin.settings);
      const format = getFormat(settings, value.granularity);
      const folder = getFolder(settings, value.granularity);
      el.setText(value.label);
      el.createEl("span", { cls: "suggestion-flair", prepend: true }, (el) => {
        setIcon(el, "file-plus");
      });
      if (numRelatedNotes > 0) {
        el.createEl("span", {
          cls: "suggestion-badge",
          text: `+${numRelatedNotes}`,
        });
      }
      el.createEl("div", {
        cls: "suggestion-note",
        text: join(folder, value.date.format(format)),
      });
      return;
    }

    const curPath = this.app.workspace.getActiveFile()?.path ?? "";
    const filePath = this.app.metadataCache.fileToLinktext(
      periodicNote,
      curPath,
      true,
    );

    el.setText(value.label);
    el.createEl("div", { cls: "suggestion-note", text: filePath });
    el.createEl("span", { cls: "suggestion-flair", prepend: true }, (el) => {
      setIcon(el, `calendar-${value.granularity}`);
    });
    if (numRelatedNotes > 0) {
      el.createEl("span", {
        cls: "suggestion-badge",
        text: `+${numRelatedNotes}`,
      });
    }
  }

  async onChooseSuggestion(
    item: DateNavigationItem,
    evt: MouseEvent | KeyboardEvent,
  ) {
    this.plugin.openPeriodicNote(item.granularity, item.date, {
      inNewSplit: isMetaPressed(evt),
    });
  }
}
```

### NLDNavigator — Natural Language Date Switcher

This is the most complex UI component in the plugin. It extends Obsidian's `SuggestModal` to provide a fuzzy-finder that understands natural language dates via the `nldates-obsidian` plugin dependency.

**Suggestion pipeline:**

1. `getSuggestions(query)` first tries `getDateSuggestions` for common patterns (relative dates, named periods). If no quick suggestions match, it falls back to the NLDates plugin's `parseDate` for freeform natural language.

2. `getDateSuggestions` handles three input shapes:
   - **Relative keywords** (`next/last/this` + day/week/month/year) — generates all combinations and filters by enabled granularities and query prefix
   - **Numeric offsets** (`in 3 days`, `+2 weeks`, `5 months ago`) — generates forward and backward suggestions for each unit
   - **Default** (empty/partial query) — shows today/yesterday/tomorrow plus this/last/next for each enabled period

3. `renderSuggestion` differentiates between existing and new notes. Existing notes show a calendar icon and the vault-relative link path. New notes show a `file-plus` icon and the projected file path. Both show a `+N` badge counting related (non-exact-match) notes in that period.

**Keyboard navigation:**
- **Tab** — Switches to the `RelatedFilesSwitcher` for the selected item
- **Cmd/Ctrl+Enter** — Opens the note in a new pane (accesses the private `this.chooser` API)
- **Enter** — Opens/creates the note in the current pane

**Concerns:**
- **Hard dependency on nldates plugin** — `this.nlDatesPlugin` is cast from `getPlugin()` without a null check. If nldates isn't installed, the switcher will throw on first use (Issue #23 — private API usage).
- **`this.chooser` access** — Used twice with `@ts-expect-error` and `any` casts. This is Obsidian's internal `SuggestModal` implementation detail.
- **Quarter support** — Commented out (`TODO`) because NLDates doesn't support quarter parsing. This means the quarterly granularity has no switcher support.

## 13. Related Files Switcher

```bash
cat src/switcher/relatedFilesSwitcher.ts
```

```output
import { type App, SuggestModal, setIcon, TFile } from "obsidian";
import { DEFAULT_FORMAT } from "src/constants";
import type PeriodicNotesPlugin from "src/main";

import type { DateNavigationItem } from "../types";
import { NLDNavigator } from "./switcher";

const DEFAULT_INSTRUCTIONS = [
  { command: "*", purpose: "show all notes within this period" },
  { command: "↵", purpose: "to open" },
  { command: "ctrl ↵", purpose: "to open in a new pane" },
  { command: "esc", purpose: "to dismiss" },
];

export class RelatedFilesSwitcher extends SuggestModal<DateNavigationItem> {
  private inputLabel!: HTMLElement;
  private includeFinerGranularities: boolean;

  constructor(
    readonly app: App,
    readonly plugin: PeriodicNotesPlugin,
    readonly selectedItem: DateNavigationItem,
    readonly oldQuery: string,
  ) {
    super(app);

    this.includeFinerGranularities = false;
    this.setInstructions(DEFAULT_INSTRUCTIONS);
    this.setPlaceholder(`Search notes related to ${selectedItem.label}...`);

    this.inputEl.parentElement?.prepend(
      createDiv("periodic-notes-switcher-input-container", (inputContainer) => {
        inputContainer.appendChild(this.inputEl);
        this.inputLabel = inputContainer.createDiv({
          cls: "related-notes-mode-indicator",
          text: "Expanded",
        });
        this.inputLabel.toggleVisibility(false);
      }),
    );

    this.scope.register([], "Tab", (evt: KeyboardEvent) => {
      evt.preventDefault();
      this.close();
      const nav = new NLDNavigator(this.app, this.plugin);
      nav.open();

      nav.inputEl.value = oldQuery;
      nav.inputEl.dispatchEvent(new Event("input"));
    });

    this.scope.register(["Shift"], "8", (evt: KeyboardEvent) => {
      evt.preventDefault();
      this.includeFinerGranularities = !this.includeFinerGranularities;
      this.inputLabel.style.visibility = this.includeFinerGranularities
        ? "visible"
        : "hidden";
      this.inputEl.dispatchEvent(new Event("input"));
    });
  }

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

### RelatedFilesSwitcher

This secondary modal shows files that are _date-prefixed_ but not exact matches for a periodic note. For example, if you have a weekly note `2024-W01` and files like `2024-W01_Meeting Notes` and `2024-W01_Sprint Retro`, this switcher lists those related files.

**Key behaviors:**

- **Tab** — Switches back to the `NLDNavigator`, restoring the original query text. The two switchers form a bidirectional navigation pair.
- **Shift+8 (asterisk)** — Toggles `includeFinerGranularities`. When viewing a monthly note's related files, this expands to include daily and weekly notes within that month. An "Expanded" label appears in the input container.
- **`instanceof TFile` guard** — `onChooseSuggestion` properly checks the result of `getAbstractFileByPath` before opening.
- **Filtering** — Only non-exact matches are shown (`matchData.exact === false`), filtered by case-insensitive substring search on the file path.

## 14. File Suggest UI

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

### File and Folder Suggest

Two small classes extending Obsidian's `AbstractInputSuggest` to provide autocomplete dropdowns for input fields in the settings UI:

- **`FileSuggest`** — Used by `NoteTemplateSetting` to suggest template file paths. Searches all markdown files by substring match.
- **`FolderSuggest`** — Used by `NoteFolderSetting` to suggest folder paths. Searches all folders by substring match.

Both are instantiated inside `$effect` blocks in their respective Svelte components and cleaned up via the effect's return destructor (`() => suggest.close()`).

## 15. Build System

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

### Vite Configuration

The build is configured for Obsidian's plugin format:

- **Output** — CommonJS (`cjs`) with `default` export, written as `main.js` in the project root (`outDir: "."`). Obsidian expects a single `main.js` file.
- **`emptyOutDir: false`** — Critical because the output directory is the project root. Without this, Vite would delete all project files during build.
- **Externals** — `obsidian`, `electron`, `fs`, `os`, `path` are provided by Obsidian's runtime and must not be bundled.
- **Svelte** — `emitCss: false` injects component styles via JavaScript rather than generating separate CSS files. This keeps the plugin as a single JS file.
- **`copy-styles` plugin** — A custom Vite plugin that copies `src/styles.css` to the project root after each build. Obsidian loads `styles.css` from the plugin directory automatically.
- **Source maps** — Only generated in dev mode (`NODE_ENV === "DEV"`), as inline maps to avoid extra files.
- **Path alias** — `src` resolves to the `src/` directory, enabling clean imports like `import { capitalize } from "src/utils"` throughout the codebase.

## 16. Summary of Concerns

### Private API Usage (Issues #16, #23)

The plugin relies on several undocumented Obsidian APIs:

| API | Location | Purpose | Risk |
|-----|----------|---------|------|
| `vault.getConfig()` / `vault.setConfig()` | `localization.ts`, `SettingsPage.svelte` | Read/write locale and week-start preferences | Could break on Obsidian update |
| `moment.localeData()._week` | `localization.ts` | Save/restore original week spec | Stable but undocumented moment.js internal |
| `this.chooser` on `SuggestModal` | `switcher.ts` | Access selected item and trigger selection | Private Obsidian internal |
| `app.internalPlugins.getPluginById()` | `settings/utils.ts` | Check and disable built-in Daily Notes plugin | Private Obsidian internal |
| `app.plugins.getPlugin("nldates-obsidian")` | `switcher.ts` | Access NLDates plugin for date parsing | No null check; throws if plugin missing |

None of these have public alternatives. The code documents most of them with comments or `@ts-expect-error` / `biome-ignore` annotations.

### Test Coverage (Issue #22)

Test coverage sits around 5%. The cache, parser, and utilities have some coverage, but the command system, switcher, settings UI, and localization modules are untested. The Svelte components are particularly hard to test without a DOM environment and Obsidian API mocks.

### Uncaught Async (Issue #20)

`applyPeriodicTemplateToFile` in `cache.ts` is called without `await` during the `resolve` method (which is synchronous). If the template application fails, the error is silently swallowed. This should either be awaited (requiring `resolve` to become async) or have an explicit `.catch()` handler.

### Architecture Strengths

- **Clean separation of concerns** — Cache, commands, settings, and UI are well-isolated modules
- **Svelte 5 adoption** — Uses modern runes (`$state`, `$derived`, `$effect`, `$props`) and snippets throughout
- **Type safety** — `instanceof` guards on all `getAbstractFileByPath` calls, typed granularity system, explicit config interfaces
- **Cache design** — Event-driven updates (create, rename, metadata change) with proper stale-entry eviction
- **Accessibility** — Settings accordion has ARIA roles, keyboard handlers, and proper tab ordering

