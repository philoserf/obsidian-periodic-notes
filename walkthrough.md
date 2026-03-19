# Periodic Notes Walkthrough

*2026-03-19T18:38:12Z by Showboat 0.6.1*
<!-- showboat-id: 8c0c6b2b-9cc6-4dd8-a9d2-066f06aa362f -->

## Overview

Periodic Notes is an Obsidian plugin that creates and manages daily, weekly, monthly,
quarterly, and yearly notes. It provides:

- Configurable filename formats, folders, and templates per granularity
- A sidebar calendar view built with Svelte 5
- Commands to open, navigate, and create periodic notes
- A cache that indexes notes by parsing filenames, frontmatter, and loose date patterns
- Locale-aware week numbering via Moment.js

**Key technologies:** TypeScript, Svelte 5, Vite, Moment.js, Obsidian Plugin API

## Architecture

The plugin is organized into four main areas:

| Directory | Purpose |
|-----------|---------|
| `src/` (root) | Plugin entry point, cache, commands, types, utilities |
| `src/calendar/` | Svelte 5 sidebar calendar with reactive file store |
| `src/settings/` | Settings UI with validation, localization |
| `src/ui/` | Shared UI components (file suggest) |

```bash
find src -name '*.ts' -o -name '*.svelte' | grep -v node_modules | grep -v test | grep -v '.d.ts' | sort
```

```output
src/cache.ts
src/calendar/Arrow.svelte
src/calendar/Calendar.svelte
src/calendar/constants.ts
src/calendar/context.ts
src/calendar/Day.svelte
src/calendar/fileStore.ts
src/calendar/Month.svelte
src/calendar/Nav.svelte
src/calendar/types.ts
src/calendar/utils.ts
src/calendar/view.ts
src/calendar/WeekNum.svelte
src/commands.ts
src/constants.ts
src/icons.ts
src/main.ts
src/modal.ts
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
src/settings/localization.ts
src/settings/pages/dashboard/GettingStartedBanner.svelte
src/settings/pages/details/PeriodicGroup.svelte
src/settings/pages/SettingsPage.svelte
src/settings/utils.ts
src/settings/validation.ts
src/types.ts
src/ui/fileSuggest.ts
src/utils.ts
```

## Entry Point — Plugin Lifecycle

`src/main.ts` defines `PeriodicNotesPlugin`, which orchestrates all subsystems.
On load it registers icons, creates a settings store, initializes the cache,
registers the calendar view and commands, and configures ribbon icons.

```bash
sed -n '1,15p' src/main.ts
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
```

```bash
sed -n '48,97p' src/main.ts
```

```output
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
```

The `onload` lifecycle:

1. Register 5 custom SVG icons (one per granularity)
2. Create a Svelte writable store for settings; load saved data
3. Subscribe to settings changes via `onUpdateSettings`
4. Configure Moment.js locale once (weekStart, language)
5. Create `PeriodicNotesCache` to index files
6. Register settings tab, ribbon icons, and commands
7. Register `CalendarView` as an Obsidian `ItemView`
8. On layout ready, open the startup note if configured

## Settings Store and Persistence

Settings are stored in a Svelte writable store, making them reactive across the
calendar and settings UI. When settings change, `onUpdateSettings` saves to disk,
reconfigures ribbon icons, and fires a workspace event to reset the cache.

```bash
sed -n '99,131p' src/main.ts
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
```

```bash
sed -n '135,167p' src/main.ts
```

```output
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
```

## Types and Constants

The `Granularity` type and `PeriodicConfig` interface define the core data model.
Each granularity has an enable flag, format string, folder path, optional template,
and startup-open toggle.

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

## Cache — File Indexing and Lookup

`src/cache.ts` defines `PeriodicNotesCache`, the core indexing engine. It scans
vault files, parses dates from filenames and frontmatter, and maintains a map of
cached periodic notes. The cache uses three matching strategies in priority order:
frontmatter (exact), filename parse (exact), and loose regex (fallback).

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

```bash
sed -n '49,125p' src/cache.ts
```

```output
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
```

```bash
sed -n '127,215p' src/cache.ts
```

```output
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
```

```bash
sed -n '215,290p' src/cache.ts
```

```output
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
```

The cache lifecycle:

