# Periodic Notes Walkthrough

*2026-03-14T03:10:55Z by Showboat 0.6.1*
<!-- showboat-id: 5b11a14f-91b4-4642-94b7-394b789e76da -->

## Overview

Periodic Notes is an Obsidian plugin that creates and manages daily, weekly, monthly, quarterly,
and yearly notes. Users configure a date format, folder, and optional template for each granularity.
The plugin resolves vault files against these patterns, maintains a cache of matches, and provides
commands, a context menu, and a calendar sidebar view for navigation.

**Key technologies:** TypeScript, Svelte 5, Vite, Obsidian Plugin API, Moment.js

**Entry point:** `src/main.ts` — the `PeriodicNotesPlugin` class

## Architecture

The plugin is organized into four subsystems: core (types, cache, parser, utils),
settings (UI, validation, localization), calendar (sidebar view with Svelte components),
and commands (ribbon menu, keyboard shortcuts).

```bash
find src -type f -name '*.ts' -o -name '*.svelte' | sort | head -40
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
```

```bash
find src -type f -name '*.ts' -o -name '*.svelte' | sort | tail -10
```

```output
src/settings/pages/SettingsPage.svelte
src/settings/utils.test.ts
src/settings/utils.ts
src/settings/validation.test.ts
src/settings/validation.ts
src/test-preload.ts
src/types.ts
src/ui/fileSuggest.ts
src/utils.test.ts
src/utils.ts
```

## Domain Types

The `Granularity` union and `granularities` array are the foundation. Every subsystem
branches on granularity to determine formats, commands, and cache keys.

```bash
sed -n '1,20p' src/types.ts
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

Default format strings and config are defined in `constants.ts`. These serve as
fallbacks throughout the plugin when a user has not configured a granularity.

```bash
sed -n '1,30p' src/constants.ts
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

## Plugin Entry Point

`PeriodicNotesPlugin` in `main.ts` orchestrates the entire lifecycle: loading settings,
initializing the cache, registering commands and views, and exposing a public API.

```bash
sed -n '1,30p' src/main.ts
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
```

```bash
sed -n '35,80p' src/main.ts
```

```output
  isMetaPressed,
} from "./utils";

interface OpenOpts {
  inNewSplit?: boolean;
}

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
```

```bash
sed -n '80,130p' src/main.ts
```

```output
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
```

The plugin's `onload` registers icons, loads settings into a Svelte writable store,
initializes the locale, creates the cache, registers commands and the calendar view,
and opens a startup note on layout ready if configured.

The public API (`openPeriodicNote`, `createPeriodicNote`, etc.) is used by the
calendar view and commands to interact with vault files.

```bash
sed -n '133,200p' src/main.ts
```

```output
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
      granularity,
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
```

```bash
sed -n '200,240p' src/main.ts
```

```output
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

`openPeriodicNote` is the primary action: look up an existing file in the cache,
create one if missing (applying the template), then open it. This is called by
commands, the ribbon icon, and the calendar view.

## Cache

`PeriodicNotesCache` maintains a `Map<filePath, PeriodicNoteCachedMetadata>` of every
vault file that matches a periodic note pattern. It resolves files by strict moment
parsing against the configured format, falls back to loose parsing, and supports
frontmatter `granularity:` keys for override.

```bash
sed -n '1,50p' src/cache.ts
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

