# v2 Refactor Design

## Goals

Restructure the codebase for simplicity, clarity, and testability. This is a breaking change shipped as v2.0.0. One user (the maintainer) — no migration path needed.

## Decisions

| Decision                     | Choice                                      |
| ---------------------------- | ------------------------------------------- |
| Granularities                | day, week, month, year (drop quarter)       |
| Settings migration           | None — fresh defaults, reconfigure manually |
| openAtStartup                | Drop                                        |
| Getting-started banner       | Drop                                        |
| Legacy daily-notes migration | Drop                                        |
| Loose/date-prefixed matching | Drop                                        |
| Localization module          | Drop settings UI; keep minimal locale boot  |
| Settings UI                  | Native Obsidian `Setting` API, bare minimum |
| Approach                     | Big bang — single branch, one release       |

## Types and Constants

### types.ts

```ts
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
```

### constants.ts

Absorbs `calendar/constants.ts` and `calendar/context.ts`. Contains:

- `DEFAULT_FORMAT: Record<Granularity, string>` — no quarter
- `DEFAULT_CONFIG: NoteConfig` — `{ enabled: false, format: "", folder: "", templatePath: undefined }`
- `DEFAULT_SETTINGS: Settings` — all four granularities present with defaults
- `WEEKDAYS` array and `WeekdayName` type
- `HUMANIZE_FORMAT` — month and year only
- `VIEW_TYPE_CALENDAR = "calendar"`
- `DISPLAYED_MONTH` symbol (from `calendar/context.ts`)

## Settings

### Loading

No migration. Guard for v2 shape, otherwise defaults:

```ts
async loadSettings(): Promise<void> {
  const saved = await this.loadData();
  this.settings = saved?.granularities ? saved : DEFAULT_SETTINGS;
}
```

### Plain object, no Svelte store

`plugin.settings` becomes a plain `Settings` object. All `get(plugin.settings)` calls across the codebase become direct property access. Svelte store imports (`svelte/store`) are removed from every non-calendar module.

The calendar store subscribes to the `periodic-notes:settings-updated` workspace event (existing pattern) rather than a Svelte store subscription.

### Native settings UI

Single file: `src/settings.ts`. Uses Obsidian's `Setting` class with one section per granularity:

- Enabled toggle
- Format text input (with inline validation warning)
- Folder input (with `FolderSuggest`)
- Template input (with `FileSuggest`)

No banner, no locale dropdown, no week-start picker, no collapsible groups.

### Locale boot

Keep a minimal `configureLocale()` function in `main.ts` that runs once on load. It reads Obsidian's language setting from `localStorage` and calls `moment.locale()` so the calendar respects the user's app language (week start day, weekday names, etc.). No settings UI, no `vault.getConfig()`, no week-start picker — just follow the Obsidian app locale.

### Deleted

- `src/settings/` entire directory (index.ts, localization.ts, localization.test.ts, validation.ts, utils.ts, components/\*, pages/\*)
- `svelte-writable-derived` dependency

### Moved

- Format validation functions → `src/format.ts`
- `FileSuggest`/`FolderSuggest` → `src/fileSuggest.ts`

### Dropped functions

- `getLocaleOptions`, `getWeekStartOptions` — localization UI removed
- `isDailyNotesPluginEnabled`, `hasLegacyDailyNoteSettings`, `disableDailyNotesPlugin` — legacy migration removed
- `clearStartupNote`, `findStartupNoteConfig` — openAtStartup removed
- `getEnabledGranularities` — trivial, inline where needed

## Module Structure

```text
src/
  main.ts            — Plugin lifecycle, settings load/save, ribbon, commands
  settings.ts        — PluginSettingTab with native Obsidian Setting API
  cache.ts           — Cache data structure, CRUD, event handlers, indexed lookup
  template.ts        — Template reading + rendering
  format.ts          — Pure functions: format helpers, validation, path utils
  commands.ts        — Command factory + context menu (absorbs modal.ts)
  constants.ts       — All constants
  types.ts           — All shared types
  icons.ts           — SVG icon data
  obsidian.d.ts      — Private API type augmentations
  fileSuggest.ts     — FileSuggest + FolderSuggest
  calendar/
    view.ts          — CalendarView
    store.ts         — Reactivity bridge (renamed from fileStore.ts)
    Calendar.svelte
    Month.svelte
    Day.svelte
    Week.svelte      — Renamed from WeekNum.svelte
    Nav.svelte
    Arrow.svelte
    types.ts         — Week, Month, FileMap, EventHandlers
    utils.ts         — Calendar date math + isMetaPressed
```

