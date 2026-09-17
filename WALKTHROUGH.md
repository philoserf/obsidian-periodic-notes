# Obsidian Periodic Notes Walkthrough

A linear tour of how this plugin works, following the call chain from the entry
point outward. Snippets are labelled by file and symbol; an elided middle is
marked `...`.

## Overview

The plugin establishes one convention and then maintains it:

> **A file whose path renders from a Moment format string _is_ the note for that
> date at that granularity.**

Obsidian stores notes as Markdown files in folders and has no concept of time.
Users think in periods — today's note, this week's, the month before this one.
The plugin bridges the two: it recognises which files are periodic notes, keeps
that mapping queryable in both directions, and hangs three affordances off it —
ribbon icons, commands, and a sidebar calendar.

Four granularities, each independently enabled with its own format, folder and
template: `day`, `week`, `month`, `year`.

**Technologies.** TypeScript, bundled by Vite to a CommonJS `main.js` at the
repository root. That bundle is **not** tracked: `release.yml` builds it fresh at
the tag and attaches that, and `deploy.ts` builds before copying to a vault, so
nothing ever reads a committed copy. Svelte 5 with runes, used for the calendar
view only — everything else uses native Obsidian APIs. Tests run under
`bun test`.

**Entry point.** `src/main.ts` exports the `Plugin` subclass Obsidian loads.

## Architecture

### The pure/impure split

The single most load-bearing structural rule: **a module that imports a _value_
from `obsidian` cannot be imported by a test at all**, because Obsidian is the
host application rather than a package. So most modules come in pairs — a pure
core holding the logic, and a thin wiring layer holding the Obsidian calls.

| Wiring (untestable)      | Pure core (directly tested)                          |
| ------------------------ | ---------------------------------------------------- |
| `cache.ts`               | `cacheResolve.ts`, `cacheIndex.ts`, `cacheSearch.ts` |
| `template.ts`            | `templateRender.ts`                                  |
| `settings.ts`            | `settingsLoad.ts`, `paths.ts`                        |
| `main.ts`, `commands.ts` | `format.ts`, `locale.ts`, `types.ts`                 |
| `platform.ts`            | —                                                    |
| `calendar/view.ts`       | `calendar/store.ts`, `calendar/utils.ts`             |

Where extraction needs a value only the wiring layer has, it is injected as a
callback rather than mocked — `normalizeFolder` into `sanitizeSettings`, a
frontmatter `read` into resolution, `getFile` into `computeFileMap`.

`types.ts` is on the pure side and holds `getEnabledGranularities`, because that
function reads no format: it filters the granularity list by the enabled flag,
and both are declared there. Three modules used to import `format.ts` for it and
nothing else.

### Data flow

```
vault events ──► NoteCache ──► resolveFile ──► CacheIndex
                     │                              │
                     │                              ├─► getPeriodicNote (O(1) by key)
                     │                              ├─► find           (by path)
                     │                              └─► findAdjacent   (binary search)
                     │                                       ▲
                     └─► periodic-notes:resolve ─────────────┤
                                                             │
     ribbon / commands / calendar ───────────────────────────┘
```

## Core walkthrough

### 1. Loading

`src/main.ts` — `PeriodicNotesPlugin.onload`

```ts
await this.loadSettings();
// moment's locale is global to the app, so put it back on unload.
this.register(configureLocale());

// addChild, not a bare field: Component.registerEvent only arranges teardown
// during the component's own unload, and nothing else would ever unload the
// cache. Without this its five vault listeners survive a disable, and a
// disabled plugin goes on applying templates to newly created files.
this.cache = this.addChild(new NoteCache(this.app, this));
```

Two details worth pausing on. `configureLocale` returns an undo function because
`moment.locale()` is a global setter on the single moment instance Obsidian
hands every plugin — leaving it set reconfigures date formatting app-wide. And
the cache is registered as a **child component**, not assigned to a field, so
that disabling the plugin actually tears down its listeners.

### 2. Settings are re-validated on every load