```

```bash
sed -n '55,120p' src/cache.ts
```

```output
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
```

```bash
sed -n '120,195p' src/cache.ts
```

```output
          const metadata = this.app.metadataCache.getFileCache(file);
          if (metadata) {
            this.resolveChangedMetadata(file, "", metadata);
          }
        }
      });
    }
  }

  private resolveChangedMetadata(
    file: TFile,
    _data: string,
    cache: CachedMetadata,
  ): void {
    const settings = get(this.plugin.settings);
    const activeGranularities = granularities.filter(
      (g) => settings[g]?.enabled,
    );
    if (activeGranularities.length === 0) return;

    for (const granularity of activeGranularities) {
      const folder = settings[granularity]?.folder || "";
      if (!file.path.startsWith(folder)) continue;
      const frontmatterEntry = parseFrontMatterEntry(
        cache.frontmatter,
        granularity,
      );
      if (!frontmatterEntry) continue;

      const format = DEFAULT_FORMAT[granularity];
      if (typeof frontmatterEntry === "string") {
        const date = window.moment(frontmatterEntry, format, true);
        if (date.isValid()) {
          this.set(file.path, {
            filePath: file.path,
            date,
            granularity,
            canonicalDateStr: getCanonicalDateString(granularity, date),
            matchData: {
              exact: true,
              matchType: "frontmatter",
            },
          });
        }
        return;
      }
    }
  }

  private resolveRename(file: TAbstractFile, oldPath: string): void {
    if (file instanceof TFile) {
      this.cachedFiles.delete(oldPath);
      this.resolve(file, "rename");
    }
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

```

```bash
sed -n '195,260p' src/cache.ts
```

```output

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
          applyPeriodicTemplateToFile(this.app, file, settings, metadata).catch(
            (err) => {
              console.error("[Periodic Notes] failed to apply template", err);
              new Notice(
                `Periodic Notes: failed to apply template to "${file.path}". See console for details.`,
              );
            },
          );
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

  public getPeriodicNote(
    granularity: Granularity,
    targetDate: Moment,
  ): TFile | null {
    for (const [filePath, cacheData] of this.cachedFiles) {
      if (
        cacheData.granularity === granularity &&
        cacheData.matchData.exact === true &&
        cacheData.date.isSame(targetDate, granularity)
```

```bash
sed -n '260,340p' src/cache.ts
```

```output
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

The cache walks configured folders on startup, resolves each file against configured
date formats, and falls back to loose parsing via `parser.ts`. On `create` events for
empty files, it auto-applies the template. The `findAdjacent` method enables the
"jump to next/previous" commands.

**Stale entry eviction:** `getPeriodicNote` deletes entries where the file no longer
exists in the vault (`instanceof TFile` check), then continues the lookup loop.

## Parser — Loose Date Matching

When strict moment parsing fails, `getLooselyMatchedDate` tries common date patterns
as a fallback.

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

## Utilities

`utils.ts` is a large module with template processing, path building, and settings
accessors. The core function is `applyTemplateTransformations`, which replaces tokens
like `{{date}}`, `{{time}}`, `{{yesterday}}`, and granularity-specific tokens with
optional arithmetic and format overrides.

```bash
sed -n '1,30p' src/utils.ts
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
  return Platform.isMacOS ? e.metaKey : e.ctrlKey;
}

function getDaysOfWeek(): string[] {
  const { moment } = window;
  let weekStart = moment.localeData().firstDayOfWeek();
  const daysOfWeek = [
    "sunday",
    "monday",
    "tuesday",
```

```bash
sed -n '44,120p' src/utils.ts
```

```output

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
        const day = getDayOfWeekNumericalValue(dayOfWeek);
        return date.weekday(day).format(momentFormat.trim());
      },
    );
  }
```

```bash
sed -n '120,180p' src/utils.ts
```

```output
  }

  if (
    granularity === "month" ||
    granularity === "quarter" ||
    granularity === "year"
  ) {
    templateContents = replaceGranularityTokens(
      templateContents,
      date,
      granularity,
      format,
      granularity,
    );
  }

  return templateContents;
}

export function getFormat(
  settings: Settings,
  granularity: Granularity,
): string {
  return settings[granularity]?.format || DEFAULT_FORMAT[granularity];
}

/**
 * When matching file formats, users can specify `YYYY/YYYY-MM-DD`. We should look for
 * paths that match either `YYYY/YYYY-MM-DD` exactly, or just `YYYY-MM-DD` in case
 * users move the file later.
 */
export function getPossibleFormats(
  settings: Settings,
  granularity: Granularity,
): string[] {
  const format = settings[granularity]?.format;
  if (!format) return [DEFAULT_FORMAT[granularity]];

  const partialFormatExp = /[^/]*$/.exec(format);
  if (partialFormatExp) {
    const partialFormat = partialFormatExp[0];
    return [format, partialFormat];
  }
  return [format];
}

export function getFolder(
  settings: Settings,
  granularity: Granularity,
): string {
  return settings[granularity]?.folder || "/";
}

export function getConfig(
  settings: Settings,
  granularity: Granularity,
): PeriodicConfig {
  return settings[granularity] ?? DEFAULT_PERIODIC_CONFIG;
}

export async function applyPeriodicTemplateToFile(
```

```bash
sed -n '180,240p' src/utils.ts
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
    metadata.granularity,
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
  granularity: Granularity,
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
      `[Periodic Notes] Failed to read the ${granularity} note template '${normalizedTemplatePath}'`,
      err,
    );
    new Notice(`Failed to read the ${granularity} note template`);
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
```

Template transformation handles five cases:
- **Day:** `{{date}}`, `{{time}}`, `{{yesterday}}`, `{{tomorrow}}`, plus weekday names with format
- **Week:** `{{sunday:format}}` through `{{saturday:format}}` — weekday-relative dates
- **Month/Quarter/Year:** granularity tokens with optional `±Nunit` arithmetic and `:format` override
- All tokens support the pattern `{{token±Nunit:format}}` via `replaceGranularityTokens`

## Commands

Commands are generated per-granularity: open today's note, jump to next/previous
existing note, and open the next/previous period.

```bash
sed -n '1,70p' src/commands.ts
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
```

```bash
sed -n '70,130p' src/commands.ts
```

```output
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
```

Each granularity gets five commands: open current, jump forwards/backwards (to existing
notes), and open next/previous (creates if missing). Commands use `checkCallback` to
only appear when the granularity is enabled and, for jump commands, when the active file
is periodic.

## Settings Subsystem

Settings are stored as a Svelte writable store. The settings tab mounts a Svelte component
tree into Obsidian's settings container.

```bash
sed -n '1,50p' src/settings/index.ts
```

```output
import { type App, PluginSettingTab } from "obsidian";
import type { PeriodicConfig } from "src/types";
import { mount, unmount } from "svelte";

import type PeriodicNotesPlugin from "../main";
import SettingsPage from "./pages/SettingsPage.svelte";

export interface Settings {
  showGettingStartedBanner: boolean;

  day?: PeriodicConfig;
  week?: PeriodicConfig;
  month?: PeriodicConfig;
  quarter?: PeriodicConfig;
  year?: PeriodicConfig;
}

export const DEFAULT_SETTINGS: Settings = {
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
```

The settings tab mounts `SettingsPage.svelte` with `app` and the plugin's `Writable<Settings>`.
Each granularity gets a `PeriodicGroup` component that uses `svelte-writable-derived` to
slice a writable for just that granularity's config, so child components can bind directly.

### Validation

Format, folder, and template inputs are validated on change. Format validation checks that
the format string is parseable by moment and warns about ambiguous formats that could
match multiple granularities.

```bash
sed -n '1,60p' src/settings/validation.ts
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
```

### Localization

The plugin reads Obsidian's private vault config for locale and week-start overrides,
applying them to the global moment instance. This ensures calendar rendering and
date formatting match the user's Obsidian settings.

```bash
sed -n '125,160p' src/settings/localization.ts
```

```output
  }

  const localization = getLocalizationSettings(app);
  const { localeOverride, weekStart } = localization;

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

## Calendar View

The calendar sidebar view is a Svelte 5 component tree mounted in an Obsidian `ItemView`.
The architecture uses a reactivity bridge pattern: TypeScript communicates to Svelte via
exported functions, and Svelte communicates back via callback props.

```bash
sed -n '1,70p' src/calendar/view.ts
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

  getIcon(): string {
    return "calendar-day";
  }

  async onClose(): Promise<void> {
    if (this.calendar) {
      unmount(this.calendar);
    }
  }

  async onOpen(): Promise<void> {
    const fileStore = new CalendarFileStore(this, this.plugin);

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

  private onHover(
    granularity: Granularity,
    date: Moment,
    file: TFile | null,
    targetEl: EventTarget,
    metaPressed: boolean,
  ): void {
```

```bash
sed -n '70,130p' src/calendar/view.ts
```

```output
  ): void {
    if (!metaPressed) return;
    const formattedDate = date.format(
      granularity === "day"
        ? "YYYY-MM-DD"
        : date.localeData().longDateFormat("L"),
    );
    this.app.workspace.trigger(
      "link-hover",
      this,
      targetEl,
      formattedDate,
      file?.path ?? "",
    );
  }

  private onClick(
    granularity: Granularity,
    date: Moment,
    _existingFile: TFile | null,
    inNewSplit: boolean,
  ): void {
    this.plugin.openPeriodicNote(granularity, date, { inNewSplit });
  }

  private onContextMenu(
    _granularity: Granularity,
    _date: Moment,
    file: TFile | null,
    event: MouseEvent,
  ): void {
    if (!file) return;
    const menu = new Menu();
    menu.addItem((item) =>
      item
        .setTitle("Delete")
        .setIcon("trash")
        .onClick(() => {
          this.app.vault.trash(file, true);
        }),
    );
    this.app.workspace.trigger(
      "file-menu",
      menu,
      file,
      "calendar-context-menu",
      null,
    );
    menu.showAtPosition({ x: event.pageX, y: event.pageY });
  }

  private onFileOpen(_file: TFile | null): void {
    if (!this.app.workspace.layoutReady) return;
    if (this.calendar) {
      const path = this.app.workspace.getActiveFile()?.path ?? null;
      this.calendar.setActiveFilePath(path);
      this.calendar.tick();
    }
  }
}
```

### FileStore — Reactive Bridge

`CalendarFileStore` bridges Obsidian vault events into Svelte reactivity. It holds a
writable counter; incrementing it signals the Calendar component to recompute the FileMap.
`bump()` filters via `isPeriodic()` to skip irrelevant file events.

```bash
cat src/calendar/fileStore.ts
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

  private onRename(file: TAbstractFile, oldPath: string): void {
    if (this.plugin.isPeriodic(file.path) || this.plugin.isPeriodic(oldPath)) {
      this.store.update((n) => n + 1);
    }
  }

  public getFile(date: Moment, granularity: Granularity): TFile | null {
    return this.plugin.getPeriodicNote(granularity, date);
  }

  public isGranularityEnabled(granularity: Granularity): boolean {
    const settings = get(this.plugin.settings);
    return settings[granularity]?.enabled ?? granularity === "day";
  }

  public getEnabledGranularities(): Granularity[] {
    const settings = get(this.plugin.settings);
    return (["week", "month", "year"] as Granularity[]).filter(
      (g) => settings[g]?.enabled,
    );
  }
}

const KEY_FORMATS: Record<Granularity, string> = {
  day: "YYYY-MM-DD",
  week: "gggg-[W]ww",
  month: "YYYY-MM",
  quarter: "YYYY-[Q]Q",
  year: "YYYY",
};

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
  }

  return map;
}
```

### Calendar Component

`Calendar.svelte` is the root component. It owns all top-level state and subscribes
to the fileStore once, recomputing a `FileMap` that children reference via `$derived`
lookups. This avoids 48+ per-cell subscriptions.

```bash
cat src/calendar/Calendar.svelte
```

```output
<script lang="ts">
  import type { Moment } from "moment";
  import { setContext } from "svelte";
  import { writable } from "svelte/store";

  import { DISPLAYED_MONTH } from "./context";
  import Day from "./Day.svelte";
  import type CalendarFileStore from "./fileStore";
  import { computeFileMap, fileMapKey } from "./fileStore";
  import Nav from "./Nav.svelte";
  import type { FileMap, IEventHandlers, IMonth } from "./types";
  import { getMonth, getWeekdayLabels, isWeekend } from "./utils";
  import WeekNum from "./WeekNum.svelte";

  let {
    fileStore,
    onHover,
    onClick,
    onContextMenu,
  }: {
    fileStore: CalendarFileStore;
    onHover: IEventHandlers["onHover"];
    onClick: IEventHandlers["onClick"];
    onContextMenu: IEventHandlers["onContextMenu"];
  } = $props();

  let activeFilePath: string | null = $state(null);

  let today: Moment = $state.raw(window.moment());

  const displayedMonthStore = writable<Moment>(window.moment());
  setContext(DISPLAYED_MONTH, displayedMonthStore);

  let month: IMonth = $state.raw(getMonth(window.moment()));
  let showWeekNums: boolean = $state(false);
  let fileMap: FileMap = $state.raw(new Map());

  $effect(() => {
    month = getMonth($displayedMonthStore);
  });

  $effect(() => {
    const currentMonth = month;
    return fileStore.store.subscribe(() => {
      showWeekNums = fileStore.isGranularityEnabled("week");
      fileMap = computeFileMap(
        currentMonth,
        (date, granularity) => fileStore.getFile(date, granularity),
        fileStore.getEnabledGranularities(),
      );
    });
  });

  let eventHandlers: IEventHandlers = $derived({
    onHover,
    onClick,
    onContextMenu,
  });

  const daysOfWeek: string[] = getWeekdayLabels();

  export function tick() {
    const now = window.moment();
    if (!now.isSame(today, "day")) {
      today = now;
    }
  }

  export function setActiveFilePath(path: string | null) {
    activeFilePath = path;
  }
</script>

<div id="calendar-container" class="container">
  <Nav {fileMap} {today} {eventHandlers} />
  <table class="calendar">
    <colgroup>
      {#if showWeekNums}
        <col />
      {/if}
      {#each month[1].days as date}
        <col class:weekend={isWeekend(date)} />
      {/each}
    </colgroup>
    <thead>
      <tr>
        {#if showWeekNums}
          <th>W</th>
        {/if}
        {#each daysOfWeek as dayOfWeek}
          <th>{dayOfWeek}</th>
        {/each}
      </tr>
    </thead>
    <tbody>
      {#each month as week (fileMapKey("week", week.days[0]))}
        <tr>
          {#if showWeekNums}
            <WeekNum
              {fileMap}
              {activeFilePath}
              {...week}
              {...eventHandlers}
            />
          {/if}
          {#each week.days as day (day.format())}
            <Day
              date={day}
              {fileMap}
              {today}
              {activeFilePath}
              {...eventHandlers}
            />
          {/each}
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  .container {
    --color-background-heading: transparent;
    --color-background-day: transparent;
    --color-background-weeknum: transparent;
    --color-background-weekend: transparent;

    --color-arrow: var(--text-muted);
    --color-button: var(--text-muted);

    --color-text-title: var(--text-normal);
    --color-text-heading: var(--text-muted);
    --color-text-day: var(--text-normal);
    --color-text-today: var(--interactive-accent);
    --color-text-weeknum: var(--text-muted);
  }

  .container {
    padding: 0 8px;
  }

  .weekend {
    background-color: var(--color-background-weekend);
  }

  .calendar {
    border-collapse: collapse;
    width: 100%;
  }

  th {
    background-color: var(--color-background-heading);
    color: var(--color-text-heading);
    font-size: 0.6em;
    letter-spacing: 1px;
    padding: 4px;
    text-align: center;
    text-transform: uppercase;
  }
</style>
```

Key patterns in the Calendar component:
- **Store bridge:** `$effect` + `.subscribe()` is required because `$derived.by()` does
  NOT track Svelte store auto-subscriptions
- **FileMap pattern:** One subscription computes the full `Map<string, TFile | null>`;
  children do `$derived` lookups via `fileMapKey()` — no per-cell subscriptions
- **Exported functions:** `tick()` and `setActiveFilePath()` are the View→Svelte bridge

### Day and WeekNum Cells

Each cell does a simple derived lookup into the FileMap.

```bash
cat src/calendar/Day.svelte
```

```output
<script lang="ts">
  import type { Moment } from "moment";
  import { getContext } from "svelte";
  import type { Writable } from "svelte/store";

  import { isMetaPressed } from "src/utils";
  import { DISPLAYED_MONTH } from "./context";
  import { fileMapKey } from "./fileStore";
  import type { FileMap, IEventHandlers } from "./types";

  let {
    date,
    fileMap,
    onHover,
    onClick,
    onContextMenu,
    today,
    activeFilePath = null,
  }: {
    date: Moment;
    fileMap: FileMap;
    onHover: IEventHandlers["onHover"];
    onClick: IEventHandlers["onClick"];
    onContextMenu: IEventHandlers["onContextMenu"];
    today: Moment;
    activeFilePath: string | null;
  } = $props();

  const displayedMonth = getContext<Writable<Moment>>(DISPLAYED_MONTH);

  let file = $derived(fileMap.get(fileMapKey("day", date)) ?? null);

  function handleClick(event: MouseEvent) {
    onClick?.("day", date, file, isMetaPressed(event));
  }

  function handleHover(event: PointerEvent) {
    if (event.target) {
      onHover?.("day", date, file, event.target, isMetaPressed(event));
    }
  }

  function handleContextmenu(event: MouseEvent) {
    onContextMenu?.("day", date, file, event);
  }
</script>

<td>
  <div
    role="button"
    tabindex="0"
    class="day"
    class:active={file !== null && file.path === activeFilePath}
    class:adjacent-month={!date.isSame($displayedMonth, "month")}
    class:has-note={file !== null}
    class:today={date.isSame(today, "day")}
    onclick={handleClick}
    onkeydown={(e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onClick?.("day", date, file, false);
      }
    }}
    oncontextmenu={handleContextmenu}
    onpointerenter={handleHover}
  >
    {date.format("D")}
  </div>
</td>

<style>
  .day {
    background-color: var(--color-background-day);
    border-radius: 4px;
    color: var(--color-text-day);
    cursor: pointer;
    font-size: 0.8em;
    height: 100%;
    padding: 4px;
    position: relative;
    text-align: center;
    transition:
      background-color 0.1s ease-in,
      color 0.1s ease-in;
    vertical-align: baseline;
  }
  .day:hover {
    background-color: var(--interactive-hover);
  }

  .day.active:hover {
    background-color: var(--interactive-accent-hover);
  }

  .adjacent-month {
    opacity: 0.25;
  }

  .has-note::after {
    background-color: var(--text-muted);
    border-radius: 50%;
    content: "";
    display: block;
    height: 3px;
    margin: 1px auto 0;
    width: 3px;
  }

  .has-note.active::after {
    background-color: var(--text-on-accent);
  }

  .today {
    color: var(--interactive-accent);
    font-weight: 600;
  }

  .day:active,
  .active,
  .active.today {
    color: var(--text-on-accent);
    background-color: var(--interactive-accent);
  }
</style>
```

### Calendar Grid Computation

`calendar/utils.ts` computes a 6-week grid (always 42 days) padded with adjacent-month
days. The grid only changes on month navigation, not on file events.

```bash
cat src/calendar/utils.ts
```

```output
import type { Moment } from "moment";
import type { IMonth, IWeek } from "./types";

export function getWeekdayLabels(): string[] {
  return window.moment.weekdaysShort(true);
}

export function isWeekend(date: Moment): boolean {
  return date.isoWeekday() === 6 || date.isoWeekday() === 7;
}

export function getStartOfWeek(days: Moment[]): Moment {
  return days[0].clone();
}

export function getMonth(displayedMonth: Moment): IMonth {
  const month: IMonth = [];
  let week!: IWeek;

  const startOfMonth = displayedMonth.clone().date(1);
  const startOffset = startOfMonth.weekday();
  let date: Moment = startOfMonth.clone().subtract(startOffset, "days");

  for (let _day = 0; _day < 42; _day++) {
    if (_day % 7 === 0) {
      week = {
        days: [],
        weekNum: date.week(),
      };
      month.push(week);
    }

    week.days.push(date);
    date = date.clone().add(1, "days");
  }

  return month;
}
```

### Month Title and Nav

`Month.svelte` renders the clickable month/year title. It uses a `makeHandlers()` factory
to avoid duplicating click/hover/context handler logic for month and year spans.
`Nav.svelte` wraps the title with prev/next arrows and a reset dot.

```bash
sed -n '1,50p' src/calendar/Month.svelte
```

```output
<script lang="ts">
  import type { Moment } from "moment";
  import type { TFile } from "obsidian";
  import { getContext } from "svelte";
  import type { Writable } from "svelte/store";

  import type { Granularity } from "src/types";
  import { isMetaPressed } from "src/utils";
  import { DISPLAYED_MONTH } from "./context";
  import { fileMapKey } from "./fileStore";
  import type { FileMap, IEventHandlers } from "./types";

  let {
    fileMap,
    onHover,
    onClick,
    onContextMenu,
    resetDisplayedMonth,
  }: {
    fileMap: FileMap;
    onHover: IEventHandlers["onHover"];
    onClick: IEventHandlers["onClick"];
    onContextMenu: IEventHandlers["onContextMenu"];
    resetDisplayedMonth: () => void;
  } = $props();

  let displayedMonth = getContext<Writable<Moment>>(DISPLAYED_MONTH);

  let monthKey = $derived(fileMapKey("month", $displayedMonth));
  let yearKey = $derived(fileMapKey("year", $displayedMonth));
  let monthEnabled = $derived(fileMap.has(monthKey));
  let yearEnabled = $derived(fileMap.has(yearKey));
  let monthFile = $derived(fileMap.get(monthKey) ?? null);
  let yearFile = $derived(fileMap.get(yearKey) ?? null);

  function makeHandlers(
    granularity: Granularity,
    getEnabled: () => boolean,
    getFile: () => TFile | null,
  ) {
    return {
      click: (event: MouseEvent) => {
        if (getEnabled()) {
          onClick?.(
            granularity,
            $displayedMonth,
            getFile(),
            isMetaPressed(event),
          );
        } else if (granularity === "month") {
```

## Concerns

### Code Quality

1. **Two a11y warnings** in `Month.svelte` (lines 87, 107): noninteractive `<span>` elements
   have `tabindex="0"`. These should either be `<button>` elements or use `role="button"`.

2. **`getPeriodicNote` linear scan**: The cache lookup iterates the full `cachedFiles` map
   on every call. For vaults with many periodic notes, a secondary index keyed by
   `granularity:canonicalDateStr` would be more efficient.

3. **`findAdjacent` sorts on every call**: Converts the entire cache to an array, filters,
   and sorts. Could maintain a sorted index to avoid repeated work.

4. **`_granularity` unused parameter** in `getCanonicalDateString` (cache.ts) — the
   parameter is prefixed with underscore but still accepted, suggesting it was planned for
   granularity-specific canonical formats that were never implemented.

5. **`resolve` template application on create**: The cache's `resolve` method applies
   templates when a file is created with size 0. This mixes concerns — file resolution
   should not trigger side effects. Template application belongs in `createPeriodicNote`.

### Community Standards

6. **Private API usage** (`vault.getConfig`) is wrapped in try-catch with fallback — this
   follows the recommended defensive pattern for Obsidian private APIs.

7. **No external plugin dependencies** — the NLDates dependency was removed in 1.3.0,
   reducing coupling to other plugins.

8. **Svelte 5 patterns** are used consistently (runes, `$derived`, `$effect`, `$state`).
   The store bridge pattern (`$effect` + `.subscribe()`) correctly handles the Svelte 5
   limitation where `$derived.by()` does not track store auto-subscriptions.

