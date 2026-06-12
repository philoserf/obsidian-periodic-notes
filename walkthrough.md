# Obsidian Periodic Notes Walkthrough

*2026-06-12T16:26:52Z by Showboat 0.6.1*
<!-- showboat-id: 865e75f8-7a40-4c63-a9aa-c774f3b5cfdd -->

## Overview

Obsidian plugin that creates and manages daily, weekly, monthly, and yearly notes ("periodic notes"). Built with TypeScript and Vite; the sidebar calendar is the only Svelte 5 surface. Bun is the toolchain (install, test, build scripts).

The codebase is organized around a strict **pure/coupled split**:

- **Pure modules** (no `obsidian` import, directly testable with `bun test`): `format.ts`, `cacheResolve.ts`, `cacheIndex.ts`, `cacheSearch.ts`, `templateRender.ts`, `locale.ts`, plus `calendar/store.ts` and `calendar/utils.ts`.
- **Obsidian-coupled modules** (import `obsidian` at top level, cannot be imported in tests): `main.ts`, `cache.ts`, `template.ts`, `settings.ts`, `commands.ts`, `platform.ts`, `fileSuggest.ts`, and `calendar/view.ts`.

Each coupled module is a thin I/O shell around a pure core: `cache.ts` wires events into `cacheResolve.ts` + `cacheIndex.ts`; `template.ts` does vault reads/writes around `templateRender.ts`; `settings.ts` renders fields validated by `format.ts`.

```bash
ls src src/calendar
```