`loadData()` returns whatever plain JSON was last written, so nothing about its
shape can be assumed.

`src/settingsLoad.ts` — `sanitizeConfig`

```ts
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
```

Every field is checked individually and falls back to its own default, rather
than the sub-object being trusted as a unit. Formats are deliberately **not**
round-tripped here: `loadSettings` runs before `configureLocale`, so rejecting
on a parse failure would silently reset a working format on upgrade. Only values
that would escape the vault are refused.

`literalizeFormat` is why a traversal cannot hide inside an escape — moment
renders `[..]` as a literal `..`, so the guard checks the rendered shape:

`src/paths.ts` — `literalizeFormat`

```ts
export function literalizeFormat(format: string): string {
  return format.replace(/\[([^\]]*)\]/g, "$1");
}
```

### 3. Recognition: one entry point

This is the heart of the plugin. Given a file, is it a periodic note, and for
which granularity?

`src/cacheResolve.ts` — `resolveFile`

```ts
export function resolveFile(
  file: PathParts,
  settings: Settings,
  read: (granularity: Granularity) => unknown,
): CacheEntry | null {
  if (file.extension !== "md") return null;
  return (
    resolveFrontmatterEntry(file, settings, read) ??
    resolveFilenameEntry(file, settings)
  );
}
```

Small, and both lines are load-bearing.

**The Markdown guard** is the whole of a defect where any file type whose
basename parsed was indexed: an attachment named `2026-09-07.png` became the day
note, a `.canvas` outranked the real `.md` on the tiebreak below, and an empty
non-Markdown file whose name parsed had the Markdown template written into it.
Creation was always Markdown-only — `getNoteCreationPath` appends `.md` — so
recognition now matches.

**The `??` is the precedence rule.** Frontmatter is an explicit statement about
the note's date; a filename that merely parses is the fallback. That ordering
used to be reconstructed at runtime from four separate mechanisms — a refusal to
re-resolve, a call order, a removal-and-re-offer, and a rename branch. All four
are gone. The rename branch survived longest, because it was not obvious that
`resolve` could read frontmatter at a file's _new_ path. It can.

`PathParts` is a structural subset of `TFile`, which is what keeps this module
importable in tests:

`src/format.ts` — `PathParts`

```ts
// Structural subset of TFile, so this module stays importable in tests.
export type PathParts = {
  path: string;
  basename: string;
  extension: string;
};
```

### 4. Filename matching, and how much of the path counts

`src/cacheResolve.ts` — `resolveFilenameEntry`

```ts
for (const granularity of getEnabledGranularities(settings)) {
  const folder = settings.granularities[granularity].folder;
  if (!isInFolder(file.path, folder)) continue;

  const format = getFormat(settings, granularity);
  const dateInput = extractDateStringFromPath(file, format);
  const date = window.moment(dateInput, format, true);
  if (date.isValid()) {
    return { filePath: file.path, date, granularity, match: "filename" };
  }
}
```

Parsing is **strict** (`true`), and granularities are tried in canonical order,
so the first that parses wins for an ambiguous name.

The interesting part is `extractDateStringFromPath`, which answers "how much of
this path is the date string":

`src/format.ts` — `extractDateStringFromPath`

```ts
export function extractDateStringFromPath(
  file: PathParts,
  format: string,
): string {
  // TFile.extension is "" for an extensionless file, and initialize()'s walk
  // does not filter by extension — slicing -(0 + 1) would eat a real
  // character of the path rather than a separator.
  const withoutExtension = file.extension
    ? file.path.slice(0, -(file.extension.length + 1))
    : file.path;
  const depth = literalizeFormat(format).split("/").length;
  return withoutExtension.split("/").slice(-depth).join("/");
}
```

One rule for flat and nested formats alike: take as many trailing segments as
the format actually **renders**. A flat format renders no separator, so this
degenerates to the basename.

It is counted with `literalizeFormat` rather than by stripping escapes, and that
distinction is not academic — moment renders `[d/]` as the literal `d/`, a real
directory separator on disk. Counting on a stripped format under-counts exactly
the formats whose rendered shape differs from their source.

