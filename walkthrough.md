# Periodic Notes — Code Walkthrough

*2026-03-10T23:07:41Z by Showboat 0.6.1*
<!-- showboat-id: 479694c2-70e6-409a-8694-56a3396d1a8f -->

## Overview

Periodic Notes is an Obsidian plugin for creating and managing daily, weekly, monthly, quarterly, and yearly notes. It replaces Obsidian's built-in daily notes with a more flexible system supporting five granularity levels, configurable date formats, folder organization, and template-driven note creation.

The plugin is built with TypeScript, Svelte 5, and Vite. It uses Moment.js (bundled with Obsidian) for all date operations and Obsidian's Component lifecycle for resource management.

### Architecture at a glance

- **Entry point** (`main.ts`) — Plugin lifecycle, public API, ribbon/commands
- **Cache** (`cache.ts`) — File resolution engine mapping vault files to periodic notes
- **Utilities** (`utils.ts`) — Template transforms, date helpers, path utilities
- **Parser** (`parser.ts`) — Loose date extraction from filenames
- **Settings** (`settings/`) — Svelte-powered settings UI, validation, localization
- **Switcher** (`switcher/`) — Modal for navigating periodic notes by date
- **Commands** (`commands.ts`) — Command palette integration

## 1. Project Structure

```bash
find src -type f | sort | sed "s|^|  |"
```

```output
  src/cache.test.ts
  src/cache.ts
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
  src/switcher/relatedFilesSwitcher.ts
  src/switcher/switcher.ts
  src/types.ts
  src/ui/fileSuggest.ts
  src/utils.test.ts
  src/utils.ts
```

The source breaks into five layers:

| Layer | Files | Purpose |
|-------|-------|---------|
| Core types | `types.ts`, `constants.ts`, `obsidian.d.ts` | Shared types, defaults, Obsidian API augmentations |
| Data | `cache.ts`, `parser.ts` | File-to-date resolution and caching |
| Logic | `utils.ts`, `commands.ts`, `modal.ts` | Template transforms, command registration, UI actions |
| Settings | `settings/` (14 files) | Configuration UI, validation, localization |
| Navigation | `switcher/` (2 files) | Date-based file switching modals |

Test files (`.test.ts`) sit alongside their source files.

## 2. Types and Constants

The type system is small and centered on `Granularity` — the five time periods the plugin supports.

```bash
sed -n "1,35p" src/types.ts
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

`granularities` is ordered finest-to-coarsest. This ordering matters in the cache when comparing granularities or filtering finer ones.

`PeriodicConfig` holds per-granularity settings: whether it's enabled, its date format string, folder path, and optional template. Each of the five granularities gets its own `PeriodicConfig`.

Default formats and configs live in `constants.ts`:

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

Note the weekly format uses `gggg-[W]ww` — lowercase `gg` for locale-aware week-year (as opposed to ISO `GGGG`). Square brackets escape literal text in Moment.js format strings.

`HUMANIZE_FORMAT` provides human-readable date labels for month, quarter, and year granularities (used by `getRelativeDate()` in utils).

## 3. Plugin Entry Point

`main.ts` is where Obsidian loads the plugin. It extends `Plugin` and orchestrates all subsystems.

```bash
sed -n "1,30p" src/main.ts
```

```output
import type { Moment } from "moment";
import { addIcon, Plugin, type TFile } from "obsidian";
import { get, type Writable, writable } from "svelte/store";