```output
src:
cache.test.ts
cache.ts
cacheIndex.test.ts
cacheIndex.ts
cacheResolve.test.ts
cacheResolve.ts
cacheSearch.test.ts
cacheSearch.ts
calendar
commands.ts
constants.ts
fileSuggest.ts
format.test.ts
format.ts
icons.ts
locale.ts
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

src/calendar:
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

The pure/coupled split is verifiable: these modules never mention the `obsidian` package, so Bun can import them without an Obsidian runtime.

```bash
grep -L '"obsidian"' src/*.ts | grep -v '.test.' | sort
```

```output
src/cacheIndex.ts
src/cacheResolve.ts
src/cacheSearch.ts
src/constants.ts
src/format.ts
src/icons.ts
src/locale.ts
src/templateRender.ts
src/types.ts
```

## Plugin entry — `src/main.ts`

`PeriodicNotesPlugin.onload()` is the composition root: it registers icons, loads settings, configures the moment locale (`src/locale.ts`), constructs the `NoteCache`, wires the settings tab, ribbon, commands, and registers the calendar view.

```bash
sed -n '36,57p' src/main.ts
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
```

The central user-facing operation is `openPeriodicNote`: a get-or-create. It asks the cache for an existing note (O(1) lookup) and only creates one — template and all — when nothing is indexed for that date.

```bash
sed -n '173,188p' src/main.ts
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
```

Locale configuration lives in its own pure module, `src/locale.ts`. It maps Obsidian's language setting to a moment locale (with a static lookup table for the mismatched codes like `en` → `en-gb`, `zh` → `zh-cn`) and prefers the system locale when it refines the Obsidian language.

```bash
sed -n '26,37p' src/locale.ts
```

```output
export function configureLocale(): void {
  const obsidianLang = localStorage.getItem("language") || "en";
  const systemLang = navigator.language?.toLowerCase();
  let momentLocale = langToMomentLocale[obsidianLang] ?? obsidianLang;
  if (systemLang?.startsWith(obsidianLang)) {
    momentLocale = systemLang;
  }
  const actual = window.moment.locale(momentLocale);
  console.debug(
    `[Periodic Notes] Configured locale: requested ${momentLocale}, got ${actual}`,
  );
}
```

## Settings shape — `src/types.ts`

The whole settings surface is one record: four granularities, each with the same `NoteConfig`. `CacheEntry` (also here) is the value type the cache system traffics in.

```bash
sed -n '3,22p' src/types.ts
```

```output
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

An empty `format` falls back to per-granularity defaults in `src/constants.ts` (week uses ISO week-year tokens `gggg-[W]ww`). There is **no settings migration**: `loadSettings` in `main.ts` merges saved data per-granularity over `DEFAULT_SETTINGS`; anything not matching the v2 shape is simply ignored.

```bash
sed -n '3,8p' src/constants.ts && echo '---' && sed -n '109,123p' src/main.ts
```

```output
export const DEFAULT_FORMAT: Record<Granularity, string> = {
  day: "YYYY-MM-DD",
  week: "gggg-[W]ww",
  month: "YYYY-MM",
  year: "YYYY",
};
---
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
```

### Settings tab — `src/settings.ts`

The tab uses the native Obsidian `Setting` API (no Svelte). Each granularity section is one toggle plus three text fields — Format, Folder, Template — all built through the `addValidatedTextSetting` helper, which centralizes the validate-on-change pattern: run the validator, swap the description for the error message, flag the field with `has-error`, then store the raw value and save (debounced).

```bash
sed -n '34,62p' src/settings.ts
```

```output
// How a validated periodic-note text field binds to settings: validate on
// change, show the error (or the default description), flag the field, then
// store the raw value and save.
function addValidatedTextSetting(
  containerEl: HTMLElement,
  opts: {
    name: string;
    defaultDesc: string;
    placeholder?: string;
    value: string;
    validate: (value: string) => string;
    onChange: (value: string) => void;
    attachSuggest?: (inputEl: HTMLInputElement) => void;
  },
): void {
  const setting = new Setting(containerEl)
    .setName(opts.name)
    .setDesc(opts.defaultDesc)
    .addText((text) => {
      if (opts.placeholder) text.setPlaceholder(opts.placeholder);
      text.setValue(opts.value).onChange((value) => {
        const error = opts.validate(value);
        setting.descEl.setText(error || opts.defaultDesc);
        setting.descEl.toggleClass("has-error", !!error);
        opts.onChange(value);
      });
      opts.attachSuggest?.(text.inputEl);
    });
}
```

A call site shows the shape: the Format field plugs in the pure `validateFormat` from `format.ts`; Folder and Template fields additionally attach autocomplete suggests from `fileSuggest.ts`.

```bash
sed -n '98,108p' src/settings.ts
```

```output
    addValidatedTextSetting(containerEl, {
      name: "Format",
      defaultDesc: "Moment.js date format string",
      placeholder: DEFAULT_FORMAT[granularity],
      value: config.format,
      validate: (value) => validateFormat(value, granularity),
      onChange: (value) => {
        this.plugin.settings.granularities[granularity].format = value;
        this.debouncedSave();
      },
    });
```

## Cache system

The cache answers "which file is the daily note for 2026-06-12?" without scanning the vault. It is layered:

- `src/cacheResolve.ts` — pure: decide whether one file *is* a periodic note (`resolveEntry`).
- `src/cacheIndex.ts` — pure: `CacheIndex` holds the dual index (`byPath`, `byKey`) plus a sorted-key cache per granularity.
- `src/cacheSearch.ts` — pure: `canonicalKey` and the `findAdjacentKey` binary search.
- `src/cache.ts` — Obsidian-coupled: `NoteCache` wires vault/metadata events into the above and fires the `periodic-notes:resolve` trigger.

### Pure resolve core — `resolveEntry`

`resolveEntry(file, settings, existing)` takes only plain data (`PathParts`, not `TFile`) and returns the `CacheEntry` to index, or `null`. Frontmatter matches win: a path already indexed via frontmatter is never downgraded to a filename match. Matching is strict — exact moment format with `true` strict parsing, scoped to the configured folder. No loose date-prefix matching.

```bash
sed -n '16,35p' src/cacheResolve.ts
```

```output
export function resolveEntry(
  file: PathParts,
  settings: Settings,
  existing: CacheEntry | null,
): CacheEntry | null {
  if (existing && existing.match === "frontmatter") return null;

  for (const granularity of getEnabledGranularities(settings)) {
    const folder = settings.granularities[granularity].folder || "/";
    if (!file.path.startsWith(folder === "/" ? "" : `${folder}/`)) continue;

    const formats = getPossibleFormats(settings, granularity);
    const dateInput = extractDateStringFromPath(file, formats[0], granularity);
    const date = window.moment(dateInput, formats, true);
    if (date.isValid()) {
      return { filePath: file.path, date, granularity, match: "filename" };
    }
  }
  return null;
}
```

`resolveEntry` calls `extractDateStringFromPath` in `src/format.ts` to choose what string to parse. For ordinary formats it's just the basename; for "fragile" nested formats (a `/` in the format whose basename alone lacks the year/month/day tokens, e.g. `YYYY/MM/DD`), it reconstructs the date string from the right number of trailing path segments. `PathParts` is a structural subset of `TFile` so this module stays importable in tests.

```bash
sed -n '109,129p' src/format.ts
```

```output
// Structural subset of TFile, so this module stays importable in tests.
export type PathParts = {
  path: string;
  basename: string;
  extension: string;
};

export function extractDateStringFromPath(
  file: PathParts,
  format: string,
  granularity: Granularity,
): string {
  if (validateFormatComplexity(format, granularity) === "fragile-basename") {
    const withoutExtension = file.path.slice(0, -(file.extension.length + 1));
    const strippedFormat = removeEscapedCharacters(format);
    const nestingLvl = (strippedFormat.match(/\//g)?.length ?? 0) + 1;
    const pathParts = withoutExtension.split("/");
    return pathParts.slice(-nestingLvl).join("/");
  }
  return file.basename;
}
```

### Keys and adjacency — `src/cacheSearch.ts`

Everything is keyed by `canonicalKey`: `granularity:ISO-timestamp-of-period-start`. Because the granularity prefix is constant within one sorted list and ISO timestamps sort lexicographically in chronological order, plain string sort *is* date sort — so finding the next/previous note is a binary search over sorted keys.

```bash
sed -n '5,27p' src/cacheSearch.ts
```

```output
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

### Dual index — `src/cacheIndex.ts`

`CacheIndex` maintains two maps over the same entries — `byPath` (filePath → entry, for "is this file periodic?") and `byKey` (canonicalKey → entry, for the O(1) `getPeriodicNote` lookup). `set()` keeps them coherent: if a path's date changed, the old key is deleted; if another file claimed the same key, that file is evicted from `byPath`. Granularities whose key set changed are marked dirty.

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

The dirty flags drive a lazily rebuilt sorted-key cache per granularity. `findAdjacent` is O(log n) while the cache is warm; the first call after a mutation pays an O(m log m) rebuild of just that granularity's keys (m = entries in one granularity).

```bash
sed -n '80,94p' src/cacheIndex.ts
```

```output
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
```

### Obsidian wiring — `NoteCache` in `src/cache.ts`

`NoteCache` is the coupled shell. After layout-ready it walks each configured folder once (overlapping folders are deduplicated via a shared `visited` set), then subscribes to vault `create`/`delete`/`rename`, metadata `changed` (frontmatter matches like `day: 2026-06-12`), and `periodic-notes:settings-updated` (full reset).

```bash
sed -n '31,56p' src/cache.ts
```

```output
    this.app.workspace.onLayoutReady(() => {
      console.info("[Periodic Notes] initializing cache");
      this.initialize();
      this.registerEvent(
        this.app.vault.on("create", (file) => {
          if (file instanceof TFile) void this.resolve(file, "create");
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

`NoteCache.resolve` is where pure core and side effects meet: delegate to `resolveEntry`, index the result, and — on the create path for an empty file — apply the configured template. The `periodic-notes:resolve` trigger fires **after** the entry is indexed and after template application, so listeners may read the file's contents.

```bash
sed -n '138,167p' src/cache.ts
```

```output
  // Runs synchronously through index.set and the trigger except on the
  // create-with-template path, where the trigger waits for the template.
  private async resolve(
    file: TFile,
    reason: "create" | "rename" | "initialize" = "create",
  ): Promise<void> {
    const settings = this.plugin.settings;
    const entry = resolveEntry(file, settings, this.index.get(file.path));
    if (!entry) return;

    this.index.set(entry);

    if (reason === "create" && file.stat.size === 0) {
      try {
        await applyTemplateToFile(this.app, file, settings, entry);
      } catch (err) {
        console.error("[Periodic Notes] failed to apply template", err);
        new Notice(
          `Periodic Notes: failed to apply template to "${file.path}". See console for details.`,
        );
      }
    }

    // Fires after template application, so listeners may read file contents.
    this.app.workspace.trigger(
      "periodic-notes:resolve",
      entry.granularity,
      file,
    );
  }
```

`getPeriodicNote` also self-heals: if the indexed path no longer resolves to a `TFile` in the vault, the stale entry is removed on read.

```bash
sed -n '169,179p' src/cache.ts
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
```

## Template rendering

Same split again: `src/templateRender.ts` (pure) does token replacement on a string; `src/template.ts` (coupled) reads template files from the vault and writes the rendered result. `applyTemplate` handles universal tokens (`{{date}}`, `{{time}}`, `{{title}}`), then per-granularity ones — daily notes get `{{yesterday}}`/`{{tomorrow}}` and offset/format calcs like `{{date +3d:GGGG}}`; weekly notes get weekday tokens like `{{monday:YYYY-MM-DD}}`.

```bash
sed -n '63,95p' src/templateRender.ts
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
```

The coupled side, `applyTemplateToFile`, is what `NoteCache.resolve` calls on the create path: read the template via the metadata cache, render with the entry's date and format, and overwrite the (empty) new file.

```bash
sed -n '29,49p' src/template.ts
```

```output
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

## Commands — `src/commands.ts`

`getCommands(app, plugin, granularity)` is a factory producing five commands per granularity: "Open <period> note" plus four navigation commands (jump to closest existing / open adjacent, in both directions). Navigation commands share a `navCommand` helper whose `checkCallback` only enables them when the active file is a periodic note of that granularity.

```bash
sed -n '88,116p' src/commands.ts
```

```output
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
```

The two navigation flavors differ in what "adjacent" means: `jumpToAdjacentNote` uses the cache's binary search to land on the closest *existing* note (Notice if none); `openAdjacentNote` adds one period to the current note's date and goes through `openPeriodicNote`, creating the note if needed. The same `showContextMenu` used by the ribbon right-click lists an "Open ..." item per enabled granularity.

## Calendar view — `src/calendar/`

Svelte 5 components mounted inside an Obsidian `ItemView`. The key design is the **reactivity bridge**: imperative Obsidian code talks *into* Svelte through functions exported from `Calendar.svelte` (`tick()`, `setActiveFilePath()`), and Svelte talks *out* through callback props (`onHover`, `onClick`, `onContextMenu`). No stores cross the boundary.

```bash
sed -n '46,59p' src/calendar/view.ts && echo '---' && sed -n '118,125p' src/calendar/view.ts
```

```output
  async onOpen(): Promise<void> {
    const fileStore = new CalendarStore(this, this.plugin);

    // svelte-check verifies Calendar.svelte's exports match this shape.
    this.calendar = mount(Calendar, {
      target: this.contentEl,
      props: {
        fileStore,
        onHover: this.onHover.bind(this),
        onClick: this.onClick.bind(this),
        onContextMenu: this.onContextMenu.bind(this),
      },
    }) as CalendarExports;
  }
---
  private onFileOpen(_file: TFile | null): void {
    if (!this.app.workspace.layoutReady) return;
    if (this.calendar) {
      const path = this.app.workspace.getActiveFile()?.path ?? null;
      this.calendar.setActiveFilePath(path);
      this.calendar.tick();
    }
  }
```

### CalendarStore — `src/calendar/calendarStore.svelte.ts`

The bridge from vault events to Svelte reactivity is a single `$state` version counter. Vault/metadata events bump it (filtered through `isPeriodic` where safe; unconditionally for delete/rename, since `NoteCache` has already dropped the entry by the time these fire). Reads go straight through to the plugin's cache.

```bash
sed -n '7,14p' src/calendar/calendarStore.svelte.ts && echo '---' && sed -n '45,56p' src/calendar/calendarStore.svelte.ts
```

```output
export default class CalendarStore {
  // Bumped on any vault/metadata event that may have changed the
  // periodic-note landscape. Consumers read this inside a $derived
  // or $effect to re-compute derived state (e.g., the FileMap).
  version = $state(0);
  private plugin: PeriodicNotesPlugin;

  constructor(component: Component, plugin: PeriodicNotesPlugin) {
---
  private bump(file?: TAbstractFile): void {
    if (file && !this.plugin.isPeriodic(file.path)) return;
    this.version++;
  }

  private bumpUnconditionally(): void {
    this.version++;
  }

  public getFile(date: Moment, granularity: Granularity): TFile | null {
    return this.plugin.getPeriodicNote(granularity, date);
  }
```

### FileMap pattern — `Calendar.svelte` + `store.ts`

Rather than each Day/Week cell querying the cache, `Calendar.svelte` derives one `FileMap` (`Map<canonicalKey, TFile | null>`) for the whole displayed grid. Both `fileMap` and `showWeeks` are `$derived.by` expressions that read `fileStore.version` first — a version bump invalidates the derived value and the map is recomputed. No `$effect`-with-assignment; it's all pull-based derivation.

```bash
sed -n '35,51p' src/calendar/Calendar.svelte
```

```output
  const month: Month = $derived(getMonth(displayedMonth.current));

  const showWeeks: boolean = $derived.by(() => {
    // Track fileStore.version so mutations re-derive.
    void fileStore.version;
    return fileStore.isGranularityEnabled("week");
  });

  const fileMap: FileMap = $derived.by(() => {
    // Track fileStore.version so mutations re-derive.
    void fileStore.version;
    return computeFileMap(
      month,
      (date, granularity) => fileStore.getFile(date, granularity),
      fileStore.getEnabledGranularities(),
    );
  });
```

`computeFileMap` (pure, in `src/calendar/store.ts`) walks the 6x7 month grid and keys every lookup by the same `canonicalKey` the cache uses — one shared vocabulary from index to UI.

```bash
sed -n '8,30p' src/calendar/store.ts
```

```output
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
```

Child components then do cheap `$derived` map lookups. `Day.svelte`'s entire data dependency is one line; CSS classes (`has-note`, `active`, `today`) fall out of it.

```bash
sed -n '29,31p' src/calendar/Day.svelte && echo '---' && sed -n '48,56p' src/calendar/Day.svelte
```

```output
  const displayedMonth = getContext<DisplayedMonth>(DISPLAYED_MONTH);

  let file = $derived(fileMap.get(canonicalKey("day", date)) ?? null);
---
<td>
  <div
    role="button"
    tabindex="0"
    class="day"
    class:active={file !== null && file.path === activeFilePath}
    class:adjacent-month={!date.isSame(displayedMonth.current, "month")}
    class:has-note={file !== null}
    class:today={date.isSame(today, "day")}
```

The displayed month is shared via Svelte context as a tiny `$state.raw` class (`displayedMonth.svelte.ts`), so `Nav` arrows and `Day` cells agree on which month is shown without prop drilling.

## Testing approach

Tests run under `bun test` with no Obsidian runtime. A bunfig preload supplies `window.moment` globally, mirroring what Obsidian provides at runtime — the single global the pure modules rely on.

```bash
cat bunfig.toml && echo '---' && cat src/test-preload.ts
```

```output
[test]
preload = ["./src/test-preload.ts"]
---
import moment from "moment";

// @ts-expect-error partial window mock for test environment
globalThis.window = { moment };
```

Pure modules are imported directly in their test files (`resolveEntry` is exercised with plain `{ path, basename, extension }` literals — no `TFile` needed). The coupled modules can't be imported at all; their behavior is covered indirectly: `cache.test.ts` pins the `CacheEntry` shape and key semantics via `cacheSearch`, and `template.test.ts` tests `templateRender.applyTemplate`. Test counts per file:

```bash
grep -cE '^\s*(test|it)\(' src/*.test.ts src/calendar/*.test.ts
```

```output
src/cache.test.ts:5
src/cacheIndex.test.ts:25
src/cacheResolve.test.ts:9
src/cacheSearch.test.ts:8
src/format.test.ts:24
src/template.test.ts:8
src/calendar/store.test.ts:5
src/calendar/utils.test.ts:10
```

## Recap

One idea repeats at every layer: keep the decision pure, keep the I/O thin.

- `resolveEntry` decides; `NoteCache` listens, indexes, and fires `periodic-notes:resolve` after the template has been applied.
- `applyTemplate` renders; `applyTemplateToFile` reads and writes the vault.
- `canonicalKey` is the shared vocabulary from `CacheIndex` all the way to `Day.svelte`'s `$derived` FileMap lookup.
- The calendar bridges worlds with the narrowest possible interfaces: a `$state` version counter inbound, callback props outbound.

