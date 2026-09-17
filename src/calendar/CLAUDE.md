# CLAUDE.md

Guidance for the Svelte 5 sidebar calendar in `src/calendar/`.

## Calendar View

- Svelte 5 components mounted in an Obsidian `ItemView` sidebar panel
- **Reactivity bridge**: `CalendarView` communicates to Svelte via exported functions (`tick()`, `setActiveFilePath()`); Svelte communicates back via callback props (`onHover`, `onClick`, `onContextMenu`)
- **FileMap pattern**: `Calendar.svelte` pre-computes one `Map<string, TFile | null>` per rendered month via `computeFileMap()`; child components do `$derived` lookups into it, keyed by `canonicalKey()` from `src/cacheSearch.ts`. The map is **total** — every key the visible grid can ask about is present — so a lookup answers exactly one question: is there a note for this period
- **CalendarStore**: `$state` version counter in `calendarStore.svelte.ts`; bumped on vault/metadata events and read as `void fileStore.version` inside a `$derived.by` in `Calendar.svelte`, which is the whole subscription
- **Enabled is an explicit prop everywhere but the week column**: `Calendar.svelte` derives `dayEnabled`, `monthEnabled` and `yearEnabled` from one list and passes them down — month and year through `Nav`. Month and year used to read presence in the FileMap instead, which made one lookup carry two facts; that is gone, and with it the trap where collapsing "absent" and "null" would have cost `Day.svelte` its has-note dot
- **The week column is the deliberate exception**: it stays a conditional render, `{#if showWeeks}`, because a disabled week column should occupy no table cell at all — whereas a disabled month title still renders its label, without the `clickable` class, `role="button"` or tab stop
