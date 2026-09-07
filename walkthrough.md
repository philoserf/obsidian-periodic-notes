# Obsidian Periodic Notes Walkthrough

*2026-09-07T12:11:50Z by Showboat 0.6.1*
<!-- showboat-id: a3141461-4242-4629-8e33-1a32710f38cb -->

## Overview

An Obsidian plugin that creates and manages **daily, weekly, monthly and yearly
notes**. It contributes three surfaces to the app:

- **Ribbon icons** — one per enabled granularity, opening that period's note.
- **Commands** — open the current note for a granularity, and jump forwards or
  backwards to the nearest existing one.
- **A sidebar calendar** — a Svelte 5 month grid showing which periods already
  have notes, which one is open, and today.

Underneath all three sits a **cache**: an in-memory index mapping each period to
the file that represents it, so "is there a note for this date?" is an O(1)
lookup rather than a vault scan.

Built with TypeScript, Svelte 5 (calendar only), Vite, and Bun for tests. The
build emits a single CommonJS `main.js` at the repo root, which is tracked in git
because that is the artifact Obsidian loads.

```bash
ls src src/calendar
```

```output
src:
cache.ts
cacheFrontmatter.test.ts
cacheFrontmatter.ts
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
locale.test.ts
locale.ts
main.ts
obsidian.d.ts
paths.test.ts
paths.ts
platform.ts
settings.ts
settingsLoad.test.ts
settingsLoad.ts
styles.css
template.test.ts
template.ts
templateRender.ts
test-preload.ts
types.ts

src/calendar:
Calendar.svelte
calendarStore.svelte.ts
CLAUDE.md
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

## Architecture: the pure/impure split

The single organising principle in this codebase is a line drawn between modules
that import Obsidian's runtime and modules that do not.

Obsidian is not installable as a test dependency — it is the host application,
available only inside the running app. A module that imports a *value* from it
(`Plugin`, `TFile`, `Notice`, `normalizePath`) therefore **cannot be imported by
a test at all**. Type-only imports are erased at compile time and cost nothing.

So the interesting logic is deliberately pushed out of the Obsidian-facing
modules into pure ones that take plain data and injected callbacks, leaving the
wiring thin. Every core/wiring pairing in the tree exists for this reason:

| Obsidian-facing (untestable) | Pure core (tested) | What was extracted |
| --- | --- | --- |
| `cache.ts` | `cacheResolve.ts` | does this filename parse as a periodic note? |
| `cache.ts` | `cacheFrontmatter.ts` | does this frontmatter claim a date? |
| `cache.ts` | `cacheIndex.ts` + `cacheSearch.ts` | the index and its key scheme |
| `main.ts` | `settingsLoad.ts` | validating whatever JSON was on disk |
| `main.ts`, `settings.ts`, `template.ts` | `paths.ts` | vault-relative path arithmetic |
| `template.ts` | `templateRender.ts` | token substitution |
| `Calendar.svelte` | `calendar/store.ts` | building the month's file map |

The test files are the ledger of which side each module ended up on — a module
has a test if and only if it is importable:

```bash
ls src/*.test.ts src/calendar/*.test.ts
```

```output
src/cacheFrontmatter.test.ts
src/cacheIndex.test.ts
src/cacheResolve.test.ts
src/cacheSearch.test.ts
src/calendar/store.test.ts
src/calendar/utils.test.ts
src/format.test.ts
src/locale.test.ts
src/paths.test.ts
src/settingsLoad.test.ts
src/template.test.ts
```

Everything else — `main.ts`, `cache.ts`, `template.ts`, `settings.ts`,
`commands.ts`, `platform.ts`, `calendar/view.ts` and the `.svelte` components —
reaches for Obsidian's runtime and is verified by hand in a real vault.

`window.moment` is the other host global. Obsidian exposes a single moment
instance to every plugin, and tests get it from a Bun preload:

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

One name in that list is misleading: `template.test.ts` tests `templateRender.ts`,
not `template.ts`. The file kept its original name when the pure core was split
out from under it.

## Shared vocabulary — `src/types.ts`

Four types carry the whole plugin. A `Granularity` is one of four periods, and
`granularities` fixes their canonical order — every enumeration in the codebase
iterates that array rather than writing its own literal, so adding a fifth period
would be a one-line change here.

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

`CacheEntry.match` is the field to watch. It records *why* a file counts as a
periodic note — because its filename parses as a date, or because its frontmatter
says so — and that distinction decides several conflicts later on: which entry
wins a collision, whether a rename re-resolves, and whether a file that loses its
frontmatter falls back to filename matching.

The defaults are deliberately inert. Every granularity ships **disabled** with an
empty format, so a freshly installed plugin does nothing until configured, and an
empty `format` means "use `DEFAULT_FORMAT`" rather than "no format":

```bash
sed -n '/^export const DEFAULT_FORMAT/,/^};/p;/^export const DEFAULT_CONFIG/,/^};/p' src/constants.ts
```

```output
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
```

## Plugin entry — `src/main.ts`

`onload` is what Obsidian calls when the plugin is enabled. It registers icons,
loads settings, applies the locale, builds the cache, and contributes the
ribbon, commands and calendar view.

```bash
sed -n '/^  async onload/,/^  }$/p' src/main.ts
```

```output
  async onload(): Promise<void> {
    addIcon("calendar-day", calendarDayIcon);
    addIcon("calendar-week", calendarWeekIcon);
    addIcon("calendar-month", calendarMonthIcon);
    addIcon("calendar-year", calendarYearIcon);

    await this.loadSettings();
    // moment's locale is global to the app, so put it back on unload.
    this.register(configureLocale());

    // addChild, not a bare field: Component.registerEvent only arranges teardown
    // during the component's own unload, and nothing else would ever unload the
    // cache. Without this its five vault listeners survive a disable, and a
    // disabled plugin goes on applying templates to newly created files.
    this.cache = this.addChild(new NoteCache(this.app, this));

    this.addSettingTab(new SettingsTab(this.app, this));

    this.configureRibbonIcons();
    for (const granularity of granularities) {
      getCommands(this.app, this, granularity).forEach(
        this.addCommand.bind(this),
      );
    }

    this.registerView(
      VIEW_TYPE_CALENDAR,
      (leaf) => new CalendarView(leaf, this),
    );

    this.addCommand({
      id: "show-calendar",
      name: "Show calendar",
      // No checkCallback: gating on "no leaf exists yet" made the command
      // disappear from the palette the moment one did, which is exactly when
      // the user wants it — the sidebar is collapsed and they are reaching for
      // the command to show it. Revealing an existing leaf is the obvious
      // thing, and matches how Obsidian's own sidebar commands behave.
      callback: () => {
        void (async () => {
          const { workspace } = this.app;
          const existing = workspace.getLeavesOfType(VIEW_TYPE_CALENDAR)[0];
          const leaf = existing ?? workspace.getRightLeaf(false);
          if (!leaf) return;
          // Awaited, unlike before: a view that fails to construct was an
          // unhandled rejection with no Notice, and revealing the leaf before
          // it has a view shows an empty pane.
          if (!existing) {
            await leaf.setViewState({ type: VIEW_TYPE_CALENDAR });
          }
          await workspace.revealLeaf(leaf);
        })().catch((err) => {
          console.error("[Periodic Notes] failed to show the calendar", err);
          new Notice(
            "Periodic Notes: failed to show the calendar. See console for details.",
          );
        });
      },
    });
  }
```

Two lines there carry more weight than they look.

`this.register(configureLocale())` — `moment.locale()` is a **global setter on
the single moment instance Obsidian hands every plugin**. Setting it without
restoring it silently reconfigures date formatting for the entire app, and
outlives the plugin being disabled. `configureLocale` therefore returns its own
undo function, and `register` runs it on unload.

`this.cache = this.addChild(new NoteCache(...))` — `addChild`, not a bare field
assignment. `Component.registerEvent` only arranges teardown during the
component's *own* unload, and nothing else would ever unload the cache. Without
`addChild`, its five vault listeners survive a disable — and a disabled plugin
goes on applying templates to newly created files.

The locale logic itself splits along the usual line: a pure mapping function, and
the effect that applies it.

```bash
sed -n '/^export function resolveMomentLocale/,/^}/p;/^export function configureLocale/,/^}/p' src/locale.ts
```

```output
export function resolveMomentLocale(
  obsidianLang: string,
  systemLang: string | undefined,
): string {
  if (systemLang?.startsWith(obsidianLang)) return systemLang;
  return langToMomentLocale[obsidianLang] ?? obsidianLang;
}
export function configureLocale(): () => void {
  const previous = window.moment.locale();
  const obsidianLang = localStorage.getItem("language") || "en";
  const momentLocale = resolveMomentLocale(
    obsidianLang,
    navigator.language?.toLowerCase(),
  );
  const actual = window.moment.locale(momentLocale);
  console.debug(
    `[Periodic Notes] Configured locale: requested ${momentLocale}, got ${actual}`,
  );
  return () => {
    window.moment.locale(previous);
  };
}
```

### Loading settings — `src/settingsLoad.ts`

`loadData()` returns whatever plain JSON was last written to disk, which may be
from an older version, hand-edited, or corrupt. There is no migration: rather
than trusting a saved sub-object wholesale, every field is type-checked
individually and falls back to its own default.

```bash
sed -n '/^export function sanitizeSettings/,/^}/p' src/settingsLoad.ts
```

```output
export function sanitizeSettings(
  saved: unknown,
  normalizeFolder: (folder: string) => string,
): Settings {
  const settings = structuredClone(DEFAULT_SETTINGS);
  if (!isRecord(saved) || !isRecord(saved.granularities)) return settings;

  for (const granularity of granularities) {
    const savedConfig = saved.granularities[granularity];
    if (!isRecord(savedConfig)) continue;
    settings.granularities[granularity] = sanitizeConfig(
      savedConfig,
      settings.granularities[granularity],
      normalizeFolder,
    );
  }
  return settings;
}
```

`normalizeFolder` is injected rather than imported — it wraps Obsidian's
`normalizePath`, and taking it as a parameter is what keeps this module testable.

The per-field pass is where the vault boundary is enforced. A saved `format` or
`folder` that would escape the vault is refused and the default kept:

```bash
sed -n '/^function sanitizeConfig/,/^}/p' src/settingsLoad.ts
```

```output
function sanitizeConfig(
  saved: UnknownRecord,
  defaults: NoteConfig,
  normalizeFolder: (folder: string) => string,
): NoteConfig {
  const config: NoteConfig = { ...defaults };

  if (typeof saved.enabled === "boolean") config.enabled = saved.enabled;

  if (
    typeof saved.format === "string" &&
    !hasDotDotSegment(literalizeFormat(saved.format))
  ) {
    config.format = saved.format;
  }

  if (typeof saved.folder === "string") {
    const folder = normalizeFolder(saved.folder);
    if (!hasDotDotSegment(folder)) config.folder = folder;
  }

  if (typeof saved.templatePath === "string") {
    config.templatePath = saved.templatePath;
  }

  return config;
}
```

Formats are deliberately *not* round-tripped through moment here. `loadSettings`
runs before `configureLocale`, so parsing under the wrong locale could reject a
working format and silently reset it on upgrade. Only values that would escape
the vault are refused.

### Path arithmetic — `src/paths.ts`

The escape check is shared with the settings tab and with note creation, so it
lives in its own module with no Obsidian import.

```bash
sed -n '/^const SEPARATOR/,/^}/p' src/paths.ts
```

```output
const SEPARATOR = /[\\/]/;

/** True when any segment of a path is exactly "..". */
export function hasDotDotSegment(path: string): boolean {
  return path.split(SEPARATOR).some((segment) => segment === "..");
}
```

`SEPARATOR` matches a backslash as well as a slash, and that is load-bearing.
Obsidian's `normalizePath` converts backslashes to slashes — so checking only
`/` would let `..\..\x` through as a single innocent-looking segment, and
`normalizePath` would turn it back into a traversal afterwards.

`buildNotePath` is the last line of defence, immediately before
`vault.createFolder` and `vault.create`. It throws rather than returning a path
that leaves the vault:

```bash
sed -n '/^export function buildNotePath/,/^}/p' src/paths.ts
```

```output
export function buildNotePath(folder: string, filenameWithExt: string): string {
  const segments = `${folder}/${filenameWithExt}`
    .split(SEPARATOR)
    .filter((segment) => segment !== "" && segment !== ".");
  if (segments.includes("..")) {
    throw new Error(
      `Refusing to create a note outside the vault: "${folder}/${filenameWithExt}"`,
    );
  }
  return segments.join("/");
}
```

### The settings tab — `src/settings.ts`

The tab uses Obsidian's native `Setting` API; there is no Svelte outside the
calendar. Its one real idea is that **validation has two severities**:

```bash
sed -n '/^type Validation/,/^const reject/p' src/settings.ts
```

```output
type Validation = { error: string; blocking: boolean };