### Deleted files

- `src/modal.ts` — absorbed into `commands.ts`
- `src/parser.ts` + `src/parser.test.ts` — loose matching removed
- `src/utils.ts` — split into `template.ts` and `format.ts`
- `src/settings/` — entire directory
- `src/calendar/constants.ts` — absorbed into `src/constants.ts`
- `src/calendar/context.ts` — absorbed into `src/constants.ts`
- `src/ui/` directory — `fileSuggest.ts` moves to `src/`

### Key splits

`src/utils.ts` (308 lines, 13 exports) splits into:

**template.ts** (depends on obsidian):

- `readTemplate(app, templatePath, granularity)` — reads template file
- `applyTemplate(filename, granularity, date, format, rawContents)` — token replacement
- `applyTemplateToFile(app, file, settings, entry)` — orchestrates read + render + write
- `getNoteCreationPath(app, filename, config)` — builds path, ensures folders exist
- `ensureFolderExists(app, path)` — private, creates intermediate directories
- `replaceGranularityTokens(...)` — private template helper
- Weekday helpers — private

**format.ts** (pure, zero obsidian imports, directly testable):

- `getFormat`, `getPossibleFormats`, `getConfig`
- `removeEscapedCharacters`, `validateFormat`, `validateFormatComplexity`
- `getDateInput`, `getBasename`, `isIsoFormat`, `isValidFilename`
- `join`

**Functions moved elsewhere:**

- `isMetaPressed` → `calendar/utils.ts` (used by Day.svelte, Week.svelte, Month.svelte, and main.ts ribbon config)

**Functions deleted:**

- `getRelativeDate` — dead code, no runtime consumers
- `capitalize` — only used by deleted settings components
- `getFolder` — trivial with new settings shape, inline as `settings.granularities[g].folder`

### Naming changes

| Old                           | New                   | Reason                    |
| ----------------------------- | --------------------- | ------------------------- |
| `PeriodicNotesCache`          | `NoteCache`           | Simpler                   |
| `PeriodicNoteCachedMetadata`  | `CacheEntry`          | Less verbose              |
| `PeriodicNotesSettingsTab`    | `SettingsTab`         | Simpler                   |
| `CalendarFileStore`           | `CalendarStore`       | Not a file store          |
| `fileStore.ts`                | `store.ts`            | Matches class name        |
| `displayConfigs`              | `granularityLabels`   | Describes content         |
| `IWeek`                       | `Week`                | TypeScript convention     |
| `IMonth`                      | `Month`               | TypeScript convention     |
| `IEventHandlers`              | `EventHandlers`       | TypeScript convention     |
| `WeekNum.svelte`              | `Week.svelte`         | Describes what it renders |
| `showFileMenu`                | `showContextMenu`     | It's a context menu       |
| `applyPeriodicTemplateToFile` | `applyTemplateToFile` | Context is obvious        |
| `getTemplateContents`         | `readTemplate`        | It reads                  |

## Cache Improvements

### Granularity-aware canonical key

```ts
function canonicalKey(granularity: Granularity, date: Moment): string {
  return `${granularity}:${date.clone().startOf(granularity).toISOString()}`;
}
```

### Secondary index for O(1) lookup

```ts
class NoteCache extends Component {
  private byPath: Map<string, CacheEntry>;
  private byKey: Map<string, CacheEntry>;
}
```

`set` and `delete` maintain both maps. `getPeriodicNote` becomes a direct lookup.

### Other cache methods

- `getPeriodicNotes` (plural) — still iterates `byPath`, returns all entries matching a date at a granularity. Acceptable since it's called rarely (related-files display).
- `findAdjacent` — reworked to filter and sort `byKey` entries for the target granularity. Since `canonicalKey` is granularity-aware and ISO-sortable, `localeCompare` on keys gives correct chronological order.
- `isPeriodic` and `find` — use `byPath` lookup, unchanged.

### Simplified CacheEntry

No loose matching means no `exact` boolean, no `date-prefixed` match type:

```ts
interface CacheEntry {
  filePath: string;
  date: Moment;
  granularity: Granularity;
  match: "filename" | "frontmatter";
}
```

`canonicalDateStr` is no longer stored — it's the map key.

## Commands and Context Menu

