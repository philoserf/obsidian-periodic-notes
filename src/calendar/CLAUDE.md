# CLAUDE.md

Guidance for the Svelte 5 sidebar calendar in `src/calendar/`.

## Calendar View

- Svelte 5 components mounted in an Obsidian `ItemView` sidebar panel
- **Reactivity bridge**: `CalendarView` communicates to Svelte via exported functions (`tick()`, `setActiveFilePath()`); Svelte communicates back via callback props (`onHover`, `onClick`, `onContextMenu`)
- **FileMap pattern**: Single subscription in `Calendar.svelte` pre-computes a `Map<string, TFile | null>` via `computeFileMap()`. Child components do `$derived` lookups via `fileMapKey()`
- **CalendarStore**: `$state` version counter in `calendarStore.svelte.ts`; bumped on vault/metadata events, read inside `$effect` in `Calendar.svelte` to re-derive the FileMap
