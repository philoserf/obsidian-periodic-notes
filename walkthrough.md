# Periodic Notes v2 Walkthrough

*2026-03-20T23:25:51Z by Showboat 0.6.1*
<!-- showboat-id: eaf5184d-a391-43d0-9611-4aed9a2299a3 -->

## Overview

Periodic Notes is an Obsidian plugin that creates and manages daily, weekly, monthly, and yearly notes. It provides a sidebar calendar view, command palette integration, and template-based note creation.

**Key technologies:** TypeScript, Svelte 5 (calendar only), Vite, Moment.js, Obsidian Plugin API

**Entry point:** `src/main.ts` — exports `PeriodicNotesPlugin`, the Obsidian `Plugin` subclass

## Architecture

The plugin is organized into focused modules:

- `src/main.ts` — Plugin lifecycle, settings load/save, ribbon, commands
- `src/cache.ts` — Dual-index cache for file-to-date resolution
- `src/template.ts` — Template reading and rendering
- `src/format.ts` — Pure functions: format helpers, validation, path utils
- `src/commands.ts` — Command factory + context menu
- `src/settings.ts` — Native Obsidian Setting API
- `src/constants.ts` — All constants
- `src/types.ts` — All shared types
- `src/platform.ts` — Platform detection (isMetaPressed)
- `src/calendar/` — Svelte 5 sidebar calendar (store, view, components)

## Types and Constants

```bash
cat src/types.ts
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

Four granularities, a flat `NoteConfig` per granularity, and `CacheEntry` for resolved files. Settings uses `Record<Granularity, NoteConfig>` — all four granularities always present.

```bash
sed -n '1,20p' src/constants.ts
```

```output
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
```

## Entry Point: Plugin Lifecycle

```bash
sed -n '70,110p' src/main.ts
```

```output
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

```

The plugin registers icons, loads settings (plain object, no Svelte store), configures locale from Obsidian's language, initializes the cache, settings tab, ribbon, commands, and calendar view. Settings loading is simple:

```bash
sed -n '148,158p' src/main.ts
```

```output
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
```

No migration — if saved data doesn't have the v2 shape, defaults are used. `saveSettings` triggers a workspace event that the cache and calendar store listen to.

## Cache: Dual-Index File Resolution

```bash
sed -n '26,86p' src/cache.ts
```

```output
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
```

`NoteCache` uses dual maps: `byPath` (filePath → CacheEntry) and `byKey` (canonicalKey → CacheEntry). The `canonicalKey` is `${granularity}:${date.startOf(granularity).toISOString()}` — granularity-aware and ISO-sortable. `getPeriodicNote` is O(1) via `byKey`:

```bash
sed -n '232,245p' src/cache.ts
```

```output

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

```

## Template Rendering

`template.ts` handles reading templates and replacing tokens. `applyTemplate` is pure (no obsidian deps beyond `window.moment`). Supports `{{date}}`, `{{title}}`, `{{yesterday}}`, `{{tomorrow}}`, weekday tokens (`{{monday:YYYY-MM-DD}}`), and granularity delta tokens.

```bash
sed -n '60,100p' src/template.ts
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
```

## Format Module (Pure, Testable)

`format.ts` has zero obsidian imports — every function can be imported directly in tests. Contains format helpers, validation, and path utilities.

```bash
sed -n '1,30p' src/format.ts
```

```output
import { DEFAULT_FORMAT } from "./constants";
import {
  type Granularity,
  granularities,
  type NoteConfig,
  type Settings,
} from "./types";

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
```

## Commands and Context Menu

`commands.ts` provides a command factory per granularity and the ribbon context menu (absorbed from the old `modal.ts`).

```bash
sed -n '20,38p' src/commands.ts
```

```output
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
```

## Native Settings UI

`settings.ts` uses Obsidian's `Setting` class. One section per granularity: enabled toggle, format, folder, template. No Svelte.

```bash
sed -n '49,75p' src/settings.ts
```

```output
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
        text
          .setPlaceholder(DEFAULT_FORMAT[granularity])
          .setValue(config.format)
          .onChange(async (value) => {
```

## Calendar View

The sidebar calendar is a Svelte 5 application mounted in an Obsidian `ItemView`. `CalendarView` mounts the component and communicates bidirectionally via exported functions (view→svelte) and callback props (svelte→view).

```bash
sed -n '46,62p' src/calendar/view.ts
```

```output
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

```bash
sed -n '10,30p' src/calendar/store.ts
```

```output
export default class CalendarStore {
  // Svelte 5 runes don't track store auto-subscriptions.
  // Bumping a counter triggers subscribers to re-read plugin state.
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
```

## Build Configuration

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

Vite builds to project root as CJS. `output.exports: "default"` means only the default export from `main.ts` is allowed — no named exports. Svelte plugin is still needed for calendar components. `emptyOutDir: false` is critical since the project root contains source.

## Concerns

1. **CalendarStore still uses Svelte stores** — The counter-bump `Writable<number>` pattern works but is a workaround for Svelte 5 runes not tracking store subscriptions. A full runes migration would simplify this.

2. **`template.ts` can't be imported in tests** — The module imports from `obsidian` at the top level, so the pure `applyTemplate` function can't be tested directly. Test files re-implement the function. Splitting the pure logic into a separate file would fix this.

3. **`isMetaPressed` lives in `platform.ts`** — A separate file for one function. This exists because `main.ts` can only have a default export (vite constraint) and `calendar/utils.ts` can't import from obsidian without breaking its tests. A Vite config change to allow named exports would let this move back to main.ts.

4. **No integration tests for cache resolution** — The cache is tested at the unit level (key generation, entry shape) but `resolve()` requires Obsidian's file system. Consider a thin mock layer for TFile.