const valid: Validation = { error: "", blocking: false };
const warn = (error: string): Validation => ({ error, blocking: false });
const reject = (error: string): Validation => ({ error, blocking: true });
```

A `blocking` value is never written to `plugin.settings` — it would corrupt note
resolution or escape the vault. Everything else is advisory: the field shows a
warning but still persists, so a folder that does not exist yet can be configured
ahead of the note that will create it.

```bash
sed -n '/^function validateFolder/,/^}/p' src/settings.ts
```

```output
function validateFolder(app: App, folder: string): Validation {
  if (!folder || folder === "/") return valid;
  const normalized = normalizePath(folder);
  if (hasDotDotSegment(normalized)) {
    return reject("Folder would place notes outside the vault");
  }
  if (hasDotOnlySegment(normalized)) {
    return reject("Folder segments cannot be only dots");
  }
  // getAbstractFileByPath returns a TFile just as happily as a TFolder, so a
  // bare truthiness check reports a file sitting where the folder should be as
  // perfectly fine — and the problem only surfaces later, as a folder-collision
  // error at note creation, far from the field that caused it. A file in the
  // way is not a traversal risk, so this warns rather than blocking.
  const existing = app.vault.getAbstractFileByPath(normalized);
  if (!existing) return warn("Folder not found in vault");
  if (!(existing instanceof TFolder)) {
    return warn("That path is a file, not a folder");
  }
  return valid;
}
```

Validation runs per keystroke, which creates a subtle problem: the value on the
way to a rejected one may itself be acceptable. Typing `../escape` passes through
`.`, which is valid-looking. So blocking a value is not enough — leaving the
field on a rejected value also restores whatever was stored when the edit began:

```bash
sed -n '117,134p' src/settings.ts
```

```output
      text.inputEl.addEventListener("focus", () => {
        beforeEdit = stored;
      });

      text.inputEl.addEventListener("blur", () => {
        const typed = normalize(text.inputEl.value);
        if (describe(typed)) {
          // Abandoned on a rejected value: undo the whole edit, not just the
          // last keystroke.
          stored = beforeEdit;
          opts.onChange(beforeEdit);
          text.setValue(beforeEdit);
          describe(beforeEdit);
        } else if (text.inputEl.value !== stored) {
          // Show the canonical form of what was actually stored.
          text.setValue(stored);
        }
      });
