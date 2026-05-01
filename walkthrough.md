# Periodic Notes Walkthrough

*2026-05-01T22:13:10Z by Showboat 0.6.1*
<!-- showboat-id: 4c4aed65-1c1f-4583-8553-3878c37ee952 -->

## Overview

Periodic Notes is an [Obsidian](https://obsidian.md/) plugin that creates and manages daily, weekly, monthly, and yearly notes. It is a personal fork of [liamcain/obsidian-periodic-notes](https://github.com/liamcain/obsidian-periodic-notes), trimmed and modernized for one user's workflow.

The plugin has three responsibilities:

1. **Resolve** existing notes in the vault into a date-keyed cache, so any granularity/date pair can find its file in O(1).
2. **Create** new notes from a Moment.js format string, applying a user-configured template with token replacement.
3. **Surface** the result in the UI: ribbon icons, command palette, context menus, and a Svelte-driven calendar sidebar.

The codebase is intentionally split between **pure modules** (directly testable, no Obsidian import) and **Obsidian-coupled modules** (vault/metadata events, file I/O). This split is the most important architectural decision in the project — every module's testability falls out of which side of the line it sits on.

### Key technologies

- **TypeScript 6** with strict mode
- **Bun** as runtime, test runner, and bundler driver
- **Vite** for production builds (CommonJS output, `obsidian` external)
- **Svelte 5** with runes (`$state`, `$derived`, `$effect`) — only the calendar sidebar
- **Biome** for formatting and linting
- **Moment.js** (provided by Obsidian as `window.moment`) for date parsing and formatting

## Architecture

### Source layout

The `src/` directory mixes plain `.ts` modules with a `calendar/` subtree that holds the Svelte sidebar. Files ending in `.test.ts` are colocated with the modules they exercise.

```bash
ls src/ src/calendar/
```

```output
src/:
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

src/calendar/:
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

### Module boundaries

The pure/coupled split:

| Pure (testable, no Obsidian import) | Obsidian-coupled (cannot be imported in tests) |
|---|---|
| `format.ts` — format helpers, validation, path utils | `cache.ts` — vault/metadata event wiring |
| `cacheIndex.ts` — dual-index state with sorted-key cache | `template.ts` — file I/O, folder creation |
| `cacheSearch.ts` — `canonicalKey` and binary search | `settings.ts` — Obsidian `Setting` API tab |
| `templateRender.ts` — token replacement | `commands.ts` — command factory, `Menu` |
| `types.ts` — shared types | `main.ts` — `Plugin` lifecycle |
| `calendar/store.ts` — `computeFileMap` | `calendar/view.ts` — `ItemView` mount |
| `calendar/utils.ts` — month grid construction | `calendar/calendarStore.svelte.ts` — vault event subscription |

The rule is mechanical: a module is "pure" if and only if it does not import from `obsidian` at the top level. Tests live next to their target module and import it directly. Tests for coupled modules go through mocked seams or are skipped in favour of integration testing in Obsidian itself.

### Data flow

Obsidian vault events (`create`, `delete`, `rename`, `metadataCache.changed`) feed into `NoteCache.resolve`, which decides whether the file matches a configured granularity. Matches go into `CacheIndex` keyed both by file path and by canonical date key.

The opposite direction starts from a user action: `plugin.openPeriodicNote(granularity, date)` looks up the canonical key in `CacheIndex.getByKey`. On a hit, the existing file is opened in a workspace leaf. On a miss, `createPeriodicNote` reads the template, runs `applyTemplate` for token replacement, and calls `vault.create` — after which the create event re-enters the cache through `resolve`.

The calendar sidebar reads through the same plugin API (`plugin.getPeriodicNote`) and is invalidated by a `$state` version counter that gets bumped on any vault/metadata event.

## Entry point: `main.ts`

The plugin extends Obsidian's `Plugin` class. `onload` registers icons, loads settings, configures the Moment locale, instantiates the cache, wires up the settings tab, ribbon, and commands, and registers the calendar `ItemView`.

```bash
sed -n '68,110p' src/main.ts
```

```output
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
```

### `openPeriodicNote` — the hot path

This is the function the ribbon, commands, and calendar all funnel into. It performs a cache lookup, creates the file if missing, and opens the leaf. The whole body is wrapped in `try/catch` because there are many failure modes (template read, folder creation, vault collision) and a silent failure here is the worst possible UX.

```bash
sed -n '210,237p' src/main.ts
```

```output
  public async openPeriodicNote(
    granularity: Granularity,
    date: Moment,
    opts?: OpenOpts,
  ): Promise<void> {
    const { inNewSplit = false } = opts ?? {};
    const { workspace } = this.app;
    try {
      let file = this.cache.getPeriodicNote(granularity, date);
      if (!file) {
        file = await this.createPeriodicNote(granularity, date);
      }
      const leaf = inNewSplit
        ? workspace.getLeaf("split")
        : workspace.getLeaf();
      await leaf.openFile(file, { active: true });
    } catch (err) {
      const label = date.format(getFormat(this.settings, granularity));
      console.error(
        `[Periodic Notes] failed to open ${granularity} note "${label}"`,
        err,
      );
      new Notice(
        `Periodic Notes: failed to open ${granularity} note "${label}". See console for details.`,
      );
    }
  }
}
```

### Settings load — defensive merge

Settings are loaded by deep-merging saved data over `DEFAULT_SETTINGS`. There is **no migration path** — if the saved shape doesn't have a `granularities` key (e.g., from a pre-2.0 install), the user gets defaults. This is a deliberate choice for a single-user plugin: migration code is dead weight.

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

## The cache layer

The cache is the heart of the plugin and is split across three files. The split is deliberate: `cacheSearch.ts` is pure data manipulation, `cacheIndex.ts` is pure state, and `cache.ts` is the Obsidian-coupled shell.

### `cacheSearch.ts` — canonical keys and binary search

A canonical key is a `granularity:ISOString` pair, where the ISO string is normalized to the start of the granularity period. This is what makes O(1) lookups possible: `(day, 2026-05-01T14:33:00)` and `(day, 2026-05-01T08:00:00)` produce the same key.

```bash
cat src/cacheSearch.ts
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

