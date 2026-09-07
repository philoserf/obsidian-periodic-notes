# CLAUDE.md

Guidance for the Svelte 5 sidebar calendar in `src/calendar/`.

## Calendar View

- Svelte 5 components mounted in an Obsidian `ItemView` sidebar panel
- **Reactivity bridge**: `CalendarView` communicates to Svelte via exported functions (`tick()`, `setActiveFilePath()`); Svelte communicates back via callback props (`onHover`, `onClick`, `onContextMenu`)
- **FileMap pattern**: `Calendar.svelte` pre-computes one `Map<string, TFile | null>` per rendered month via `computeFileMap()`; child components do `$derived` lookups into it, keyed by `canonicalKey()` from `src/cacheSearch.ts`
- **CalendarStore**: `$state` version counter in `calendarStore.svelte.ts`; bumped on vault/metadata events and read as `void fileStore.version` inside a `$derived.by` in `Calendar.svelte`, which is the whole subscription
- **Enabled signals differ by granularity, deliberately**: month and year read presence in the FileMap; day cells take an explicit `dayEnabled` prop, because `Day.svelte` needs an absent key and a `null` value to mean different things. See THEORY.md before unifying them