```

## The cache

This is the heart of the plugin. Three questions have to be O(1) or near it,
because the calendar asks them fifty times per rendered month:

- Is there a note for *this* period? — `getPeriodicNote`
- Is *this file* a periodic note? — `find`
- What is the next or previous note in this granularity? — `findAdjacent`

### The key scheme — `src/cacheSearch.ts`

Every period collapses to one string, and `startOf(granularity)` is what makes
any date within a period produce the same key.

```bash
sed -n '/^export function canonicalKey/,/^}/p' src/cacheSearch.ts
```

```output
export function canonicalKey(granularity: Granularity, date: Moment): string {
  // Moment.toISOString() returns null for an invalid moment, which the template
  // literal would turn into the string "null" — so every invalid date for a
  // granularity would alias to one key and silently collide. Callers holding a
  // date they did not validate should check isValid() first; reaching here with
  // one is a bug, not a runtime condition.
  if (!date.isValid()) {
    throw new Error(
      `Cannot build a ${granularity} cache key from an invalid date`,
    );
  }
  return `${granularity}:${date.clone().startOf(granularity).toISOString()}`;
}
```

The guard is not defensive padding. `Moment.toISOString()` returns **null** for an
invalid moment, and the template literal would render that as the string `"null"`
— so every invalid date within a granularity would alias to the single key
`day:null` and silently collide with every other one.

Keys are ISO timestamps behind a granularity prefix, which means **lexical sort
order is chronological order**. That is what lets adjacency be a binary search
over a plain sorted array of strings:

```bash
sed -n '/^export function findAdjacentKey/,/^}/p' src/cacheSearch.ts
```

```output
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

### The dual index — `src/cacheIndex.ts`

Two maps over the same entries. `byPath` answers "is this file periodic?";
`byKey` answers "is there a note for this period?". Keeping both in step through
every mutation is most of what this class does.

Because `byKey` holds **one file per key**, two notes claiming the same period is
a real conflict that has to be resolved deterministically — the vault walk order
that used to decide it varied between runs.

```bash
sed -n '/^function preferred/,/^}/p' src/cacheIndex.ts
```

```output
function preferred(a: CacheEntry, b: CacheEntry): CacheEntry {
  if (a.match !== b.match) return a.match === "frontmatter" ? a : b;
  return a.filePath <= b.filePath ? a : b;
}
```

Frontmatter beats a filename because it is an explicit statement about the note's
date, where a filename merely happens to parse. Failing that, the smaller path
wins — arbitrary, but stable.

`set` returns **whichever entry now holds the key**, which is not always the one
passed in. Callers need to know they lost:

```bash
sed -n '/^  set(entry: CacheEntry)/,/^  }$/p' src/cacheIndex.ts
```

```output
  set(entry: CacheEntry): CacheEntry {
    const newKey = canonicalKey(entry.granularity, entry.date);
    const oldByPath = this.byPath.get(entry.filePath);
    if (oldByPath) {
      const oldKey = canonicalKey(oldByPath.granularity, oldByPath.date);
      if (oldKey !== newKey) {
        this.byKey.delete(oldKey);
        this.dirtyGranularities.add(oldByPath.granularity);
        // This is the other way a winner stops claiming a key: not removed,
        // but re-dated by a frontmatter edit. The key is just as free as it is
        // after remove(), so a contender has to be offered it here too.
        this.promote(oldKey);
      }
    }

    // Unconditional, and before the collision check below: a prior entry for
    // this path may have been a loser, which never reaches byPath, so the
    // oldByPath cleanup above cannot have found it.
    this.dropContender(entry.filePath);

    const incumbent = this.byKey.get(newKey);
    if (incumbent && incumbent.filePath !== entry.filePath) {
      const winner = preferred(incumbent, entry);
      const loser = winner === incumbent ? entry : incumbent;
      console.warn(
        `[Periodic Notes] "${winner.filePath}" and "${loser.filePath}" are both ${entry.granularity} notes for the same date (${newKey}); indexing "${winner.filePath}" and ignoring "${loser.filePath}"`,
      );
      // The loser is not a periodic note as far as the rest of the plugin is
      // concerned: byPath backs get and findAdjacent, so leaving it there would
      // report a note the calendar and nav commands cannot act on. It is kept
      // as a contender instead, so freeing the key brings it back.
      this.byPath.delete(loser.filePath);
      this.addContender(newKey, loser);
      if (winner === incumbent) return incumbent;
    }

    const isNewKey = !this.byKey.has(newKey);
    this.byPath.set(entry.filePath, entry);
    this.byKey.set(newKey, entry);
    if (isNewKey) {
      this.dirtyGranularities.add(entry.granularity);
    }
    return entry;
  }
```

Note the loser is dropped from `byPath` too, not just `byKey`. `byPath` backs
`get`, `has` and `findAdjacent`, so leaving the loser there would report a note
the calendar and the nav commands cannot actually act on.