1. **Initialize** — On layout ready, scan enabled granularity folders recursively
2. **Resolve** — For each file, try frontmatter → filename → loose parse
3. **React** — Listen to vault create/rename, metadataCache changed, settings-updated
4. **Lookup** — `getPeriodicNote()` finds exact matches; `getPeriodicNotes()` supports finer granularities
5. **Template** — On new file creation (size === 0), apply template transformations

Stale entries are evicted during lookup: if the file no longer exists in the vault,
the entry is deleted and the loop continues searching.

## Parser — Loose Date Matching

`src/parser.ts` provides `getLooselyMatchedDate()`, which uses regex patterns
to extract dates from filenames that don't match any configured format exactly.
This enables the calendar to show files with non-standard names.

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

## Template System

`src/utils.ts` handles file creation and template variable replacement.
`getTemplateContents()` reads the template file, then `applyTemplateTransformations()`
replaces variables like `{{date}}`, `{{title}}`, `{{yesterday}}`, `{{tomorrow}}`,
time-based tokens, and offset expressions like `{{date+1d:YYYY-MM-DD}}`.

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

```bash
sed -n '50,137p' src/utils.ts
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
        const day = getDayOfWeekNumericalValue(dayOfWeek);
        return date.weekday(day).format(momentFormat.trim());
      },
    );
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
```

```bash
sed -n '202,236p' src/utils.ts
```

```output
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
```

`replaceGranularityTokens()` is the shared workhorse for day, month, quarter, and
year offsets. The regex captures an optional delta (e.g. `+1d`) and an optional
format suffix (e.g. `:YYYY-MM-DD`). Week templates use a separate branch that
maps weekday names to `date.weekday(n).format()`.

## Commands

`src/commands.ts` generates five commands per granularity: open current,
jump next/previous (navigate within existing notes), and open next/previous
(create if missing). Commands are only registered for enabled granularities.

```bash
sed -n '1,60p' src/commands.ts
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
```

## Calendar View

The calendar sidebar is a Svelte 5 application mounted in an Obsidian `ItemView`.
`CalendarView` (src/calendar/view.ts) creates a `CalendarFileStore` and mounts
`Calendar.svelte`, passing callback props for hover, click, and context menu events.

### Reactivity Bridge

The Svelte/Obsidian boundary requires careful handling:

- **View → Component**: `CalendarView` calls exported functions `tick()` and
  `setActiveFilePath()` on the Svelte component
- **Component → View**: Svelte calls callback props (`onHover`, `onClick`, `onContextMenu`)
- **Store bridge**: `$derived.by()` does NOT track Svelte store auto-subscriptions,
  so `$state` + `$effect` + `.subscribe()` is used instead

```bash
sed -n '1,80p' src/calendar/view.ts
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
```

### FileStore — Bridging Vault Events to Svelte

`CalendarFileStore` wraps a simple numeric counter store. Vault events
increment the counter (filtered via `isPeriodic()`), which triggers
Svelte reactivity. The `computeFileMap()` function pre-computes a
`Map<string, TFile | null>` for the displayed month, so child components
do cheap `$derived` lookups via `fileMapKey()`.

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

### Calendar Components

The component hierarchy: `Calendar.svelte` → `Nav.svelte` + day/week table.
`Nav.svelte` contains `Month.svelte` (clickable title) and `Arrow.svelte` buttons.
Each table cell is a `Day.svelte` or `WeekNum.svelte` that derives its file
from the pre-computed fileMap.

```bash
sed -n '1,80p' src/calendar/Calendar.svelte
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
```

```bash
sed -n '80,140p' src/calendar/Calendar.svelte
```

```output
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
```

Key reactivity pattern in Calendar.svelte: the `$effect` block subscribes to
`fileStore.store` (a numeric counter) using `.subscribe()`, not `$derived.by()`.
This is necessary because `$derived.by()` does not track Svelte store
auto-subscriptions. When vault events increment the counter, the effect
recomputes the fileMap.

## Settings UI