- `commands.ts` absorbs `modal.ts`
- `displayConfigs` → `granularityLabels`
- `showFileMenu` → `showContextMenu` (private in commands module)
- Settings access: `plugin.settings.granularities[g].enabled` (no `get()` wrapper)
- `isGranularityActive` becomes inline

## Calendar Changes

Lightest touch. Svelte stays for calendar components.

- `fileStore.ts` → `store.ts`, `CalendarFileStore` → `CalendarStore`
- `WeekNum.svelte` → `Week.svelte`
- `IWeek` → `Week`, `IMonth` → `Month`, `IEventHandlers` → `EventHandlers`
- Settings access: `plugin.settings` (plain object) instead of `get(plugin.settings)`
- `isMetaPressed` moves from `utils.ts` to `calendar/utils.ts` (used by Day, Week, Month components and main.ts imports from there)
- `calendar/context.ts` deleted — `DISPLAYED_MONTH` moves to `constants.ts`
- `calendar/constants.ts` deleted — `VIEW_TYPE_CALENDAR` moves to `constants.ts`
- `$effect` + `.subscribe()` bridge pattern stays — runes migration is post-v2

## Parser

Deleted entirely. `parser.ts` and `parser.test.ts` removed. The only export (`getLooselyMatchedDate`) was the loose matching feature we're dropping. The cache resolves files by exact filename format or frontmatter only.

## obsidian.d.ts

Remove localization types, legacy daily-notes types, and community plugin types. What remains:

```ts
import "obsidian";

declare module "obsidian" {
  export interface Workspace extends Events {
    on(
      name: "periodic-notes:settings-updated",
      callback: () => void,
      ctx?: any,
    ): EventRef;
    on(
      name: "periodic-notes:resolve",
      callback: () => void,
      ctx?: any,
    ): EventRef;
  }
}
```

## Test Strategy

### Tests that survive (renamed/updated)

- `format.test.ts` — imports directly from `format.ts`, no re-implementation
- `template.test.ts` — `applyTemplate` is pure, importable directly
- `cache.test.ts` — updated for new `CacheEntry` shape and secondary index
- `calendar/utils.test.ts` — calendar date math
- `calendar/store.test.ts` — renamed from `fileStore.test.ts`

### Tests deleted

- `parser.test.ts` — module deleted
- `settings/localization.test.ts` — module deleted
- `settings/validation.test.ts` — functions move to `format.ts`
- `settings/utils.test.ts` — functions dropped or inlined

### Tests rewritten

- `utils.test.ts` splits into `format.test.ts` and `template.test.ts`
- Functions are imported directly — no re-implementation in test files
- This closes #93

### Test preload

`test-preload.ts` stays, provides `window.moment` globally.

## Dependencies and Build

### Dependencies removed

- `svelte-writable-derived`

### Dependencies kept

- `svelte` + `@sveltejs/vite-plugin-svelte` — calendar uses Svelte
- All devDependencies (biome, vite, bun test, etc.)

### Build output

- `main.js` — CommonJS, project root
- `styles.css` — copied from `src/styles.css`
- `manifest.json` — version `2.0.0`, minAppVersion `1.6.0`
- `versions.json` — add `"2.0.0": "1.6.0"`

### Vite config

Unchanged.

## Quarter Removal Checklist

Removing the quarter granularity touches:

- `types.ts` — remove from `Granularity` union and `granularities` array
- `constants.ts` — remove from `DEFAULT_FORMAT`, `HUMANIZE_FORMAT`
- `commands.ts` — remove from `granularityLabels` (was `displayConfigs`)
- `icons.ts` — remove `calendarQuarterIcon` export
- `main.ts` — remove `addIcon("calendar-quarter", ...)` call
- `template.ts` — remove `granularity === "quarter"` branch from `applyTemplate`
- `cache.ts` — no quarter-specific logic, just fewer iterations

## Styles Cleanup

`src/styles.css` — remove dead CSS rules tied to deleted UI:

- `.settings-banner` — getting-started banner
- `.periodic-modal` — was for the switcher (already removed)
- `.has-error` — if only used by Svelte settings validation
- Any other rules only referenced by deleted Svelte components

## Issues Closed by This Refactor

- #85 — cache linear scan (secondary index)
- #93 — test files re-implement source functions (format.ts is directly importable)
- #100 — remove localization module
- #102 — partially addressed (Svelte stores removed from non-calendar code)
- #110 — replace Svelte settings UI with native API