This replaced a pair of functions that each hedged: one returned two parse
candidates, the other returned either the basename or the last N segments, and a
predicate chose between them. The hedges cancelled, and for any non-day
granularity the effect was that a nested format was matched against the bare
basename — against the format with everything before the last slash removed,
which is exactly where the year token lives. `2019/09.md` under `YYYY/MM`
resolved to September of the _current_ year.

### 5. Frontmatter matching

`src/cacheResolve.ts` — `resolveFrontmatterEntry`

```ts
const raw = read(granularity);
if (raw === undefined || raw === null || raw === "") continue;

const dateString = asDateString(raw);
if (dateString === null) {
  refuse(file.path, granularity, raw, "is not a date value");
  continue;
}
```

Note `continue`, not `return`: a property that is present but unusable is
reported and skipped, so a file carrying `day: junk` alongside `week: 2026-W37`
is still indexed as a week note.

`asDateString` exists because YAML types values the way users actually write
them, not the way a strict string check would want:

`src/cacheResolve.ts` — `asDateString`

```ts
function asDateString(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (Array.isArray(value) && value.length === 1) return asDateString(value[0]);
  return null;
}
```

`year: 2026` is a number; `day: [2026-09-07]` is a list.

### 6. The index

`CacheIndex` keeps three maps: by path, by canonical key, and a per-key list of
**contenders** — entries that lost a collision.

`src/cacheSearch.ts` — `canonicalKey`

```ts
if (!date.isValid()) {
  throw new Error(
    `Cannot build a ${granularity} cache key from an invalid date`,
  );
}
return `${granularity}:${date.clone().startOf(granularity).toISOString()}`;
```

It throws rather than tolerating an invalid date, because `toISOString()` returns
`null` for one — which the template literal would render as the string `"null"`,
aliasing every invalid date for a granularity onto one key.

One file per key is what keeps lookup O(1), so a collision must evict someone.
Who is decided by a rule, not by arrival order:

`src/cacheIndex.ts` — `preferred`

```ts
function preferred(a: CacheEntry, b: CacheEntry): CacheEntry {
  if (a.match !== b.match) return a.match === "frontmatter" ? a : b;
  return a.filePath <= b.filePath ? a : b;
}
```

Same precedence as `resolveFile`, applied to a different question.

The loser is not discarded — it is filed as a contender, so freeing the key
brings it back:

`src/cacheIndex.ts` — `set`

```ts
// The loser is not a periodic note as far as the rest of the plugin is
// concerned: byPath backs get and findAdjacent, so leaving it there would
// report a note the calendar and nav commands cannot act on. It is kept
// as a contender instead, so freeing the key brings it back.
this.byPath.delete(loser.filePath);
this.addContender(newKey, loser);
```

A key is freed two ways — `remove()`, and a `set()` that re-dates an existing
entry — and both call `promote`. `set` returns **whichever entry now holds the
key**, which is not always the one passed in; callers that announce a resolution
check that return value before firing.

`findAdjacent` binary-searches a sorted key list that it builds where it uses it.
That list was once cached per granularity and invalidated by a dirty set — but
`findAdjacent`'s own loop removes stale entries as it walks, so the cache was
dirtied on nearly every iteration of the loop it existed to speed up.

One subtlety in `set` is easy to lose. An entry that replaces _itself_ under the
same key with a different `match` — a frontmatter note whose property is edited
away, leaving a filename that still parses — has to vacate and re-offer the key.
The collision check compares against the incumbent, which is that same path, so
it would otherwise skip a contender `preferred` would now pick.

### 7. Wiring the index to the vault

`src/cache.ts` — `NoteCache.onload`

```ts
this.app.workspace.onLayoutReady(() => {
  console.info("[Periodic Notes] initializing cache");
  this.initialize();
  this.registerEvent(
    this.app.vault.on("create", (file) => {
      if (file instanceof TFile) void this.resolveCreated(file);
    }),
  );
  ...
  this.registerEvent(this.app.vault.on("rename", this.onRename, this));
  this.registerEvent(
    this.app.metadataCache.on("changed", (file, _data, cache) =>
      this.resolveFrontmatter(file, cache),
    ),
  );
```