import { type PeriodicNoteCachedMetadata, PeriodicNotesCache } from "./cache";
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
import { NLDNavigator } from "./switcher/switcher";
import { type Granularity, granularities } from "./types";
import {
  applyTemplateTransformations,
  getConfig,
```

```bash
sed -n "31,75p" src/main.ts
```

```output
  getFormat,
  getNoteCreationPath,
  getTemplateContents,
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

    this.addCommand({
      id: "show-date-switcher",
      name: "Show date switcher...",
      checkCallback: (checking: boolean) => {
        if (!this.app.plugins.getPlugin("nldates-obsidian")) {
          return false;
        }
```

Key points about `onload()`:

1. **Icons registered first** — five custom calendar SVGs (one per granularity)
2. **Settings are a Svelte writable store** — changes propagate reactively to the settings UI
3. **Locale configured once** — `initializeLocaleConfigOnce()` sets Moment.js locale from Obsidian's language setting and week-start preference
4. **Cache initialized** — `PeriodicNotesCache` begins watching vault events immediately
5. **Date switcher** requires the `nldates-obsidian` plugin; the command is hidden when that plugin isn't installed

The plugin exposes a public API used by other plugins and the switcher:

```bash
grep -n "^\s*\(public\|async\) \w" src/main.ts | grep -v "onload\|settings\|ribbonEl\|cache"
```

```output
128:  async loadSettings(): Promise<void> {
151:  public async createPeriodicNote(
174:  public getPeriodicNote(granularity: Granularity, date: Moment): TFile | null {
178:  public getPeriodicNotes(
190:  public isPeriodic(filePath: string, granularity?: Granularity): boolean {
194:  public findAdjacent(
201:  public findInCache(filePath: string): PeriodicNoteCachedMetadata | null {
205:  public async openPeriodicNote(
```

```bash
sed -n "151,240p" src/main.ts
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

The flow for opening a periodic note:

1. Look up existing file in cache by granularity + date
2. If not found, create it: format date → read template → apply transforms → write file
3. Open the file in a workspace leaf (optionally in a split pane)

`createPeriodicNote()` is the only place notes are created. The template pipeline is: `getTemplateContents()` → `applyTemplateTransformations()` → `vault.create()`. The cache auto-detects the new file via its vault event listeners.

## 4. Cache System

The cache is the most complex module. It maps vault files to periodic note metadata, handling three match strategies with different confidence levels.

```bash
sed -n "1,50p" src/cache.ts
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

`compareGranularity` uses the array index ordering from `granularities` — day (0) is "finer" than year (4). This is used when `getPeriodicNotes()` needs to include finer granularities.

`PeriodicNoteCachedMetadata` stores:
- **filePath** — vault-relative path
- **date** — parsed Moment.js date
- **granularity** — which period this note represents
- **canonicalDateStr** — ISO string for sorting
- **matchData** — how the file was matched (and whether the match is exact)

The cache extends Obsidian's `Component` to participate in the plugin lifecycle:

```bash
sed -n "52,110p" src/cache.ts
```

```output
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
```

```bash
sed -n "110,170p" src/cache.ts
```

```output
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
```

```bash
sed -n "170,260p" src/cache.ts
```

```output
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
sed -n "260,330p" src/cache.ts
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

### Cache resolution priority

The `resolve()` method tries three strategies in order:

1. **Frontmatter** — If a file has a frontmatter field matching a granularity name (e.g., `day: 2026-03-15`), it's an exact match. Frontmatter entries supersede filename matches and are never overwritten.
2. **Filename (strict)** — Parse the file's basename (or nested path) against the configured format string using `moment(input, format, true)` with strict mode. This is also an exact match.
3. **Filename (loose)** — Fall back to `getLooselyMatchedDate()` from the parser module. This uses regex patterns to extract dates from arbitrary filenames. These matches are marked `exact: false`.

### Auto-template application

When a file is created (`reason === "create"`) and its size is 0, the cache automatically applies the configured template. The `applyPeriodicTemplateToFile()` call is fire-and-forget with a `.catch()` that logs the error and shows a Notice. This prevents template failures from blocking cache resolution.

### Stale entry eviction

In `getPeriodicNote()`, if a cached file path no longer resolves to a `TFile` (e.g., the file was deleted), the stale entry is evicted and the loop continues checking remaining matches. This is an intentional design — not an early return.

### Adjacent navigation

`findAdjacent()` filters the cache to same-granularity entries, sorts by canonical date string (ISO format ensures chronological order), finds the current file's index, and returns the entry at `index ± 1`.

## 5. Parser

The parser provides regex-based loose date matching for filenames that don't follow the configured format.

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

The patterns are tried most-specific-first: full date → month → year. Each regex restricts to valid ranges (months 01-12, days 01-31). The optional `[-.]?` delimiter matches dashes, dots, or no separator, so `2026-03-15`, `2026.03.15`, and `20260315` all match.

**Concern:** There is no week-level pattern. Files like `2026-W12` won't be loosely matched — they require exact format matching through the cache's filename strategy. This is probably acceptable since ISO week formats are uncommon in freeform filenames, but it does mean week notes won't appear in the related files switcher if their format doesn't match.

## 6. Utilities

`utils.ts` contains the template transformation engine, path helpers, and date formatting utilities. It's the largest module.

### Template transformations

```bash
sed -n "1,30p" src/utils.ts
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
sed -n "47,130p" src/utils.ts
```

```output
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
```

```bash
sed -n "130,145p" src/utils.ts
```

```output
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
```

### Token replacement engine

`replaceGranularityTokens()` is the shared engine for template variable substitution. It handles tokens like:

- `{{date}}` — current date in the note's format
- `{{month+1m:YYYY-MM-DD}}` — a month-granularity token with a +1 month offset, formatted with the given Moment format
- `{{quarter-1q:YYYY}}` — a quarter token, one quarter back

The regex pattern `{{\\s*(token)\\s*(([-+]\\d+)([yqmwdhs]))?\\s*(:.+?)?}}` captures:
1. The token name (e.g., "date", "month", "quarter")
2. Optional time delta (e.g., "+1")
3. Delta unit (y/q/m/w/d/h/s)
4. Optional Moment format after a colon

**Important casing detail:** The regex uses the `gi` flag. Moment.js unit casing matters — `m` means minutes, `M` means months. The regex captures the unit character as-is from the template, preserving the author's casing. Template authors must use correct Moment.js units.

### Granularity-specific transforms

- **Day**: `{{yesterday}}`, `{{tomorrow}}`, plus `{{date|time}}` tokens
- **Week**: `{{sunday:format}}` through `{{saturday:format}}` — expands to the date of that weekday within the note's week
- **Month/Quarter/Year**: Uses `replaceGranularityTokens` with `startOfUnit` set to the granularity, so offsets are relative to the period start

### Path and config helpers

```bash
sed -n "145,210p" src/utils.ts
```

```output
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
```

```bash
sed -n "210,290p" src/utils.ts
```

```output
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
    const fromNow = window.moment(date).diff(thisWeek, "week");
    if (fromNow === 0) {
      return "This week";
    } else if (fromNow === -1) {
      return "Last week";
    } else if (fromNow === 1) {
      return "Next week";
    }
    return window.moment.duration(fromNow, granularity).humanize(true);
  } else if (granularity === "day") {
    const today = window.moment().startOf("day");
    const fromNow = window.moment(date).from(today);
```

```bash
sed -n "290,325p" src/utils.ts
```

```output
    const fromNow = window.moment(date).from(today);
    return window.moment(date).calendar(null, {
      lastWeek: "[Last] dddd",
      lastDay: "[Yesterday]",
      sameDay: "[Today]",
      nextDay: "[Tomorrow]",
      nextWeek: "dddd",
      sameElse: () => `[${fromNow}]`,
    });
  } else {
    return date.format(HUMANIZE_FORMAT[granularity]);
  }
}

export function isIsoFormat(format: string): boolean {
  const cleanFormat = removeEscapedCharacters(format);
  return /w{1,2}/.test(cleanFormat);
}

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
```

`getPossibleFormats()` handles nested format strings like `YYYY/YYYY-MM-DD`. It returns both the full format and the basename-only partial format (`YYYY-MM-DD`), so files that were moved out of their year folder still match.

`getRelativeDate()` produces human-readable labels:
- **Week**: "This week", "Last week", "Next week", or a duration ("in 3 weeks")
- **Day**: Uses Moment's `calendar()` for "Yesterday", "Today", "Tomorrow", "Last Monday", etc.
- **Month/Quarter/Year**: Formatted via `HUMANIZE_FORMAT` (e.g., "March 2026", "2026 1Q")

`isIsoFormat()` detects ISO week formats by checking for `w` tokens after stripping escaped characters.

## 7. Settings System

The settings system is the most file-heavy subsystem. It manages plugin configuration, validates user input, handles Moment.js locale configuration, and renders a Svelte 5 settings page.

### Settings data model

```bash
sed -n "1,40p" src/settings/index.ts
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
```

```bash
sed -n "40,60p" src/settings/index.ts
```

```output
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

The `Settings` interface is a flat object with optional `PeriodicConfig` entries per granularity. Missing entries mean that granularity is unconfigured.

**Concern:** `installedVersion` is hardcoded to `"1.0.0-beta3"` and never updated. This appears to be legacy code that doesn't serve any current purpose.

`PeriodicNotesSettingsTab` mounts a Svelte 5 component (`SettingsPage`) on `display()` and unmounts it on `hide()`. The settings store is passed as a prop for reactive two-way binding.

### Validation

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

Validation runs in real-time as users edit format strings in the settings UI.

**Format validation** has two levels:
- `validateFormat()` — checks for illegal filename characters and Moment.js round-trip parsability (day only)
- `validateFormatComplexity()` — detects two failure modes:
  - **loose-parsing** — the format can't round-trip through Moment.js (format → parse → compare)
  - **fragile-basename** — nested format like `YYYY/DD` where the basename alone doesn't contain all date components (m, d, y)

`getDateInput()` uses the complexity check to decide whether to parse just the basename or include parent path segments. For fragile formats like `YYYY/MM/DD`, it reconstructs the date from the path hierarchy.

### Localization

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
    const localeData = moment.localeData();
    window._bundledLocaleWeekSpec = {
      dow: localeData.firstDayOfWeek(),
      doy: localeData.firstDayOfYear(),
    };
  }

  if (weekStart === "locale") {
    moment.updateLocale(currentLocale, {
      week: window._bundledLocaleWeekSpec,
    });
  } else {
    moment.updateLocale(currentLocale, {
      week: {
        dow: Math.max(0, weekdays.indexOf(weekStart)),
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

The localization module bridges Obsidian's language settings with Moment.js's locale system.

**Private API usage:** `vault.getConfig()` is an undocumented Obsidian API. The plugin wraps it in try-catch and falls back to sensible defaults. The `langToMomentLocale` map handles Obsidian language codes that differ from Moment.js locale names (e.g., `"en"` → `"en-gb"`, `"cz"` → `"cs"`).

**Week start override:** `overrideGlobalMomentWeekStart()` mutates Moment.js's global locale data using `moment.updateLocale()`. It saves the original week spec on first call (`_bundledLocaleWeekSpec`) so it can be restored when the user switches back to "locale" default. The `Math.max(0, weekdays.indexOf(weekStart))` clamp prevents passing -1 for invalid values — an older version used `indexOf() || 0` which was a bug since -1 is truthy.

**Concern:** `moment.updateLocale()` mutates process-global state. Any other plugin using Moment.js will see the changed first day of week. This is by design (Obsidian expects plugins to honor the user's locale setting), but it makes testing tricky — tests need `afterEach` cleanup.

### Settings utilities

```bash
sed -n "1,80p" src/settings/utils.ts
```

```output
import type { App, DailyNotesPlugin } from "obsidian";
import { type Granularity, granularities } from "src/types";
import { get, type Updater, type Writable } from "svelte/store";
import type { Settings } from ".";

export const clearStartupNote: Updater<Settings> = (settings: Settings) => {
  for (const granularity of granularities) {
    const config = settings[granularity];
    if (config?.openAtStartup) {
      config.openAtStartup = false;
    }
  }
  return settings;
};

export function findStartupNoteConfig(
  settings: Writable<Settings>,
): Granularity | null {
  const s = get(settings);
  for (const granularity of granularities) {
    if (s[granularity]?.openAtStartup) {
      return granularity;
    }
  }
  return null;
}

export function getEnabledGranularities(settings: Settings): Granularity[] {
  return granularities.filter((g) => settings[g]?.enabled);
}

export function isDailyNotesPluginEnabled(app: App): boolean {
  return app.internalPlugins.getPluginById("daily-notes").enabled;
}

function getDailyNotesPlugin(app: App): DailyNotesPlugin | null {
  const installedPlugin = app.internalPlugins.getPluginById("daily-notes");
  if (installedPlugin) {
    return installedPlugin.instance as DailyNotesPlugin;
  }
  return null;
}

export function hasLegacyDailyNoteSettings(app: App): boolean {
  const options = getDailyNotesPlugin(app)?.options || {};
  return !!(options.format || options.folder || options.template);
}

export function disableDailyNotesPlugin(app: App): void {
  app.internalPlugins.getPluginById("daily-notes").disable(true);
}

export function getLocaleOptions() {
  const sysLocale = navigator.language?.toLowerCase();
  return [
    { label: `Same as system (${sysLocale})`, value: "system-default" },
    ...window.moment.locales().map((locale) => ({
      label: locale,
      value: locale,
    })),
  ];
}

export function getWeekStartOptions() {
  const weekdays = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ];
  const localizedWeekdays = window.moment.weekdays();
  const localeWeekStartNum = window._bundledLocaleWeekSpec.dow;
  const localeWeekStart = localizedWeekdays[localeWeekStartNum];
  return [
    { label: `Locale default (${localeWeekStart})`, value: "locale" },
    ...localizedWeekdays.map((day, i) => ({ value: weekdays[i], label: day })),
  ];
```

Key utilities:

- `clearStartupNote()` is a Svelte store updater that disables `openAtStartup` on all granularities — used to ensure only one granularity opens at startup
- `findStartupNoteConfig()` returns the first granularity with `openAtStartup: true`
- `getEnabledGranularities()` filters the five granularities to those the user has enabled
- Legacy daily notes detection (`isDailyNotesPluginEnabled`, `hasLegacyDailyNoteSettings`, `disableDailyNotesPlugin`) helps users migrate from Obsidian's built-in daily notes

## 8. Commands

The command system generates five commands per granularity dynamically.

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

Two navigation paradigms:

- **Jump** (`jumpToAdjacentNote`) — Navigate to the *nearest existing* note in the cache (forwards or backwards). Shows a Notice if there's no note in that direction.
- **Open** (`openAdjacentNote`) — Navigate to the *next/previous calendar period*, creating the note if it doesn't exist. Always succeeds.

All commands use `checkCallback` — they only appear in the command palette when the current granularity is enabled and (for jump/open adjacent) the active file is a periodic note of that granularity.

This generates 25 commands total (5 granularities × 5 commands each), plus the "Show date switcher" command registered in `main.ts`.

## 9. Date Switcher

The switcher is a modal dialog for navigating to periodic notes by typing natural language dates. It requires the `nldates-obsidian` plugin.

```bash
sed -n "1,60p" src/switcher/switcher.ts
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
      try {
        // @ts-expect-error this.chooser exists but is not exposed
        this.chooser.useSelectedItem(evt);
      } catch (e) {
        console.debug(
          "[Periodic Notes] chooser.useSelectedItem() unavailable",
          e,
        );
      }
    });

    this.scope.register([], "Tab", (evt: KeyboardEvent) => {
      const selected = this.getSelectedItem();
      if (!selected) return;
      evt.preventDefault();
      this.close();
      new RelatedFilesSwitcher(
        this.app,
        this.plugin,
```

```bash
sed -n "60,180p" src/switcher/switcher.ts
```

```output
        this.plugin,
        selected,
        this.inputEl.value,
      ).open();
    });
  }

  private getSelectedItem(): DateNavigationItem | undefined {
    try {
      // biome-ignore lint/suspicious/noExplicitAny: Obsidian API lacks type
      return (this as any).chooser.values[(this as any).chooser.selectedItem];
    } catch (e) {
      console.debug("[Periodic Notes] chooser selection unavailable", e);
      return undefined;
    }
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
```

```bash
sed -n "180,250p" src/switcher/switcher.ts
```

```output
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
```

```bash
sed -n "250,280p" src/switcher/switcher.ts
```

```output
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

The switcher provides three input modes:

1. **Relative keywords** ("next", "last", "this") — generates suggestions for all enabled granularities (e.g., "next Monday", "next week", "next month")
2. **Numeric offsets** ("3", "+3", "in 3") — generates forward and backward suggestions ("in 3 days", "3 days ago", "in 3 weeks", etc.)
3. **Freeform text** — delegates to the NLDates plugin for natural language parsing

Each suggestion is rendered with icons indicating whether the note exists (calendar icon) or would be created (file-plus icon). A `+N` badge shows how many loosely-matched related files exist for that period.

**Private API concern:** The switcher accesses `SuggestModal.chooser` which is not part of Obsidian's public API. This is wrapped in `@ts-expect-error` and try-catch with a debug log fallback.

**TODO noted in code:** Quarter suggestions are commented out, awaiting NLDates plugin support for quarter parsing.

Tab opens the `RelatedFilesSwitcher`, which shows all loosely-matched files for the selected period:

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

The related files switcher shows non-exact matches — files whose names contain a date matching the selected period but don't follow the configured format. Pressing `*` (Shift+8) toggles `includeFinerGranularities`, expanding the view to show daily notes within a selected month, etc.

Tab navigates back to the main date switcher, preserving the original query.

## 10. Svelte Settings UI

The settings page uses Svelte 5 runes (`$state`, `$props`, `$derived`) for reactivity. The main page renders a card per granularity, each with format, folder, template, and startup settings.

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

The settings page iterates over all five granularities, rendering a `PeriodicGroup` card for each. Localization settings (week start and locale) are vault-wide — they use `app.vault.setConfig()` to persist, affecting all plugins that use Moment.js.

**Private API concern:** `vault.setConfig()` is undocumented. This is the write counterpart to the `vault.getConfig()` calls in localization.ts.

## 11. Obsidian API Augmentations

The project extends Obsidian's type definitions to access undocumented APIs safely:

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

This declaration file merges additional types into the `obsidian` module. Key augmentations:

- **Custom workspace events** — `periodic-notes:settings-updated` and `periodic-notes:resolve` enable communication between the settings UI and cache
- **Vault config methods** — Type-safe wrappers for the undocumented `getConfig`/`setConfig` API
- **Internal plugins** — Access to Obsidian's built-in daily notes plugin for migration detection
- **NLDates plugin** — Types for the natural language dates plugin's `parseDate()` method

## 12. Build Configuration

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

Notable build decisions:

- **Output to project root** (`outDir: "."` with `emptyOutDir: false`) — Obsidian expects `main.js`, `styles.css`, and `manifest.json` in the plugin's root directory. Never change `emptyOutDir` to `true` or it will delete source files.
- **CommonJS format** — Obsidian's plugin loader requires CJS
- **External modules** — `obsidian`, `electron`, and Node builtins are provided by the Obsidian runtime
- **Svelte CSS** — `emitCss: false` prevents Svelte from generating separate CSS files; a custom plugin copies the hand-written `styles.css` instead
- **Source maps** — inline maps in dev mode, none in production

## 13. Test Architecture

```bash
grep -c "test(" src/*.test.ts src/**/*.test.ts 2>/dev/null | sed "s|src/||"
```

```output
cache.test.ts:25
parser.test.ts:11
utils.test.ts:63
settings/localization.test.ts:12
settings/utils.test.ts:11
settings/validation.test.ts:27
```

149 tests across 6 files. Tests use Bun's built-in test runner.

### The import isolation pattern

The project faces a testing challenge: most source modules import from `obsidian`, which isn't available at test time (Bun can't load the Obsidian runtime). Two strategies are used:

1. **Direct import** — Modules with no runtime `obsidian` imports (only `import type`) can be imported directly. This applies to `parser.ts`, `localization.ts`, `types.ts`, and `constants.ts`.

2. **Re-implementation** — Modules with runtime `obsidian` imports (`cache.ts`, `validation.ts`, `settings/utils.ts`) have their pure functions re-implemented in the test file. This is more fragile (implementations can drift) but avoids the import problem entirely.

All test files set up a global `window.moment` mock before importing:

```bash
sed -n "1,8p" src/parser.test.ts
```

```output
import { describe, expect, test } from "bun:test";
import moment from "moment";

import { getLooselyMatchedDate } from "./parser";

// @ts-expect-error global mock
globalThis.window = { moment };

```

The `@ts-expect-error` comment suppresses TypeScript's complaint about assigning to `window` — the test environment doesn't have Obsidian's full Window type.

## 14. Concerns and Observations

### Community standards adherence

**Good practices:**
- TypeScript strict mode with comprehensive type augmentations
- Biome for consistent formatting and import organization
- Svelte 5 runes (modern API, not legacy `$:` reactivity)
- Graceful degradation for private APIs (try-catch + fallback)
- Plugin follows Obsidian's plugin lifecycle conventions (`onload`, `onunload`, `Component`)
- Conventional commits and CI pipeline

**Areas of concern:**

1. **`installedVersion` hardcoded to `"1.0.0-beta3"`** — Dead code that doesn't track the actual version. Should be removed or wired to the real version.

2. **Private API surface** — Three undocumented APIs are used:
   - `vault.getConfig()` / `vault.setConfig()` — for locale settings
   - `SuggestModal.chooser` — for modal keyboard handling
   - `moment.localeData()._week` — for week spec access (now replaced with public API)
   
   All are wrapped in try-catch, which is the recommended pattern for Obsidian plugins using private APIs.

3. **Test re-implementation drift risk** — Functions re-implemented in test files could diverge from source. The walkthrough verification (`uvx showboat verify`) catches code block drift but doesn't catch logic drift in test re-implementations.

4. **No quarter support in NLDates** — Quarter navigation in the date switcher is commented out, awaiting upstream plugin support. Quarter notes can still be created and navigated via commands, just not via the switcher's natural language input.

5. **Global Moment.js mutation** — `moment.updateLocale()` affects all plugins. This is standard practice for Obsidian but worth noting for anyone debugging cross-plugin locale issues.

6. **Template error message** — `getTemplateContents()` logs "Failed to read the **daily** note template" regardless of which granularity failed. Minor copy issue.