The binary search is straightforward, but **only works because canonical keys sort lexicographically in chronological order** — that's why the format string is `granularity:ISOString` and not the more obvious `ISOString:granularity`. The granularity prefix is stripped at the call site by filtering on it.

### `cacheIndex.ts` — dual-index state

`CacheIndex` maintains three structures: `byPath` (filePath → entry, for O(1) rename/delete), `byKey` (canonicalKey → entry, for O(1) date lookup), and `sortedByGranularity` (sorted key array, for O(log n) adjacency). The sorted arrays use a dirty-flag pattern: invalidated on `set`/`remove`, rebuilt lazily on the next `findAdjacent`.

```bash
sed -n '6,33p' src/cacheIndex.ts
```

```output
export class CacheIndex {
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

The eviction logic in the middle is subtle: if a `set` collides on the canonical key with a different file (two files claiming to be `2026-05-01`'s daily note), the loser gets evicted from `byPath`. The dirty flag is only flipped when the *key set* actually changes — overwrites of an existing key don't invalidate the sorted array, since order is preserved.

### `cache.ts` — Obsidian-coupled shell

`NoteCache` extends `Component` to inherit Obsidian's lifecycle-managed event subscriptions. On `onLayoutReady` it walks every enabled granularity's folder tree, calls `resolve` on each file, and registers vault/metadata listeners.

```bash
sed -n '47,82p' src/cache.ts
```

```output
export class NoteCache extends Component {
  private index = new CacheIndex();