Five listeners: create, delete, rename, metadata change, and the plugin's own
settings-updated event.

All five sit behind a `closed` flag the component sets on unload. That guard is
load-bearing: `onLayoutReady` defers whenever layout is not ready, and
`registerEvent` on an already-unloaded component has nothing left to tear down,
since `unload()` drains its list once and does not run again. Without it,
disabling the plugin during workspace restore leaves five vault listeners
attached for the life of the app — and the `create` listener writes templates.

`entryFor` is the shared path — it reads frontmatter once and hands it to
`resolveFile` as a closure:

`src/cache.ts` — `NoteCache.resolve`

```ts
// Hoisted out of the closure: resolveFile asks for each enabled
// granularity in turn, and an in-closure lookup would repeat this read up
// to four times per file across initialize()'s whole-folder walk.
const frontmatter =
  this.app.metadataCache.getFileCache(file)?.frontmatter ?? null;
const entry = resolveFile(file, settings, (granularity) =>
  parseFrontMatterEntry(frontmatter, granularity),
);
if (!entry) return;

// A canonical-key collision can leave this file unindexed in favour of
// another note for the same date. Nothing downstream should be told the
// file resolved when it did not.
return this.index.set(entry).filePath === file.path ? entry : null;
```

Two callers sit on it. `resolve(file)` is synchronous — index, then announce.
`resolveCreated(file)` is the vault `create` path, and is `async` only because it
may apply a template. That split replaced a boolean parameter which made three
synchronous callers return a promise for a branch only the fourth ever took.

The metadata handler is deliberately **not** routed through `resolve`:

`src/cache.ts` — `NoteCache.resolveFrontmatter`

```ts
// Deliberately does NOT trigger periodic-notes:resolve, and does not go
// through resolve(): that would fire the plugin's public event on every
// metadata save of every periodic note, and route a plain save through the
// template-capable path. Reads the event's own frontmatter rather than
// getFileCache, which may not yet reflect this change.
```

### 8. Template application on the create path

When a file is created empty, `resolve` applies the granularity's template —
and the write is where the care is:

`src/template.ts` — `applyTemplateToFile`

```ts
// The caller checked the file was empty before awaiting readTemplate above,
// so anything Obsidian Sync, another plugin or an external editor wrote in
// the meantime would be destroyed by an unconditional modify. process runs
// the transform under the vault's own lock, which closes the window rather
// than narrowing it — and content arriving is a reason to leave the file
// alone, not an error: a note that already says something does not want a
// template stamped over it.
await app.vault.process(file, (data) => (data === "" ? rendered : data));
```

Because the template write suspends, the file can be deleted or renamed while it
is in flight, so `resolveCreated` re-checks both before announcing:

`src/cache.ts` — `NoteCache.resolve`

```ts
if (!this.index.get(entry.filePath)) return; // deleted mid-write
if (this.app.vault.getAbstractFileByPath(entry.filePath) !== file) {
  return; // renamed mid-write
}
```

`periodic-notes:resolve` fires **after** the template lands, so listeners may
read file contents.

### 9. Token rendering

`src/templateRender.ts` — `applyTemplate`

```ts
// Replacer functions, not strings: a string replacement reads "$&", "$`",
// "$\'", "$1"-"$9" and "$$" as patterns, and `filename` comes from the user's
// date format, which may legitimately contain "$".
let contents = rawTemplateContents
  .replace(/{{\s*date\s*}}/gi, () => filename)
  .replace(/{{\s*time\s*}}/gi, () => window.moment().format("HH:mm"))
  .replace(/{{\s*title\s*}}/gi, () => filename);
