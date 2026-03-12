# Calendar Merger Design

Absorb the calendar view from obsidian-calendar into periodic-notes. The calendar is a navigation view for periodic notes; ~50% of its codebase duplicates periodic-notes functionality.

Reference: GitHub issue #66.

## Decisions

| Decision                     | Answer                                                         |
| ---------------------------- | -------------------------------------------------------------- |
| Dots / ICalendarSource       | Drop entirely                                                  |
| `calendar:open` event        | Drop entirely                                                  |
| Confirmation dialog          | Drop — click creates note directly                             |
| Calendar settings            | All redundant with periodic-notes settings, drop               |
| Month/year headers           | Clickable to open/create monthly & yearly notes (when enabled) |
| Hover preview + context menu | Keep                                                           |
| View type                    | Keep `"calendar"` for layout compatibility                     |
| Styles                       | Merge into periodic-notes' `styles.css`                        |
| Note creation                | Swap to `openPeriodicNote()`                                   |
| Calendar deprecation         | Out of scope                                                   |
| Approach                     | Hybrid — port then refactor (C)                                |

## What moves

Port into `src/calendar/`:

- `Calendar.svelte` — root component, remove heartbeat and source/metadata plumbing
- `Nav.svelte` — prev/next arrows, month title
- `Day.svelte` — day cell, strip dots, keep click/hover/context menu, swap to `openPeriodicNote`
- `WeekNum.svelte` — same treatment as Day
- `Arrow.svelte` — SVG chevron
- `Month.svelte` — month/year header, wire clicks to `openPeriodicNote("month")` / `openPeriodicNote("year")`
- `context.ts` — DISPLAYED_MONTH symbol
- `types.ts` — `IWeek`, `IMonth` only
- `utils.ts` — `getMonth`, `getDaysOfWeek`, `isWeekend`
- `fileStore.ts` — thin wrapper around periodic-notes cache
- `view.ts` — CalendarView (ItemView)

## What's dropped

- `Dots.svelte`, `Dot.svelte`, `MetadataResolver.svelte`
- `ICalendarSource`, `wordCountSource`, `word-count.ts`, `sources.ts`
- `calendar:open` event
- `ConfirmationModal` / `createConfirmationDialog`
- `src/periodic-notes/` (5 files) — replaced by direct imports
- `obsidian-internals.ts` — private API reads no longer needed
- `settings.ts` / `validate-settings.ts` / `stores.ts` — calendar settings
- `io/notes.ts` — `tryToCreateDailyNote` / `tryToCreateWeeklyNote`
- `fileMenu.ts`

## Integration points

### Plugin lifecycle (main.ts)

- `registerView(VIEW_TYPE_CALENDAR, (leaf) => new CalendarView(leaf))`
- Commands: `show-calendar`, `reveal-active-note`
- No new ribbon icon

### CalendarView → periodic-notes API

| Calendar action        | Calls                                                                         |
| ---------------------- | ----------------------------------------------------------------------------- |
| Click day cell         | `plugin.openPeriodicNote("day", date)`                                        |
| Click week number      | `plugin.openPeriodicNote("week", date)`                                       |
| Click month header     | `plugin.openPeriodicNote("month", date)`                                      |
| Click year header      | `plugin.openPeriodicNote("year", date)`                                       |
| Hover day/week         | `link-hover` event with path from `plugin.getPeriodicNote(granularity, date)` |
| Right-click            | Standard Obsidian file context menu                                           |
| Highlight current note | `plugin.findInCache(activeFile.path)`                                         |

### fileStore.ts (phase 1)

Thin view-model layer:

1. Subscribes to periodic-notes cache via vault events + `periodic-notes:settings-updated`
2. Calls `plugin.getPeriodicNote("day", date)` per cell to determine `has-note` styling
3. Same for week numbers if `week.enabled`
4. Exposes a reactive store for Calendar component

### Settings

No new settings. Calendar respects existing periodic-notes config:

- Granularity `enabled` flags control which cells are interactive
- Format strings, folders, locale, week start all read from existing config
- `moment.locale()` configured globally by periodic-notes handles week start

## Component behavior

### Day cell states

- `has-note`: `plugin.getPeriodicNote("day", date) !== null`
- `is-active`: matches currently open file
- `is-today`: `date.isSame(moment(), "day")`
- `is-adjacent-month`: outside displayed month

### Navigation

- Arrows increment/decrement displayed month
- Reset button returns to current month
- `reveal-active-note` command sets displayed month to active file's date

### Active file tracking

CalendarView listens to `file-open`. Calls `plugin.findInCache(file.path)` to highlight the matching cell and optionally navigate to its month.

### Granularity guards

Month/year headers only clickable when those granularities are enabled. Week numbers only render if `week.enabled`. Day cells always interactive.

## Phasing

### Phase 1 — Port (one PR)

New files:

```
src/calendar/
  view.ts
  Calendar.svelte
  Nav.svelte
  Day.svelte
  WeekNum.svelte
  Month.svelte
  Arrow.svelte
  context.ts
  types.ts
  utils.ts
  fileStore.ts
```

Modified: `src/main.ts`, `src/obsidian.d.ts`, `styles.css`.

Port existing calendar tests for `utils.ts` into periodic-notes test suite. No new tests beyond that.

Goal: working calendar view using periodic-notes API. Code recognizably from calendar plugin with dropped features stripped and API calls rewired.

### Phase 2 — Refactor (separate PR)

Candidates:

- `fileStore.ts` — may collapse into direct cache reads
- `utils.ts` — deduplicate `isMetaPressed`
- `types.ts` — may merge into periodic-notes `types.ts`
- `Day.svelte` / `WeekNum.svelte` — shared logic extraction
- Component prop drilling simplification

Scope determined after phase 1 ships.

## Edge cases

- **Both plugins loaded**: last-write-wins on `"calendar"` view type. Deprecation notice (out of scope) warns users.
- **Empty state**: calendar renders normally, cells just lack `has-note` styling. Clicking creates the note.
- **Performance**: ~40 `getPeriodicNote()` calls per render (O(n) each). Fine for typical vault sizes. Batch optimization candidate for phase 2 if needed.