  constructor(
    readonly app: App,
    readonly plugin: PeriodicNotesPlugin,
  ) {
    super();

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
          if (file instanceof TFile) this.index.remove(file.path);
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

```

The `resolve` method tries to match a file in two ways: by parsing the filename against the configured Moment.js format(s), or by reading a frontmatter entry. **Frontmatter wins over filename** — once an entry is set as `match: "frontmatter"` it cannot be overwritten by a filename match.

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

The `reason === "create" && file.stat.size === 0` guard is what triggers template application: when Obsidian's "create new note" command produces an empty file in a managed folder, the plugin matches it as a periodic note and applies the configured template asynchronously. The fire-and-forget `.catch()` is intentional — `resolve` is called from a synchronous event handler.

## Format and validation

`format.ts` is the project's largest pure module. It owns format-string lookup, validation, and a few path helpers.

```bash
sed -n '92,113p' src/format.ts
```

```output
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

export function isIsoFormat(format: string): boolean {
  const cleanFormat = removeEscapedCharacters(format);
  return /w{1,2}/.test(cleanFormat);
}

```

The "fragile-basename" classification handles a real-world edge case: a daily note with format `YYYY/MM/DD-dddd` (folder-nested) where the basename alone (`05-Friday`) doesn't carry enough information to parse a date. In that case `getDateInput` (in `cache.ts`) reconstructs a path-suffix string from the file's actual location.

## Template rendering

`templateRender.ts` is the pure half of the template system: it takes a string and returns a string. All the I/O — reading the template file, writing to the new note — lives in `template.ts`.

The supported tokens are `{{date}}`, `{{time}}`, `{{title}}`, `{{yesterday}}`, `{{tomorrow}}`, `{{date+Nd:format}}` (and similar `{{month}}`/`{{year}}` arithmetic), and `{{<weekday>:format}}` for weekly notes.

```bash
sed -n '6,14p' src/templateRender.ts
```

```output
const DATE_TIME_TOKEN =
  /{{\s*(date|time)\s*(([-+]\d+)([ymwdhs]))?\s*(:.+?)?}}/gi;
const MONTH_TOKEN = /{{\s*(month)\s*(([-+]\d+)([ymwdhs]))?\s*(:.+?)?}}/gi;
const YEAR_TOKEN = /{{\s*(year)\s*(([-+]\d+)([ymwdhs]))?\s*(:.+?)?}}/gi;
const WEEKDAY_TOKEN = new RegExp(
  `{{\\s*(${WEEKDAYS.join("|")})\\s*:(.*?)}}`,
  "gi",
);

```

`replaceGranularityTokens` is the workhorse. It snaps `date` to the start of the relevant unit, then patches in the *current* hour/minute/second from `now` — so a token in a daily-note template references "today at the moment of creation," not midnight.

```bash
sed -n '32,61p' src/templateRender.ts
```

```output
function replaceGranularityTokens(
  contents: string,
  date: Moment,
  pattern: RegExp,
  format: string,
  startOfUnit?: Granularity,
): string {
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
```

## Commands

`commands.ts` builds five commands per granularity (open present, jump-next, jump-prev, open-next, open-prev) plus one "show calendar" command in `main.ts`. The `navCommand` helper extracts the shared `checkCallback` boilerplate so each call site only has to specify ID, name, and run-action.

```bash
sed -n '81,133p' src/commands.ts
```

```output
export function getCommands(
  app: App,
  plugin: PeriodicNotesPlugin,
  granularity: Granularity,
): Command[] {
  const label = granularityLabels[granularity];

  const navCommand = (id: string, name: string, run: () => void): Command => ({
    id,
    name,
    checkCallback: (checking: boolean) => {
      if (!plugin.settings.granularities[granularity].enabled) return false;
      const activeFile = app.workspace.getActiveFile();
      if (checking) {
        if (!activeFile) return false;
        return plugin.isPeriodic(activeFile.path, granularity);
      }
      run();
    },
  });

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
    navCommand(
      `next-${label.periodicity}-note`,
      `Jump forwards to closest ${label.periodicity} note`,
      () => jumpToAdjacentNote(app, plugin, "forwards"),
    ),
    navCommand(
      `prev-${label.periodicity}-note`,
      `Jump backwards to closest ${label.periodicity} note`,
      () => jumpToAdjacentNote(app, plugin, "backwards"),
    ),
    navCommand(
      `open-next-${label.periodicity}-note`,
      `Open next ${label.periodicity} note`,
      () => openAdjacentNote(app, plugin, "forwards"),
    ),
    navCommand(
      `open-prev-${label.periodicity}-note`,
      `Open previous ${label.periodicity} note`,
      () => openAdjacentNote(app, plugin, "backwards"),
    ),
  ];
}
```

The two flavours of "navigate":

- **`jumpToAdjacentNote`** — walks the cache to find the nearest *existing* periodic note in the chosen direction. Uses `findAdjacent` (binary search over sorted keys).
- **`openAdjacentNote`** — opens the note for the *adjacent date* (today + 1 day, etc.), creating it if missing.

Both require an active periodic file as their starting point; `checkCallback` returns false if the active file isn't periodic, so the commands grey out in the palette.

## The calendar sidebar

The calendar is the only Svelte 5 surface in the project. It is mounted into an Obsidian `ItemView` via the imperative `mount()` API.

### `view.ts` — the mount point

`CalendarView` extends `ItemView`. On `onOpen` it constructs a `CalendarStore` (the reactivity bridge) and mounts the `Calendar.svelte` root component, passing event handlers as props. The mounted component's exported `tick()` and `setActiveFilePath()` functions are stored so the view can drive them on Obsidian events.

```bash
sed -n '46,63p' src/calendar/view.ts
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

The runtime `if (!("tick" in cal ...))` check is a workaround for the fact that Svelte 5's `mount()` returns `unknown` exports — the type system can't prove the component exposes the named functions. Issue #155 in the project's tracker is about removing this once a better Svelte typing exists.

### `calendarStore.svelte.ts` — the reactivity bridge

The store is a single `$state(0)` version counter. Vault and metadata events bump it; consumers (the calendar's `$effect`) read it to re-derive state. This is the "treat the world as a version number" pattern — coarser than fine-grained signals but trivially correct.

```bash
sed -n '11,53p' src/calendar/calendarStore.svelte.ts
```

```output
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
  }

```

The split between `bump` (filtered) and `bumpUnconditionally` is load-bearing. For `delete`/`rename`, `NoteCache` has already removed the entry from the index by the time the calendar store runs, so `isPeriodic` returns false and the filter would skip the event. The comment in the source explains why: bump unconditionally and rely on `getPeriodicNote` to self-heal stale paths.

### `Calendar.svelte` — the FileMap pattern

The root Svelte component pre-computes a `Map<string, TFile | null>` (a `FileMap`) once per render, keyed by canonical key. Child components do `$derived` lookups against this map instead of subscribing to the store individually. This collapses what would otherwise be ~50 store subscriptions per month down to one.

```bash
sed -n '36,52p' src/calendar/Calendar.svelte
```

```output
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
```

`computeFileMap` itself (in `calendar/store.ts`) is pure — it takes the month grid, a `getFile` callback, and a list of enabled granularities, and emits a flat map. Pure means directly testable with a mocked `getFile`.

```bash
cat src/calendar/store.ts
```

```output
import type { Moment } from "moment";
import type { TFile } from "obsidian";
import { canonicalKey } from "src/cacheSearch";
import type { Granularity } from "src/types";

import type { FileMap, Month } from "./types";

export function computeFileMap(
  month: Month,
  getFile: (date: Moment, granularity: Granularity) => TFile | null,
  enabledGranularities: Granularity[],
): FileMap {
  const map: FileMap = new Map();
  const displayedMonth = month[1].days[0];

  for (const week of month) {
    for (const day of week.days) {
      map.set(canonicalKey("day", day), getFile(day, "day"));
    }
    if (enabledGranularities.includes("week")) {
      const weekStart = week.days[0];
      map.set(canonicalKey("week", weekStart), getFile(weekStart, "week"));
    }
  }

  if (enabledGranularities.includes("month")) {
    map.set(
      canonicalKey("month", displayedMonth),
      getFile(displayedMonth, "month"),
    );
  }
  if (enabledGranularities.includes("year")) {
    map.set(
      canonicalKey("year", displayedMonth),
      getFile(displayedMonth, "year"),
    );
  }

  return map;
}
```

The `month[1]` index is intentional: a month grid is six weeks (always 42 days, padded with leading/trailing days from adjacent months), and `month[1].days[0]` is reliably inside the displayed month — never the previous month's tail. This is the "displayed month" used to key month/year notes.

### Settings UI

`settings.ts` uses the native Obsidian `Setting` API (no Svelte) with a debounced save, surfacing live validation error text in the description element of each setting row.

```bash
sed -n '53,113p' src/settings.ts
```

```output
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
            const error = validateFormat(value, granularity);
            formatSetting.descEl.setText(
              error || "Moment.js date format string",
            );
            formatSetting.descEl.toggleClass("has-error", !!error);
            this.plugin.settings.granularities[granularity].format = value;
            this.debouncedSave();
          });
      });

    const folderSetting = new Setting(containerEl)
      .setName("Folder")
      .addText((text) => {
        text.setValue(config.folder).onChange(async (value) => {
          const warning = validateFolder(this.app, value);
          folderSetting.descEl.setText(warning || "");
          folderSetting.descEl.toggleClass("has-error", !!warning);
          this.plugin.settings.granularities[granularity].folder = value;
          this.debouncedSave();
        });
        new FolderSuggest(this.app, text.inputEl);
      });

    const templateSetting = new Setting(containerEl)
      .setName("Template")
      .addText((text) => {
        text.setValue(config.templatePath ?? "").onChange(async (value) => {
          const error = validateTemplate(this.app, value);
          templateSetting.descEl.setText(error || "");
          templateSetting.descEl.toggleClass("has-error", !!error);
          this.plugin.settings.granularities[granularity].templatePath =
            value || undefined;
          this.debouncedSave();
        });
        new FileSuggest(this.app, text.inputEl);
      });
  }
}
```

## Build and test

The build is Vite producing CommonJS output, with `obsidian` and node built-ins marked external. Output goes to the project root (`outDir: "."`) so `main.js` and `manifest.json` sit alongside `package.json` — that's the layout Obsidian expects in `.obsidian/plugins/<id>/`.

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

The custom `copy-styles` plugin is needed because `emitCss: false` (set on the Svelte plugin) means Svelte component CSS is inlined, but the plugin still needs a `styles.css` for non-Svelte styles. The plugin copies `src/styles.css` to the project root after each build.

### Tests

Tests use Bun's native test runner. The `bunfig.toml` preload sets up `window.moment` globally so pure modules can run without a DOM. Test files are colocated with their target modules. The project has seven test files containing this many `test`/`it` calls:

```bash
grep -hcE '^\s*(test|it)\(' src/*.test.ts src/calendar/*.test.ts | awk '{s+=$1} END {print s}'
```

```output
82
```

These 82 tests cover all the pure modules: `format`, `cacheIndex`, `cacheSearch`, `templateRender`, `cache` (limited surface, mocked), `template` (limited), `calendar/store`, `calendar/utils`. The Obsidian-coupled glue in `cache.ts`, `commands.ts`, and `view.ts` is verified by hand in Obsidian.

### Deploy

The `deploy` script copies the three artifacts (`main.js`, `manifest.json`, `styles.css`) into a vault's plugin directory, with the destination read from `.env.local`.

```bash
cat deploy.ts
```

```output
import { $ } from "bun";

const dest = process.env.OBSIDIAN_DEPLOY_DEST;
if (!dest) {
  console.error("OBSIDIAN_DEPLOY_DEST not set — see .env.local");
  process.exit(1);
}

await $`cp main.js manifest.json styles.css ${dest}`;
console.log(`Deployed to ${dest}`);
```

## Concerns

A linear walkthrough should also flag what's brittle, opinionated, or worth revisiting. The open issues tracker (`gh issue list`) is the primary source for tech-debt items the maintainer has already acknowledged.

### Acknowledged in the issue tracker

- **#150** — `openAdjacentNote` is `async` but doesn't `await` the inner `openPeriodicNote`. Errors are swallowed. Easy fix.
- **#148** — `periodic-notes:resolve` fires before the template is applied (the `applyTemplateToFile` call is fire-and-forget). Subscribers see an empty file. Fixing requires either deferring the event or chaining it onto the template promise.
- **#156** — `CacheIndex` memory scales linearly with vault size. For most users (thousands of periodic notes max) this is fine; flagged for users with very large vaults.
- **#155** — Runtime check for `Calendar.svelte` exports is a Svelte 5 typing workaround.
- **#154** — Locale configuration in `main.ts` could move to `src/locale.ts` for testability.
- **#153** — Calendar code mixes `$effect` with assignment; `$derived` would be more idiomatic.
- **#152** — Speculative `TFolder` cycle guard (`visited` set in `cache.ts:initialize`) was added defensively; the Obsidian vault tree doesn't actually have cycles.
- **#151** — `getDateInput` could move to `format.ts` to keep `cache.ts` thinner.
- **#149** — Settings tab has duplicated validated-text helper boilerplate.
- **#147** — `resolveEntry` could be extracted as a pure function for direct testing.

### Further observations

- **No `unload`/`onunload` override** — `main.ts` doesn't override `onunload`, relying on Obsidian's `Plugin` base class to dispose of `Component` children. The cache's `Component` registration handles its own cleanup, but if a future change adds non-`Component` resources, they'll leak silently.

- **The `getPossibleFormats` fallback** — when format includes `/`, the function returns `[fullFormat, partialFormat]` so Moment will try matching the basename alone first. This silently masks user format-string typos: a misconfigured format with a stray `/` will sometimes "work" by accident.

- **Single-user assumptions baked in** — the README explicitly says "you probably shouldn't install this." That's accurate. Decisions like dropping migration paths (`loadSettings` resets to defaults on shape mismatch), hard-coded English fallbacks in `langToMomentLocale`, and the deploy script's reliance on the maintainer's vault layout all reflect "I am the only user" rather than "general-purpose plugin." Reading the code with that frame is essential — many "code smells" are intentional simplifications.

- **No CSS scoping for the calendar** — `Calendar.svelte`'s `<style>` block uses CSS custom properties (`--color-text-day` etc.) on a wrapper class. Svelte scopes these per-component, but child components inherit through CSS variables only — the styling architecture is implicit and non-obvious to a reader.

- **`registerView` cleanup** — `CalendarView.onClose` unmounts the Svelte component, but doesn't null out `this.calendar`. If `onClose` and `onFileOpen` ever interleave, `setActiveFilePath` could be called on a torn-down component. Probably never happens in practice; not defensively handled.