```

Tokens are **scoped by granularity** — that is a limit, not a grouping. The
parameterized `{{date:FMT}}` form is day-only; a monthly template containing it
writes the characters out verbatim, and `{{month:…}}` is the equivalent there.

Two mutation hazards are handled the same way. Moment's unit aliases are
case-sensitive exactly where it hurts (`M` is month, `m` is minute) while the
token patterns are case-insensitive, so a month or year token reads `m` as
months. And `.weekday()` mutates in place, so the date is cloned before use —
the `Moment` may be the one a `CacheEntry` is indexed under.

### 10. Creation and opening

`src/main.ts` — `createPeriodicNote`

```ts
// Covers a note created since the caller checked the cache — by a second
// click, by another device, or outside Obsidian entirely.
const existing = this.app.vault.getAbstractFileByPath(destPath);
if (existing instanceof TFile) return existing;

const inFlight = this.creating.get(destPath);
if (inFlight) return inFlight;
```

Get-or-create, with an in-flight map. The index only learns of a file from the
vault's `create` event, so two callers racing to open the same note both see a
cache miss; without the map the second reaches `vault.create` and throws for a
note that was created correctly.

`ensureFolderExists` distinguishes "nothing here" from "a file is here", because
the second produces a much better error than the one note creation would raise
later.

### 11. Commands, ribbon, calendar

**Commands** (`src/commands.ts`) come in five per granularity: open the current
period's note, jump forwards/backwards to the closest existing note, and open
the next/previous period whether or not it exists. The nav commands use
`checkCallback` so they only appear when the active file is a note of that
granularity — and because Obsidian calls that callback twice, once to ask and
once to execute, the entry it resolves is handed to the handler rather than
looked up a second time.

Every failure report in the plugin goes through one function:

`src/platform.ts` — `reportFailure`

```ts
export function reportFailure(summary: string, err: unknown): void {
  console.error(`[Periodic Notes] ${summary}`, err);
  const detail =
    err instanceof Error ? ` — ${err.message}` : ". See console for details.";
  new Notice(`Periodic Notes: ${summary}${detail}`);
}
```

The detail clause is what makes it worth sharing rather than repeating. The
folder-collision error from `ensureFolderExists` names exactly what is wrong and
where, which is no use in a console the user does not have open — so a message
is carried through whenever the error has one.

**Ribbon icons** are rebuilt only when the enabled set changes, keyed on a
join of the enabled granularities — saves are debounced per keystroke across
three text fields, and only the Enabled toggle can change what the ribbon shows.

**The calendar** (`src/calendar/`) is the one Svelte 5 area. `CalendarStore`
holds a `$state` version counter bumped on any relevant vault event; consumers
read it inside `$derived` so the file map recomputes.

That map is **total**: every key the visible grid can ask about is present,
mapped to a `TFile` or to `null`, so a lookup answers exactly one question — is
there a note for this period. It once omitted keys for disabled granularities,
which let month and year read `fileMap.has(key)` as their enabled signal and
loaded a single lookup with two facts. Every granularity but the week column now
takes an explicit prop; the week column stays a conditional render, because a
disabled week column should occupy no table cell at all.

The bump is deliberately unguarded:

`src/calendar/calendarStore.svelte.ts` — `CalendarStore.bump`

```ts
// Unguarded, and every registration uses it. Filtering on whether the file
// is already indexed only skipped a re-derive of computeFileMap — a 50-entry
// Map of Map.get lookups — and cost a read of NoteCache's index that made
// this store's correctness depend on NoteCache having wired its own
// listeners first (#178).
```

`CalendarView` keeps a one-minute interval so `today` does not pin to the day
the calendar was opened, and tracks the active file path separately because a
pure rename changes the leaf's file without firing `file-open`. Its listeners are
registered in `onOpen` rather than the constructor, and `onOpen` clears the
`closed` flag that `onClose` sets: Obsidian may reuse a view instance across
close and reopen, and registering once in the constructor left a reopened
calendar with its listeners attached but every handler returning early.

### 12. Settings changes and rescans

`src/main.ts` — `saveSettings`

```ts
// NoteCache.reset() re-walks every configured folder and re-parses every
// filename, so firing this on each debounce tick meant a full vault scan
// per typing pause — including for fields the index never reads.
const snapshot = this.indexingSnapshotOf(this.settings);
if (snapshot !== this.indexingSnapshot) {
  this.indexingSnapshot = snapshot;
  this.app.workspace.trigger("periodic-notes:settings-updated");
}
```

Only `enabled`, `format` and `folder` decide what gets indexed, so editing a
template path costs nothing.

### 13. How it is bundled

The build is short, and almost every line in it is a constraint Obsidian
imposes rather than a preference.

`vite.config.ts` — `build`

```ts
build: {
  lib: {
    entry: "src/main.ts",
    formats: ["cjs"],
    fileName: () => "main.js",
  },
  outDir: ".",
  emptyOutDir: false,
  ...
  rollupOptions: {
    external: ["obsidian", "electron", "fs", "os", "path"],
    output: { exports: "default" },
  },
},
```

**CommonJS with a single default export**, because that is what Obsidian's
plugin loader reads. `output.exports: "default"` is what keeps the bundle from
acquiring a `module.exports.default` wrapper; the loader wants the class itself.

**`outDir: "."` with `emptyOutDir: false`.** The bundle has to sit at the
repository root, beside `manifest.json` and `styles.css`, because that is the
shape Obsidian installs. Vite warns about this on every build — an output
directory that is also the project root is normally a way to overwrite your own
source — and `emptyOutDir: false` is the line that makes it safe, since the
default would wipe the directory first.

**The externals are supplied by the host.** `obsidian` is not a package that
exists at runtime; nor are `electron` or the Node built-ins. Bundling them would
produce a file that cannot load.

Two smaller things. `svelte({ emitCss: false })` keeps the components from
emitting a stylesheet, because `styles.css` is three hand-written lines rather
than generated output. And the `src` alias is why calendar modules import as
`src/cacheSearch` rather than by relative path:

`vite.config.ts` — `resolve`

```ts
alias: { src: path.resolve(import.meta.dirname, "src") },
```

That reads `import.meta.dirname`, not `__dirname`, and the reason is worth
knowing before someone "fixes" it. This file uses ESM syntax while
`package.json` declares no `"type"`, so Node treats it as CommonJS; Vite hides
the mismatch today by bundling the config before loading it, and warns that it
will stop. The trap is that the remedy the warning suggests — a `.mts`
extension, or `"type": "module"` — moves the file into ESM scope, which is
exactly where `__dirname` does not exist. The fix had to come first.

**`main.js` is not tracked.** `release.yml` builds it at the tag and attaches
what that build produced; `deploy.ts` builds before copying into a vault. Nothing
reads a committed copy, so there is none.

## Where the reading order used to break down

One place, and it is filed rather than smoothed over. `CacheIndex`'s contender
lifecycle is spread across `addContender`, `dropContender`, `promote` and `set`,
which call each other in a way no single order untangles — `set` calls
`promote`, `promote` calls `dropContender`, and `set` calls `dropContender`
again nine lines later for a different reason. Every other module in the tree
reads top to bottom.

That is now navigable rather than resolved. The invariant those four methods
exist to preserve is stated once, above the class, and each points at it rather
than at the others — so a reader checks one method against the statement instead
of reconstructing it from the other three.

## Index

No new findings from this pass.

The two this document filed on its previous revision are both closed:
[#304](https://github.com/philoserf/obsidian-periodic-notes/issues/304), the
same-key match downgrade that skipped the contender re-contest, and
[#305](https://github.com/philoserf/obsidian-periodic-notes/issues/305),
`onRename`'s frontmatter splice. So is
[#271](https://github.com/philoserf/obsidian-periodic-notes/issues/271), the
reading-order problem described above — which is why that section now says
_used to_.

**Total: 0 issues.**

Prose in the previous revision that the code no longer supported — a
`resolve(file, isCreate)` flag, a rename splice, a sorted-key cache, and a
`FileMap` whose key presence doubled as an enabled signal — was corrected in
place by this pass rather than filed.
