# Obsidian Periodic Notes Walkthrough

*2026-03-14T02:48:32Z by Showboat 0.6.1*
<!-- showboat-id: 41a56ad8-ed87-419d-97de-cbce684df3b1 -->

## Overview

Obsidian Periodic Notes is a plugin for [Obsidian](https://obsidian.md) that creates and manages periodic notes — daily, weekly, monthly, quarterly, and yearly. It provides:

- **Calendar sidebar** — A Svelte 5 calendar view for navigating and creating periodic notes
- **Configurable formats** — Per-granularity folder, filename format, and template settings
- **Template engine** — Token replacement (`{{date}}`, `{{title}}`, etc.) with delta support (`{{date+1d}}`)
- **Cache** — Efficient lookup of existing periodic notes by granularity and date

Key technologies: TypeScript, Svelte 5, Vite, Obsidian API, Moment.js (via `window.moment`).

## Architecture

### Directory Layout

```bash
find src -type f | sort
```

```output
src/cache.test.ts
src/cache.ts
src/calendar/Arrow.svelte
src/calendar/Calendar.svelte
src/calendar/constants.ts
src/calendar/context.ts
src/calendar/Day.svelte
src/calendar/fileStore.test.ts
src/calendar/fileStore.ts
src/calendar/Month.svelte
src/calendar/Nav.svelte
src/calendar/types.ts
src/calendar/utils.test.ts
src/calendar/utils.ts
src/calendar/view.ts
src/calendar/WeekNum.svelte
src/commands.ts
src/constants.ts
src/icons.ts
src/main.ts
src/modal.ts
src/obsidian.d.ts
src/parser.test.ts
src/parser.ts
src/settings/components/Arrow.svelte
src/settings/components/Dropdown.svelte
src/settings/components/Footer.svelte
src/settings/components/NoteFolderSetting.svelte
src/settings/components/NoteFormatSetting.svelte
src/settings/components/NoteTemplateSetting.svelte
src/settings/components/OpenAtStartupSetting.svelte
src/settings/components/SettingItem.svelte
src/settings/components/Toggle.svelte
src/settings/index.ts
src/settings/localization.test.ts
src/settings/localization.ts
src/settings/pages/dashboard/GettingStartedBanner.svelte
src/settings/pages/details/PeriodicGroup.svelte
src/settings/pages/SettingsPage.svelte
src/settings/utils.test.ts
src/settings/utils.ts
src/settings/validation.test.ts
src/settings/validation.ts
src/styles.css
src/test-preload.ts
src/types.ts
src/ui/fileSuggest.ts
src/utils.test.ts
src/utils.ts
```

### Module Boundaries

- **`src/main.ts`** — Plugin entry point. Registers commands, icons, settings tab, calendar view, and ribbon icons.
- **`src/cache.ts`** — Caches periodic notes by granularity. Maps filenames to dates using configured formats.
- **`src/calendar/`** — Svelte 5 sidebar calendar. `CalendarView` (TypeScript) mounts Svelte components in an Obsidian `ItemView`.
- **`src/settings/`** — Settings UI with validation, localization, and page-based layout.
- **`src/parser.ts`** — Parses filenames into dates using Moment.js format strings.
- **`src/utils.ts`** — Shared utilities for config access, template rendering, and path construction.
- **`src/types.ts`** — Core type definitions (`Granularity`, `PeriodicConfig`).
- **`src/ui/`** — Shared UI components (file suggest input).

### Data Flow

1. User opens or creates a periodic note via command, ribbon icon, or calendar click
2. Plugin looks up the note in the cache by granularity + date
3. If not found, creates the note using the configured template and format
4. Cache watches for file events (create, rename, delete) and rebuilds its index

## Entry Point: `src/main.ts`

The plugin class extends Obsidian's `Plugin`. On load, it registers icons, initializes settings, creates the cache, configures commands, and registers the calendar view.

```bash
sed -n '1,37p' src/main.ts
```

```output
import type { Moment } from "moment";
import { addIcon, Plugin, type TFile } from "obsidian";
import { get, type Writable, writable } from "svelte/store";

import { type PeriodicNoteCachedMetadata, PeriodicNotesCache } from "./cache";
import { VIEW_TYPE_CALENDAR } from "./calendar/constants";
import { CalendarView } from "./calendar/view";
import { displayConfigs, getCommands } from "./commands";
import { DEFAULT_PERIODIC_CONFIG } from "./constants";
import {
  calendarDayIcon,
  calendarMonthIcon,
  calendarQuarterIcon,
  calendarWeekIcon,
  calendarYearIcon,
} from "./icons";
import { showFileMenu } from "./modal";
import {
  DEFAULT_SETTINGS,
  PeriodicNotesSettingsTab,
  type Settings,
} from "./settings";
import { initializeLocaleConfigOnce } from "./settings/localization";
import {
  findStartupNoteConfig,
  getEnabledGranularities,
} from "./settings/utils";
import { type Granularity, granularities } from "./types";
import {
  applyTemplateTransformations,
  getConfig,
  getFormat,
  getNoteCreationPath,
  getTemplateContents,
  isMetaPressed,
} from "./utils";

```

The `onload` method is the plugin lifecycle entry point. It sets up icons, settings, cache, commands, and the calendar view.

```bash
sed -n '43,104p' src/main.ts
```

```output
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

    // Calendar view
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

    this.app.workspace.onLayoutReady(() => {
      const startupGranularity = findStartupNoteConfig(this.settings);
      if (startupGranularity) {
        this.openPeriodicNote(startupGranularity, window.moment());
      }
    });
  }

  private configureRibbonIcons() {
    this.ribbonEl?.detach();

    const configuredGranularities = getEnabledGranularities(get(this.settings));
    if (configuredGranularities.length) {
      const granularity = configuredGranularities[0];
```

Note that settings are stored in a Svelte writable store, enabling reactive updates across the UI. The `configureCommands` method registers open/create commands for each enabled granularity.

### Note Creation

The `openPeriodicNote` and `createPeriodicNote` methods handle the core workflow: look up in cache, create if missing, open in editor.

```bash
sed -n '174,243p' src/main.ts
```

```output
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

## Types: `src/types.ts`

Core type definitions shared across the plugin. `Granularity` is the union of all supported periodic note intervals.

```bash
cat src/types.ts
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
```

## Constants: `src/constants.ts`

Default configuration for each granularity, including Moment.js format strings.

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

Note that weekly format uses locale-aware `gggg-[W]ww` (not ISO `YYYY-[W]WW`), which respects the user's configured week start day.

## Parser: `src/parser.ts`

The parser converts filenames into Moment.js dates. It handles locale-aware week numbering and strict parsing to avoid false positives.

```bash
sed -n '1,50p' src/parser.ts
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
```

```bash
sed -n '51,106p' src/parser.ts
```

```output

  return null;
}
```

The parser uses regex-based loose matching for day, month, and year patterns. Week and quarter parsing happen in the cache via Moment.js strict format parsing.

## Cache: `src/cache.ts`

The cache is the core data structure. It indexes all markdown files, parsing their filenames against configured formats for each granularity. It watches for file events to stay current.

```bash
sed -n '1,30p' src/cache.ts
```

```output
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
import { get } from "svelte/store";