The settings tab mounts `SettingsPage.svelte`, which renders a
`PeriodicGroup.svelte` for each granularity. Each group has a toggle,
format input with validation feedback, folder picker, template picker,
and open-at-startup toggle.

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
}
```

### Validation

`src/settings/validation.ts` validates format strings, folder paths, and template
paths. It also detects "fragile" formats where the basename alone doesn't uniquely
parse (e.g., `YYYY/YYYY-MM-DD` where the date part lives in a subfolder path).

```bash
sed -n '1,65p' src/settings/validation.ts
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
```

### Localization

`src/settings/localization.ts` configures Moment.js locale and week start day.
It reads Obsidian's private API (`vault.getConfig("localeOverride")` and
`vault.getConfig("weekStart")`) in a try-catch, mapping Obsidian language codes
to Moment.js locale identifiers. A bundled locale week spec is cached on
`window._bundledLocaleWeekSpec` for fallback.

```bash
sed -n '100,160p' src/settings/localization.ts
```

```output
  const obsidianLang = localStorage.getItem("language") || "en";
  const systemLang = navigator.language?.toLowerCase();

  let momentLocale = langToMomentLocale[obsidianLang];

  if (localeOverride !== "system-default") {
    momentLocale = localeOverride;
  } else if (systemLang?.startsWith(obsidianLang)) {
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

## Build System

Vite builds from `src/main.ts` to `./main.js` in CommonJS format. The build
externalizes `obsidian`, `electron`, `fs`, `os`, and `path`. A custom plugin
copies the CSS output to `styles.css` in the project root. The `emptyOutDir`
flag is `false` to prevent Vite from clearing the project root.

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

## Testing

Tests use Bun's built-in test runner. A preload script (`src/test-preload.ts`)
provides `window.moment` globally. Test files re-implement pure functions to
avoid importing modules that depend on `obsidian`. Modules that cannot be
imported in tests: `cache.ts`, `utils.ts`, `settings/validation.ts`.

```bash
cat src/test-preload.ts
```

```output
import moment from "moment";

// @ts-expect-error partial window mock for test environment
globalThis.window = {
  moment,
  _bundledLocaleWeekSpec: { dow: 0, doy: 6 },
};
```

```bash
grep -c 'test(' src/*.test.ts src/**/*.test.ts 2>/dev/null | grep -v ':0$'
```

```output
src/cache.test.ts:25
src/parser.test.ts:11
src/utils.test.ts:63
src/settings/localization.test.ts:12
src/settings/utils.test.ts:11
src/settings/validation.test.ts:27
```

```bash
grep -c 'test(' src/*.test.ts src/**/*.test.ts 2>/dev/null | awk -F: '{s+=$2} END {print s " tests across " NR " files"}'
```

```output
149 tests across 8 files
```

Note: `grep -c 'test('` counts test declarations statically (149), while
`bun test` reports 159 because some tests are generated dynamically via
`test.each()` or similar patterns.

## Concerns

### Open Technical Debt (GitHub Issues)

- **#93** — Test files re-implement source functions, risking drift between
  test copies and production code
- **#92** — Unused `_app` parameter in `showFileMenu`
- **#91** — Weekday name array duplicated in three files
- **#90** — Undocumented store counter and subscription bridge patterns
- **#89** — Asymmetric template path guard in `getTemplateContents`

### Code Quality Observations

1. **a11y warnings**: `Month.svelte` has two `a11y_no_noninteractive_tabindex`
   warnings (lines 87, 107) for non-interactive `<span>` elements with `tabIndex`.
   These spans are functionally interactive (clickable month/year labels) but use
   `<span>` instead of `<button>`, which is an a11y anti-pattern.

2. **Cache linear scan**: `getPeriodicNote()` iterates the entire `cachedFiles`
   map on every lookup. For vaults with thousands of periodic notes this could
   become a bottleneck. A secondary index by `canonicalDateStr` would improve
   lookup to O(1).

3. **Private API usage**: `vault.getConfig()` is undocumented and could break
   in any Obsidian update. The try-catch is appropriate but the fallback behavior
   should be documented for users.

4. **Template path asymmetry (#89)**: `getTemplateContents()` guards against
   `templatePath === "/"` but not other invalid paths like empty string. The
   normalization via `normalizePath()` handles some cases but the guard is
   inconsistent.

5. **Test isolation**: Test files cannot import modules with `obsidian` dependencies,
   so they re-implement functions locally (#93). This creates maintenance risk
   when the source implementation changes but the test copy doesn't.