Sorted key arrays are cached per granularity and invalidated by a dirty set, so
`findAdjacent` is a binary search when warm and a sort when cold:

```bash
sed -n '/^  private getSortedKeys/,/^  }$/p' src/cacheIndex.ts
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

### The two matchers

A file becomes a periodic note one of two ways.

**By filename** — `cacheResolve.ts` walks the enabled granularities, checks the
file is inside that granularity's configured folder, and asks moment to parse the
name strictly against the configured format.

```bash
sed -n '/^export function resolveEntry/,/^}/p' src/cacheResolve.ts
```

```output
export function resolveEntry(
  file: PathParts,
  settings: Settings,
  existing: CacheEntry | null,
): CacheEntry | null {
  if (existing && existing.match === "frontmatter") return null;

  for (const granularity of getEnabledGranularities(settings)) {
    const folder = settings.granularities[granularity].folder;
    if (!isInFolder(file.path, folder)) continue;

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

The first line is the interesting one: **a path already matched by frontmatter is
never re-resolved by filename.** An explicit date property outranks a name that
happens to parse, and this is where that precedence is enforced.

**By frontmatter** — `cacheFrontmatter.ts` reads a property named after the
granularity (`day:`, `week:`, …). The reader is injected, so this stays testable
while the caller supplies Obsidian's `parseFrontMatterEntry`.

```bash
sed -n '/^export function resolveFrontmatterEntry/,/^}/p' src/cacheFrontmatter.ts
```

```output
export function resolveFrontmatterEntry(
  filePath: string,
  settings: Settings,
  read: (granularity: Granularity) => unknown,
): CacheEntry | null {
  for (const granularity of getEnabledGranularities(settings)) {
    const folder = settings.granularities[granularity].folder;
    if (!isInFolder(filePath, folder)) continue;

    const raw = read(granularity);
    if (raw === undefined || raw === null || raw === "") continue;

    const dateString = asDateString(raw);
    if (dateString === null) {
      refuse(filePath, granularity, raw, "is not a date value");
      continue;
    }

    const format = getFormat(settings, granularity);
    const date = window.moment(dateString, format, true);
    if (!date.isValid()) {
      refuse(filePath, granularity, raw, `does not parse as "${format}"`);
      continue;
    }

    return { filePath, date, granularity, match: "frontmatter" };
  }
  return null;
}
```

Two decisions worth pausing on.

**Every enabled granularity is tried, and a bad value is reported rather than
taken as the answer.** A file carrying `day: junk` alongside `week: 2026-W37` is
still indexed as a week note.

**YAML types are coerced before parsing.** A strict `typeof === "string"` check
would reject the values users actually write — YAML reads `year: 2026` as a
number and `day: [2026-09-07]` as a list:

```bash
sed -n '/^function asDateString/,/^}/p' src/cacheFrontmatter.ts
```

```output
function asDateString(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (Array.isArray(value) && value.length === 1) return asDateString(value[0]);
  return null;
}
```

### Obsidian wiring — `NoteCache` in `src/cache.ts`

`NoteCache` extends `Component`, which is what makes its listeners tear down when
the plugin is disabled. Wiring lives in `onload` rather than the constructor, so
it happens only for a component that was actually loaded.

```bash
sed -n '/^  onload(): void {/,/^  }$/p' src/cache.ts
```

```output
  onload(): void {
    this.app.workspace.onLayoutReady(() => {
      console.info("[Periodic Notes] initializing cache");
      this.initialize();
      this.registerEvent(
        this.app.vault.on("create", (file) => {
          if (file instanceof TFile) void this.resolve(file, true);
        }),
      );
      this.registerEvent(
        this.app.vault.on("delete", (file) => {
          if (file instanceof TFile) this.index.remove(file.path);
        }),
      );
      this.registerEvent(this.app.vault.on("rename", this.onRename, this));
      this.registerEvent(
        this.app.metadataCache.on("changed", (file, _data, cache) =>
          this.resolveFrontmatter(file, cache),
        ),
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

`initialize()` walks each enabled granularity's folder, offering every file to
both matchers. Folders are visited at most once across granularities — with day
notes in `/` and weekly notes in `daily/`, the shared subtree is walked once.

The `resolve` path is where the ordering subtleties live:

```bash
sed -n '/^  private async resolve(/,/^  }$/p' src/cache.ts
```

```output
  private async resolve(file: TFile, isCreate: boolean): Promise<void> {
    const settings = this.plugin.settings;
    const entry = resolveEntry(file, settings, this.index.get(file.path));
    if (!entry) return;

    // A canonical-key collision can leave this file unindexed in favour of
    // another note for the same date. Nothing downstream should be told the
    // file resolved when it did not.
    if (this.index.set(entry).filePath !== file.path) return;

    if (isCreate && file.stat.size === 0) {
      try {
        await applyTemplateToFile(this.app, file, settings, entry);
      } catch (err) {
        console.error("[Periodic Notes] failed to apply template", err);
        new Notice(
          `Periodic Notes: failed to apply template to "${file.path}". See console for details.`,
        );
      }

      // index.set above was synchronous, but the delete and rename handlers
      // run on this same file while the template write is suspended. Telling
      // listeners a file resolved when it has since been deleted, or binding
      // the pre-rename granularity to a post-rename file, is worse than
      // staying quiet: the handler that moved the file has already reindexed
      // it, and will announce it itself.
      if (!this.index.get(entry.filePath)) return; // deleted mid-write
      if (this.app.vault.getAbstractFileByPath(entry.filePath) !== file) {
        return; // renamed mid-write
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

Three guards, each protecting a different consumer:

1. **`index.set(entry).filePath !== file.path`** — this file lost a collision, so
   it is not indexed. Firing `periodic-notes:resolve` for it would announce a
   note the cache cannot find.
2. **`await` splits the function.** `index.set` ran synchronously, but the delete
   and rename handlers can run on this same file while the template write is
   suspended. Both post-await checks refuse to announce a file that moved.
3. **The trigger fires last**, after the template has been applied — so listeners
   may safely read the file's contents.

Renames need their own handler because a frontmatter match must survive one:

```bash
sed -n '/^  private onRename/,/^  }$/p' src/cache.ts
```

```output
  private onRename(file: TAbstractFile, oldPath: string): void {
    if (!(file instanceof TFile)) return;

    const previous = this.index.get(oldPath);
    this.index.remove(oldPath);

    // A frontmatter match survives a rename — the property that made the file
    // periodic did not move. Re-resolving cannot preserve it: resolveEntry is
    // handed the entry for the *new* path, which does not exist yet, so it
    // would silently fall back to filename matching and drop the note.
    if (previous?.match === "frontmatter") {
      this.index.set({ ...previous, filePath: file.path });
      this.app.workspace.trigger(
        "periodic-notes:resolve",
        previous.granularity,
        file,
      );
      return;
    }

    void this.resolve(file, false);
  }
```

Re-resolving cannot preserve it. `resolveEntry` would be handed the entry for the
*new* path, which does not exist yet, so it would fall back to filename matching
and silently drop a note whose date property never moved.

The mirror case is a frontmatter property being edited away. Nothing else would
drop it — `resolveEntry` refuses to re-resolve a frontmatter-matched path — so
`resolveFrontmatter` removes the entry and offers the file to filename matching:

```bash
sed -n '/^  private resolveFrontmatter/,/^  }$/p' src/cache.ts
```

```output
  private resolveFrontmatter(file: TFile, cache: CachedMetadata): void {
    const entry = resolveFrontmatterEntry(
      file.path,
      this.plugin.settings,
      (granularity) => parseFrontMatterEntry(cache.frontmatter, granularity),
    );

    if (entry) {
      this.index.set(entry);
      return;
    }

    // The property that produced a frontmatter entry can be edited away, and
    // nothing else drops it: resolveEntry refuses to re-resolve a path already
    // matched by frontmatter. Remove it here, then offer the file to filename
    // matching — stripping frontmatter from a note whose name still parses
    // should leave it periodic.
    const existing = this.index.get(file.path);
    if (existing?.match === "frontmatter") {
      this.index.remove(file.path);
      void this.resolve(file, false);
    }
  }
```

### Every read path self-heals

An index can outlive the file it points at — one missed or out-of-order delete
event is enough. Rather than trusting the index, every public read resolves its
entry against the vault and drops it if the file is gone. The cache repairs
itself no matter which method the caller reached for.

```bash
sed -n '/^  private fileFor/,/^  }$/p;/^  private verify/,/^  }$/p;/^  public findAdjacent/,/^  }$/p' src/cache.ts
```

```output
  private fileFor(entry: CacheEntry | null): TFile | null {
    if (!entry) return null;
    const file = this.app.vault.getAbstractFileByPath(entry.filePath);
    if (file instanceof TFile) return file;
    this.index.remove(entry.filePath);
    return null;
  }
  private verify(entry: CacheEntry | null): CacheEntry | null {
    return this.fileFor(entry) ? entry : null;
  }
  public findAdjacent(
    filePath: string,
    direction: "forwards" | "backwards",
  ): CacheEntry | null {
    // A stale neighbour must not end the search: the note after it may well
    // exist, and returning null here is how "jump forwards" fails silently.
    // Each miss removes one entry, which dirties the sorted keys, so the next
    // pass sees a shorter list and the loop terminates.
    for (;;) {
      const entry = this.index.findAdjacent(filePath, direction);
      if (!entry) return null;
      const verified = this.verify(entry);
      if (verified) return verified;
    }
  }
```

`findAdjacent` needs the loop rather than a single check: a stale neighbour must
not end the search, since the note after it may well exist — returning null there
is how "jump forwards" fails silently. Each miss removes one entry, which dirties
the sorted keys, so the next pass sees a shorter list and the loop terminates.

## Template rendering

`templateRender.ts` is pure string work. `applyTemplate` substitutes the simple
tokens first, then hands the granularity-specific ones to a shared replacer.

```bash
sed -n '/^export function applyTemplate/,/^}/p' src/templateRender.ts
```

```output
export function applyTemplate(
  filename: string,
  granularity: Granularity,
  date: Moment,
  format: string,
  rawTemplateContents: string,
): string {
  // Replacer functions, not strings: a string replacement reads "$&", "$`",
  // "$\'", "$1"-"$9" and "$$" as patterns, and `filename` comes from the user's
  // date format, which may legitimately contain "$".
  let contents = rawTemplateContents
    .replace(/{{\s*date\s*}}/gi, () => filename)
    .replace(/{{\s*time\s*}}/gi, () => window.moment().format("HH:mm"))
    .replace(/{{\s*title\s*}}/gi, () => filename);

  if (granularity === "day") {
    contents = contents
      .replace(/{{\s*yesterday\s*}}/gi, () =>
        date.clone().subtract(1, "day").format(format),
      )
      .replace(/{{\s*tomorrow\s*}}/gi, () =>
        date.clone().add(1, "d").format(format),
      );
    contents = replaceGranularityTokens(
      contents,
      date,
      DATE_TIME_TOKEN,
      format,
    );
  }

  if (granularity === "week") {
    contents = contents.replace(WEEKDAY_TOKEN, (_, dayOfWeek, momentFormat) => {
      // WEEKDAYS is Sunday-first but .weekday() counts from the locale's
      // first day, so the name's position has to be rotated back by it. The
      // token regex is built from WEEKDAYS, so indexOf cannot miss.
      const day =
        (WEEKDAYS.indexOf(dayOfWeek.toLowerCase()) -
          window.moment.localeData().firstDayOfWeek() +
          7) %
        7;
      // .weekday() mutates and returns the same instance. `date` may be the
      // Moment held by a CacheEntry, whose canonical key would then no longer
      // match the key it is indexed under.
      return date.clone().weekday(day).format(momentFormat.trim());
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

Three hazards are handled in that one function, and all three are the kind that
only show up with unusual user input:

- **Replacer functions, not replacement strings.** A string replacement reads
  `$&`, `` $` ``, `$'`, `$1`–`$9` and `$$` as patterns — and `filename` comes from
  the user's own date format, which may legitimately contain a `$`.
- **`.clone()` before `.weekday()`.** `weekday` mutates and returns the same
  instance, and `date` may be the very Moment held by a `CacheEntry` — mutating it
  would leave the entry indexed under a key it no longer matches.
- **Case-sensitive unit aliases.** In moment, `M` is month and `m` is minute. The
  token patterns are case-insensitive so `{{Month}}` works, which means a
  lowercase `m` arrives indistinguishable from an uppercase one:

```bash
sed -n '/      if (calc) {/,/      }$/p' src/templateRender.ts
```

```output
      if (calc) {
        // Moment's unit aliases are case-sensitive exactly where it hurts:
        // "M" is month, "m" is minute. The token patterns are case-insensitive
        // so that {{Month}} works, which means a lowercase "m" arrives
        // indistinguishable from an uppercase one. A month or year token has
        // no meaningful minute delta, so read it as months there; a date/time
        // token keeps moment's own reading, where {{date-30m}} really does
        // mean thirty minutes.
        const resolvedUnit = startOfUnit && unit === "m" ? "M" : unit;
        periodStart.add(parseInt(timeDelta, 10), resolvedUnit);
      }
```

A month or year token has no meaningful minute delta, so it reads as months
there; a date or time token keeps moment's own reading, where `{{date-30m}}`
really does mean thirty minutes.

`template.ts` is the Obsidian-facing half — reading the template file and writing
the result. Its one subtlety is the same clone, for the same reason:

```bash
sed -n '/^export async function applyTemplateToFile/,/^}/p' src/template.ts
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
    // The index holds this entry by reference, so the cached Moment never
    // crosses into rendering code — a token that mutates its argument would
    // otherwise corrupt the key the entry is indexed under.
    entry.date.clone(),
    format,
    templateContents,
  );
  // The caller checked the file was empty before awaiting readTemplate above,
  // so anything Obsidian Sync, another plugin or an external editor wrote in
  // the meantime would be destroyed by an unconditional modify. process runs
  // the transform under the vault's own lock, which closes the window rather
  // than narrowing it — and content arriving is a reason to leave the file
  // alone, not an error: a note that already says something does not want a
  // template stamped over it.
  await app.vault.process(file, (data) => (data === "" ? rendered : data));
}
```

## Creating a note — `main.ts`

`createPeriodicNote` is **get-or-create**: returning a note that already exists is
the right answer for every caller, all of which are opening it.

```bash
sed -n '/^  public async createPeriodicNote/,/^  }$/p' src/main.ts
```

```output
  public async createPeriodicNote(
    granularity: Granularity,
    date: Moment,
  ): Promise<TFile> {
    const config = this.settings.granularities[granularity];
    const format = getFormat(this.settings, granularity);
    const filename = date.format(format);
    const destPath = await getNoteCreationPath(this.app, filename, config);

    // Covers a note created since the caller checked the cache — by a second
    // click, by another device, or outside Obsidian entirely.
    const existing = this.app.vault.getAbstractFileByPath(destPath);
    if (existing instanceof TFile) return existing;

    const inFlight = this.creating.get(destPath);
    if (inFlight) return inFlight;

    const creation = this.writeNote(
      destPath,
      filename,
      granularity,
      date,
      config,
      format,
    ).finally(() => this.creating.delete(destPath));
    this.creating.set(destPath, creation);
    return creation;
  }
```

Two races, two different answers.

The **existence check** covers a note created since the caller looked at the
cache — by a second click, by another device syncing, or outside Obsidian
entirely.

The **`creating` map** covers two callers racing for the same *new* path. The
index only learns of a file from the vault's `create` event, so both see a cache
miss; without single-flighting, the second reaches `vault.create` and throws for
a note that was created perfectly well.

```bash
sed -n '46,50p' src/main.ts
```

```output
  // Creations in progress, keyed by destination path. The index only learns of
  // a file from the vault's "create" event, so two callers racing to open the
  // same note both see a cache miss; without this the second reaches
  // vault.create and throws for a note that was created correctly.
  private creating = new Map<string, Promise<TFile>>();
```

### Not rescanning the vault on every keystroke

Settings saves are debounced per keystroke burst across three text fields, and a
`periodic-notes:settings-updated` trigger makes `NoteCache.reset()` re-walk every
configured folder and re-parse every filename. Firing that on each debounce tick
meant a full vault scan per typing pause — including for fields the index never
reads. Only three fields actually affect indexing:

```bash
sed -n '/^  private indexingSnapshotOf/,/^  }$/p;/^  public async saveSettings/,/^  }$/p' src/main.ts
```

```output
  private indexingSnapshotOf(settings: Settings): string {
    return JSON.stringify(
      granularities.map((g) => {
        const { enabled, format, folder } = settings.granularities[g];
        return [enabled, format, folder];
      }),
    );
  }
  public async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.configureRibbonIcons();

    // NoteCache.reset() re-walks every configured folder and re-parses every
    // filename, so firing this on each debounce tick meant a full vault scan
    // per typing pause — including for fields the index never reads.
    const snapshot = this.indexingSnapshotOf(this.settings);
    if (snapshot !== this.indexingSnapshot) {
      this.indexingSnapshot = snapshot;
      this.app.workspace.trigger("periodic-notes:settings-updated");
    }
  }
```

So editing a template path saves and re-renders the ribbon, but never touches the
cache.

The ribbon is rebuilt on the same principle — only the Enabled toggle can change
what it shows, so everything else returns early. That early return is also what
bounds `addRibbonIcon`'s own per-call unload registration, which `detach()` does
not undo:

```bash
sed -n '/^  private configureRibbonIcons/,/^  }$/p' src/main.ts
```

```output
  private configureRibbonIcons(): void {
    const enabled = getEnabledGranularities(this.settings);
    const key = enabled.join(",");
    // saveSettings calls this on every save, and saves are debounced per
    // keystroke burst across three text fields. Only the Enabled toggle can
    // change what the ribbon shows, so everything else returns here — which is
    // also what bounds addRibbonIcon's own per-call unload registration, since
    // detach() does not undo it.
    if (key === this.ribbonKey) return;
    this.ribbonKey = key;

    // Cleared before the loop, so a throw partway through cannot leave the
    // array pointing at elements that are no longer on screen.
    for (const el of this.ribbonEls) el.detach();
    this.ribbonEls = [];

    for (const granularity of enabled) {
      const label = granularityLabels[granularity];
      const el = this.addRibbonIcon(
        `calendar-${granularity}`,
        label.labelOpenPresent,
        (e: MouseEvent) => {
          if (e.type !== "auxclick") {
            this.openPeriodicNote(granularity, window.moment(), {
              inNewSplit: isMetaPressed(e),
            });
          }
        },
      );
      // registerDomEvent, not addEventListener: the listener closes over `this`
      // and would otherwise keep a detached element reachable for the life of
      // the app.
      this.registerDomEvent(el, "contextmenu", (e: MouseEvent) => {
        e.preventDefault();
        showContextMenu(this, { x: e.pageX, y: e.pageY });
      });
      this.ribbonEls.push(el);
    }
  }
```

## Commands — `src/commands.ts`

Five commands per granularity: open the current period's note, and jump or open
forwards and backwards. All of them are `checkCallback` commands, so a disabled
granularity contributes nothing to the palette at all.

```bash
sed -n '/^  const navCommand = /,/^  });$/p' src/commands.ts
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
        return plugin.cache.find(activeFile.path)?.granularity === granularity;
      }
      run();
    },
  });
```

The nav commands are gated twice over: the granularity must be enabled, *and* the
active file must itself be a periodic note of that granularity — there is no
"next weekly note" from a file that is not a weekly note.

Right-clicking a ribbon icon opens the same set of "open now" actions, built from
the same enabled list:

```bash
sed -n '/^export function showContextMenu/,/^}/p' src/commands.ts
```

```output
export function showContextMenu(
  plugin: PeriodicNotesPlugin,
  position: Point,
): void {
  const menu = new Menu();
  const enabled = getEnabledGranularities(plugin.settings);

  for (const granularity of enabled) {
    const label = granularityLabels[granularity];
    menu.addItem((item) =>
      item
        .setTitle(label.labelOpenPresent)
        .setIcon(`calendar-${granularity}`)
        .onClick(() => plugin.openPeriodicNote(granularity, window.moment())),
    );
  }

  menu.showAtPosition(position);
}
```

## The calendar — `src/calendar/`

A Svelte 5 month grid in a sidebar `ItemView`. The bridge between Obsidian and
Svelte runs both ways: the view calls **exported functions** on the mounted
component (`tick`, `setActiveFilePath`), and the component calls back through
**callback props** (`onHover`, `onClick`, `onContextMenu`).

### The view — `calendar/view.ts`

`onOpen` mounts the component and then does three things that each fix a way the
calendar used to go stale.

```bash
sed -n '/^  async onOpen/,/^  }$/p' src/calendar/view.ts
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

    // `today` was only ever reassigned from a file-open, so the highlight and
    // Nav's showingCurrentMonth stayed pinned to yesterday when the app sat
    // open overnight. An interval rather than a timer to midnight: a timeout
    // fires late after the machine sleeps and never reschedules. tick() no-ops
    // unless the day actually changed.
    this.registerInterval(
      window.setInterval(() => this.calendar?.tick(), 60_000),
    );

    // No file-open fires for a file that is already open, so a calendar
    // revealed next to an open periodic note would render with nothing
    // highlighted until the user switched away and back. Deferred because
    // onFileOpen returns early until layout is ready — which is exactly the
    // case when the sidebar is restored at startup with a note already active.
    this.app.workspace.onLayoutReady(() => this.onFileOpen(null));
  }
```

- **The one-minute interval.** `today` was only ever reassigned from a file-open,
  so leaving the app open overnight left the `.today` highlight pinned to
  yesterday. An interval rather than a timer to midnight: a `setTimeout` fires
  late after the machine sleeps and never reschedules. `tick()` no-ops unless the
  day actually changed, so 1440 calls a day cost nothing.
- **The deferred initial sync.** No `file-open` fires for a file that is *already*
  open, so a calendar revealed next to an open periodic note rendered with nothing
  highlighted. It is deferred because `onFileOpen` returns early until layout is
  ready — which is exactly the case when the sidebar is restored at startup.

The third staleness is a rename. A pure rename changes the leaf's file without the
file "opening", so `file-open` never fires and the tracked path would keep
pointing at something nothing matches:

```bash
sed -n '/^  private onFileOpen/,/^  }$/p;/^  private onRename/,/^  }$/p' src/calendar/view.ts
```

```output
  private onFileOpen(_file: TFile | null): void {
    if (this.closed || !this.app.workspace.layoutReady) return;
    if (this.calendar) {
      const path = this.app.workspace.getActiveFile()?.path ?? null;
      this.activeFilePath = path;
      this.calendar.setActiveFilePath(path);
      this.calendar.tick();
    }
  }
  private onRename(file: TAbstractFile, oldPath: string): void {
    if (this.closed || !this.calendar) return;
    if (this.activeFilePath === null || oldPath !== this.activeFilePath) return;
    this.activeFilePath = file.path;
    this.calendar.setActiveFilePath(file.path);
  }
```

The context menu contributes **no items of its own**:

```bash
sed -n '/^  private onContextMenu/,/^  }$/p' src/calendar/view.ts
```

```output
  private onContextMenu(file: TFile | null, event: MouseEvent): void {
    if (!file) return;
    // No custom items: Obsidian's own file-menu handlers contribute Delete —
    // with its confirmation and the vault's "Deleted files" preference — plus
    // Rename and whatever other plugins add. The item that used to be here
    // called vault.trash(file, true), which hard-coded the *system* trash,
    // asked nothing, and dropped the promise so a failure was invisible.
    const menu = new Menu();
    this.app.workspace.trigger(
      "file-menu",
      menu,
      file,
      "calendar-context-menu",
      null,
    );
    menu.showAtPosition({ x: event.pageX, y: event.pageY });
  }
```

Triggering `file-menu` and showing the result gets Obsidian's own Delete — with
its confirmation dialog and the vault's "Deleted files" preference — plus Rename
and whatever other plugins contribute. The custom item that used to sit here
called `vault.trash(file, true)`, which hard-coded the *system* trash regardless
of the user's setting, asked nothing first, and dropped the returned promise so a
failure was invisible.

### The reactivity bridge — `calendarStore.svelte.ts`

A `$state` integer. Every vault or metadata event that could have changed the
periodic-note landscape increments it; the component reads it inside a `$derived`
so its file map re-computes.

```bash
cat src/calendar/calendarStore.svelte.ts
```

```output
import type { Moment } from "moment";
import type { Component, TFile } from "obsidian";

import { getEnabledGranularities } from "src/format";
import type PeriodicNotesPlugin from "src/main";
import type { Granularity } from "src/types";

export default class CalendarStore {
  // Bumped on any vault/metadata event that may have changed the
  // periodic-note landscape. Consumers read this inside a $derived
  // or $effect to re-compute derived state (e.g., the FileMap).
  version = $state(0);
  private plugin: PeriodicNotesPlugin;

  constructor(component: Component, plugin: PeriodicNotesPlugin) {
    this.plugin = plugin;

    // onLayoutReady is deferred, and the leaf can be closed before it runs.
    // component.registerEvent on an already-unloaded component would never be
    // torn down again.
    let closed = false;
    component.register(() => {
      closed = true;
    });

    plugin.app.workspace.onLayoutReady(() => {
      if (closed) return;
      const { vault, metadataCache, workspace } = plugin.app;
      component.registerEvent(vault.on("delete", this.bump, this));
      component.registerEvent(vault.on("rename", this.bump, this));
      component.registerEvent(metadataCache.on("changed", this.bump, this));
      component.registerEvent(
        workspace.on("periodic-notes:resolve", this.bump, this),
      );
      component.registerEvent(
        workspace.on("periodic-notes:settings-updated", this.bump, this),
      );
      this.bump();
    });
  }

  // Unguarded, and every registration uses it. Filtering on whether the file
  // is already indexed only skipped a re-derive of computeFileMap — a 50-entry
  // Map of Map.get lookups — and cost a read of NoteCache's index that made
  // this store's correctness depend on NoteCache having wired its own
  // listeners first (#178).
  private bump(): void {
    this.version++;
  }

  public getFile(date: Moment, granularity: Granularity): TFile | null {
    return this.plugin.cache.getPeriodicNote(granularity, date);
  }

  public getEnabledGranularities(): Granularity[] {
    return getEnabledGranularities(this.plugin.settings);
  }
}
```

Two things are deliberate here.

**The `closed` flag.** `onLayoutReady` is deferred and the leaf can be closed
before it runs. `registerEvent` on an already-unloaded component would never be
torn down again, so the callback checks first.

**There is no `create` listener, and `bump` is unguarded.** A create already
reaches `NoteCache.resolve`, which indexes synchronously and fires
`periodic-notes:resolve` — bound just below. And a guard on whether
the file is already indexed cannot work for a delete or rename anyway: by then
the entry is gone from the index, so the check reports false for a file that
*was* a periodic note. Since every `NoteCache` read path self-heals, an
occasional unnecessary re-derive of a 50-entry map is cheaper than the read of
`NoteCache`'s index and the ordering dependency the guard created.

### The FileMap — `calendar/store.ts`

Rather than every cell subscribing separately, `Calendar.svelte` computes one
`Map` per rendered month and children do `$derived` lookups into it.

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

**Day keys are always present, even when day notes are disabled.** That looks
inconsistent next to the three gated blocks, and it is load-bearing:
`Month.svelte` reads `fileMap.has(key)` as its *enabled* signal for month and
year, while `Day.svelte` reads `fileMap.get(key) ?? null` to decide whether to
draw a has-note dot. Gating day keys the same way would collapse "disabled" and
"enabled but no note" into a single absent key, and the dot could no longer tell
them apart. Disabled day cells are instead switched off by an explicit
`dayEnabled` prop.

```bash
sed -n '/^  const enabledGranularities/,/^  );$/p' src/calendar/Calendar.svelte
```

```output
  const enabledGranularities: Granularity[] = $derived.by(() => {
    // Track fileStore.version so mutations re-derive.
    void fileStore.version;
    return fileStore.getEnabledGranularities();
  });

  const showWeeks: boolean = $derived(enabledGranularities.includes("week"));
  const dayEnabled: boolean = $derived(enabledGranularities.includes("day"));

  const fileMap: FileMap = $derived.by(() =>
    computeFileMap(
      month,
      (date, granularity) => fileStore.getFile(date, granularity),
      enabledGranularities,
    ),
  );
```

`void fileStore.version` is the whole subscription: reading the `$state` inside
the `$derived.by` is what registers the dependency, so a bump re-runs it.

The month grid itself is always 42 cells — six weeks — so the layout never
reflows as the user pages through months:

```bash
sed -n '/^export function getMonth/,/^}/p' src/calendar/utils.ts
```

```output
export function getMonth(displayedMonth: Moment): Month {
  const month: Month = [];
  let week!: Week;

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

One shared helper handles keyboard activation for the cells that act as buttons
but are not `<button>` elements. Space on a focused non-button scrolls its
container by default, so a keyboard user activating a week number would open the
note *and* jump the calendar out of view:

```bash
sed -n '/^export function activateOnKey/,/^}/p' src/calendar/utils.ts
```

```output
export function activateOnKey(
  activate: () => void,
): (event: Pick<KeyboardEvent, "key" | "preventDefault">) => void {
  return (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    activate();
  };
}
```

It is typed structurally on `Pick<KeyboardEvent, "key" | "preventDefault">`
rather than on `KeyboardEvent`, which is what lets it be tested without a DOM.

## Build and test

The build emits a single CommonJS file to the **repo root** — `outDir: "."` with
`emptyOutDir: false`, because `main.js` is what Obsidian loads and it is tracked
in git. Only the default export survives.

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

`bun run check` is the gate: type-check, then Biome, then `svelte-check` for the
components. The scripts:

```bash
sed -n '/"scripts"/,/}/p' package.json
```

```output
  "scripts": {
    "audit": "bun audit --audit-level=critical",
    "dev": "vite build --watch",
    "build": "bun run check && vite build",
    "check": "bun run typecheck && biome check . && svelte-check --tsgo",
    "typecheck": "node ./node_modules/@typescript/native/bin/tsc --noEmit",
    "lint": "biome check .",
    "lint:fix": "biome check --write .",
    "format": "biome format --write .",
    "format:check": "biome format .",
    "version": "bun run version-bump.ts",
    "test": "bun test",
    "deploy": "bun run deploy.ts"
  },
```

`typecheck` runs the **native TypeScript 7** compiler, which arrives under an
alias. `svelte-check` supports TS 7 only when both majors are installed — TS 6
under the `typescript` name for its own internals, TS 7 aliased as
`@typescript/native` — and only behind the `--tsgo` flag above. TS 6 belongs to
`svelte-check`, not to the plugin, so `package.json` does not declare it: bun
installs it from that peer range and `bun.lock` pins the version it resolved.

```bash
echo "test files: $(ls src/*.test.ts src/calendar/*.test.ts | wc -l | tr -d ' ')" && echo "test cases: $(grep -rhoE '\b(test|it)\(' src/*.test.ts src/calendar/*.test.ts | wc -l | tr -d ' ')"
```

```output
test files: 11
test cases: 157
```

That count is the whole automated safety net, and it only covers the pure side of
the split. The Obsidian-facing modules — the plugin lifecycle, the cache's event
wiring, template writes, the settings tab and every Svelte component — are
verified by loading the built plugin into a real vault.

`bun run deploy` copies `main.js`, `manifest.json` and `styles.css` into a vault's
plugin folder for exactly that, reading the destination from a gitignored
`.env.local`.

## Recap — following a click

Putting it together, here is what happens when a user clicks an empty day cell in
the calendar:

1. **`Day.svelte`** calls its `onClick` prop, which is `CalendarView.onClick`.
2. **`view.ts`** forwards to `plugin.openPeriodicNote(granularity, date)`.
3. **`main.ts`** asks the cache first — `cache.getPeriodicNote` is an O(1) `byKey`
   lookup that also verifies the file still exists, healing the index if not.
4. Nothing there, so **`createPeriodicNote`** formats the filename, builds the
   path through `paths.buildNotePath` (which throws rather than escape the vault),
   creates any missing folders, and single-flights the write.
5. `vault.create` fires a **`create` event**, which `NoteCache` picks up.
6. **`resolve`** parses the filename via `cacheResolve.resolveEntry`, indexes the
   entry, applies the template through `templateRender.applyTemplate`, re-checks
   the file did not move, and fires `periodic-notes:resolve`.
7. **`CalendarStore`** hears that trigger and increments `version`.
8. **`Calendar.svelte`**'s `$derived` re-runs `computeFileMap`, and the cell's
   `$derived` lookup now finds a file — so the dot appears.
9. Back in step 2, the file is opened in a leaf.

Every step after the click is either a pure function with tests, or four lines of
Obsidian wiring around one.