import { DEFAULT_FORMAT } from "./constants";
import type PeriodicNotesPlugin from "./main";
import { getLooselyMatchedDate } from "./parser";
import { getDateInput } from "./settings/validation";
import { type Granularity, granularities, type PeriodicConfig } from "./types";
import { applyPeriodicTemplateToFile, getPossibleFormats } from "./utils";

export type MatchType = "filename" | "frontmatter" | "date-prefixed";

interface PeriodicNoteMatchData {
  matchType: MatchType;
  exact: boolean;
}

function compareGranularity(a: Granularity, b: Granularity) {
  const idxA = granularities.indexOf(a);
  const idxB = granularities.indexOf(b);
```

The cache resolves files in priority order: exact filename match → frontmatter date field → date-prefixed filename. It evicts stale entries on file rename/delete and continues the lookup loop (does not early-return on eviction).

```bash
sed -n '67,110p' src/cache.ts
```

```output
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
```

## Utilities: `src/utils.ts`

Shared functions for config access, format resolution, template rendering, and path construction. The template engine supports token replacement with date deltas.

```bash
sed -n '1,20p' src/utils.ts
```

```output
import type { Moment } from "moment";
import {
  type App,
  Notice,
  normalizePath,
  Platform,
  type TFile,
} from "obsidian";

import type { PeriodicNoteCachedMetadata } from "./cache";
import {
  DEFAULT_FORMAT,
  DEFAULT_PERIODIC_CONFIG,
  HUMANIZE_FORMAT,
} from "./constants";
import type { Settings } from "./settings";
import { removeEscapedCharacters } from "./settings/validation";
import type { Granularity, PeriodicConfig } from "./types";

export function isMetaPressed(e: MouseEvent | KeyboardEvent): boolean {
```

### Template Rendering

The `applyTemplateTransformations` function replaces tokens like `{{date}}`, `{{title}}`, and `{{time}}` in template files. It supports deltas like `{{date+1d}}` or `{{date-1M}}`. The `replaceGranularityTokens` helper consolidates day/month/quarter/year token replacement; the week branch is structurally different due to locale-aware week numbering.

```bash
grep -n 'function applyTemplateTransformations\|function replaceGranularityTokens\|function replaceWeekTokens' src/utils.ts
```

```output
50:function replaceGranularityTokens(
85:export function applyTemplateTransformations(
```

```bash
sed -n '50,115p' src/utils.ts
```

```output
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

export function applyTemplateTransformations(
  filename: string,
  granularity: Granularity,
  date: Moment,
  format: string,
  rawTemplateContents: string,
): string {
  let templateContents = rawTemplateContents
    .replace(/{{\s*date\s*}}/gi, filename)
    .replace(/{{\s*time\s*}}/gi, window.moment().format("HH:mm"))
    .replace(/{{\s*title\s*}}/gi, filename);

  if (granularity === "day") {
    templateContents = templateContents
      .replace(
        /{{\s*yesterday\s*}}/gi,
        date.clone().subtract(1, "day").format(format),
      )
      .replace(/{{\s*tomorrow\s*}}/gi, date.clone().add(1, "d").format(format));
    templateContents = replaceGranularityTokens(
      templateContents,
      date,
      "date|time",
      format,
    );
  }

  if (granularity === "week") {
    templateContents = templateContents.replace(
      /{{\s*(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\s*:(.*?)}}/gi,
      (_, dayOfWeek, momentFormat) => {
```

## Commands: `src/commands.ts`

Per-granularity commands are generated dynamically. Each granularity gets "open" and "open in new pane" commands.

```bash
sed -n '1,40p' src/commands.ts
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

```

## Calendar View: `src/calendar/`

The calendar is a Svelte 5 sidebar panel mounted in an Obsidian `ItemView`. The architecture uses a reactivity bridge pattern: the TypeScript `CalendarView` class communicates to Svelte via exported functions (`tick()`, `setActiveFilePath()`), and Svelte communicates back via callback props (`onHover`, `onClick`, `onContextMenu`).

### View Host

```bash
sed -n '1,35p' src/calendar/view.ts
```

```output
import type { Moment } from "moment";
import { ItemView, Menu, type TFile, type WorkspaceLeaf } from "obsidian";
import type PeriodicNotesPlugin from "src/main";
import type { Granularity } from "src/types";
import { mount, unmount } from "svelte";
import Calendar from "./Calendar.svelte";
import { VIEW_TYPE_CALENDAR } from "./constants";
import CalendarFileStore from "./fileStore";

interface CalendarExports {
  tick: () => void;
  setActiveFilePath: (path: string | null) => void;
}

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

```

### FileStore

The `CalendarFileStore` bridges Obsidian's file events to Svelte reactivity. It uses a subscription model with `bump()` (filters via `isPeriodic()`) and `bumpUnconditionally()` (for settings/resolve events).

```bash
sed -n '1,45p' src/calendar/fileStore.ts
```

```output
import type { Moment } from "moment";
import type { Component, TAbstractFile, TFile } from "obsidian";
import type PeriodicNotesPlugin from "src/main";
import type { Granularity } from "src/types";
import { get, type Writable, writable } from "svelte/store";

import type { FileMap, IMonth } from "./types";

export default class CalendarFileStore {
  public store: Writable<number>;
  private plugin: PeriodicNotesPlugin;

  constructor(component: Component, plugin: PeriodicNotesPlugin) {
    this.plugin = plugin;
    this.store = writable(0);

    plugin.app.workspace.onLayoutReady(() => {
      const { vault, metadataCache, workspace } = plugin.app;
      component.registerEvent(vault.on("create", this.bump, this));
      component.registerEvent(vault.on("delete", this.bump, this));
      component.registerEvent(vault.on("rename", this.onRename, this));
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
      // Re-read cache after layout is ready (cache populates in its own onLayoutReady)
      this.bump();
    });
  }

  private bump(file?: TAbstractFile): void {
    if (file && !this.plugin.isPeriodic(file.path)) return;
    this.store.update((n) => n + 1);
  }

  private bumpUnconditionally(): void {
    this.store.update((n) => n + 1);
  }
```

### FileMap Pattern

The `Calendar.svelte` component uses a single subscription to pre-compute a `Map<string, TFile | null>` via `computeFileMap()`. Child components (`Day.svelte`, `WeekNum.svelte`, `Month.svelte`) do `$derived` lookups via `fileMapKey()` — no per-cell subscriptions. The `fileMapKey()` function centralizes key format strings: week uses locale-aware `gggg-[W]ww`, not ISO `YYYY-[W]WW`.

```bash
grep -rn 'fileMapKey\|computeFileMap' src/calendar/
```

```output
src/calendar/fileStore.ts:78:export function fileMapKey(granularity: Granularity, date: Moment): string {
src/calendar/fileStore.ts:82:export function computeFileMap(
src/calendar/fileStore.ts:92:      map.set(fileMapKey("day", day), getFile(day, "day"));
src/calendar/fileStore.ts:96:      map.set(fileMapKey("week", weekStart), getFile(weekStart, "week"));
src/calendar/fileStore.ts:102:      fileMapKey("month", displayedMonth),
src/calendar/fileStore.ts:108:      fileMapKey("year", displayedMonth),
src/calendar/fileStore.test.ts:4:import { computeFileMap, fileMapKey } from "./fileStore";
src/calendar/fileStore.test.ts:7:describe("fileMapKey", () => {
src/calendar/fileStore.test.ts:9:    expect(fileMapKey("day", moment("2024-03-15"))).toBe("day:2024-03-15");
src/calendar/fileStore.test.ts:13:    expect(fileMapKey("week", moment("2024-03-11"))).toBe("week:2024-W11");
src/calendar/fileStore.test.ts:17:    expect(fileMapKey("month", moment("2024-03-01"))).toBe("month:2024-03");
src/calendar/fileStore.test.ts:21:    expect(fileMapKey("year", moment("2024-03-01"))).toBe("year:2024");
src/calendar/fileStore.test.ts:25:describe("computeFileMap", () => {
src/calendar/fileStore.test.ts:29:    const map = computeFileMap(month, getFile, []);
src/calendar/fileStore.test.ts:37:    const map = computeFileMap(month, getFile, ["week"]);
src/calendar/fileStore.test.ts:45:    const map = computeFileMap(month, getFile, ["month", "year"]);
src/calendar/fileStore.test.ts:46:    expect(map.has(fileMapKey("month", moment("2024-03-01")))).toBe(true);
src/calendar/fileStore.test.ts:47:    expect(map.has(fileMapKey("year", moment("2024-03-01")))).toBe(true);
src/calendar/fileStore.test.ts:53:    const map = computeFileMap(month, getFile, []);
src/calendar/fileStore.test.ts:65:    computeFileMap(month, getFile, ["week", "month", "year"]);
src/calendar/Day.svelte:8:  import { fileMapKey } from "./fileStore";
src/calendar/Day.svelte:31:  let file = $derived(fileMap.get(fileMapKey("day", date)) ?? null);
src/calendar/Month.svelte:10:  import { fileMapKey } from "./fileStore";
src/calendar/Month.svelte:29:  let monthKey = $derived(fileMapKey("month", $displayedMonth));
src/calendar/Month.svelte:30:  let yearKey = $derived(fileMapKey("year", $displayedMonth));
src/calendar/Calendar.svelte:9:  import { computeFileMap, fileMapKey } from "./fileStore";
src/calendar/Calendar.svelte:46:      fileMap = computeFileMap(
src/calendar/Calendar.svelte:96:      {#each month as week (fileMapKey("week", week.days[0]))}
src/calendar/WeekNum.svelte:5:  import { fileMapKey } from "./fileStore";
src/calendar/WeekNum.svelte:28:  let file = $derived(fileMap.get(fileMapKey("week", startOfWeek)) ?? null);
```

```bash
sed -n '78,110p' src/calendar/fileStore.ts
```

```output
export function fileMapKey(granularity: Granularity, date: Moment): string {
  return `${granularity}:${date.format(KEY_FORMATS[granularity])}`;
}

export function computeFileMap(
  month: IMonth,
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
```

## Settings: `src/settings/`

The settings UI uses a page-based layout with Svelte components. The main entry point exports `PeriodicNotesSettingsTab`, `Settings` type, and `DEFAULT_SETTINGS`.

### Localization

Settings respect Obsidian's locale override and week start configuration via private API (`vault.getConfig()`), wrapped in try-catch for resilience.

```bash
sed -n '130,155p' src/settings/localization.ts
```

```output
  configureGlobalMomentLocale(localeOverride, weekStart);

  window._hasConfiguredLocale = true;
}

export function getLocalizationSettings(app: App): LocalizationSettings {
  try {
    // private API: vault.getConfig is undocumented
    const localeOverride =
      app.vault.getConfig("localeOverride") ?? "system-default";
    const weekStart = app.vault.getConfig("weekStart") ?? "locale";
    return { localeOverride, weekStart };
  } catch (e) {
    console.debug(
      "[Periodic Notes] vault.getConfig() unavailable, using defaults",
      e,
    );
    return { localeOverride: "system-default", weekStart: "locale" };
  }
}
```

### Validation

Settings validation normalizes paths, checks format strings, and validates folder existence. The `getDateInput` function handles strict Moment.js parsing for user-entered dates.

```bash
sed -n '1,25p' src/settings/validation.ts
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
```

## Obsidian Type Augmentation: `src/obsidian.d.ts`

Module augmentation extends the Obsidian type definitions with private API types used by the plugin: workspace events, vault config access, internal plugins, and community plugin manager.

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
    setConfig<T extends keyof VaultSettings>(
      setting: T,
      value: VaultSettings[T],
    ): void;
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
}
```

## Build Configuration: `vite.config.ts`

Vite builds to the project root (`outDir: "."`) with `emptyOutDir: false` — this is intentional and must not change. Output is CommonJS format for Obsidian compatibility. The `src` path alias resolves to the `src/` directory.

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

Note the `copy-styles` plugin copies `src/styles.css` to the root as a build artifact. Both `main.js` and `styles.css` are tracked in git.

## Tests

Tests use Bun's built-in test runner. The `bunfig.toml` preload (`src/test-preload.ts`) provides `window.moment` globally. Test files re-implement pure functions to avoid importing modules with `obsidian` dependencies.

```bash
grep -c 'test\|it(' src/*.test.ts src/**/*.test.ts 2>/dev/null | grep -v ':0$'
```

```output
src/cache.test.ts:26
src/parser.test.ts:12
src/utils.test.ts:68
src/calendar/fileStore.test.ts:10
src/calendar/utils.test.ts:11
src/settings/localization.test.ts:16
src/settings/utils.test.ts:12
src/settings/validation.test.ts:34
```

```bash
bun test 2>&1 | grep -E '^\s+[0-9]+ pass'
```

```output
 159 pass
```

Modules that cannot be imported in tests (due to `obsidian` or Svelte runtime dependencies): `cache.ts`, `utils.ts`, `settings/validation.ts`. Tests for these re-implement the pure functions they need.

## Concerns

1. **Pre-existing a11y warnings** — `Month.svelte` has two `a11y_no_noninteractive_tabindex` warnings (interactive spans on non-interactive elements). These are flagged by `svelte-check` but not blocking.
2. **Private API usage** — `vault.getConfig()` is undocumented Obsidian API. Wrapped in try-catch, so the plugin degrades gracefully, but could break if Obsidian changes internals.
3. **No external plugin dependencies** — As of this version, the plugin has no runtime dependencies on other Obsidian community plugins.

