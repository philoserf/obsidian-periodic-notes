# CLAUDE.md

## Project Overview

Obsidian plugin to create and manage daily, weekly, monthly, and yearly notes. Built with Svelte 5 (calendar only) and Vite.

## Development Commands

```bash
bun install              # Install dependencies
bun run dev              # Watch mode with auto-rebuild
bun run build            # Production build (runs check first)
bun run check            # Run all checks (typecheck + biome + svelte-check)
bun run typecheck        # TypeScript type checking only
bun run lint             # Biome lint + format check
bun run lint:fix         # Auto-fix lint and format issues
bun run format           # Format code with Biome
bun run version          # Sync package.json version to manifest.json + versions.json
bun test                 # Run tests
```

## Architecture

### Source Structure

- `src/main.ts` — Plugin lifecycle, settings load/save, ribbon, commands
- `src/settings.ts` — Native Obsidian `Setting` API settings tab
- `src/cache.ts` — Obsidian-coupled orchestration: vault/metadata events, resolve logic, template-apply trigger (depends on obsidian)
- `src/cacheIndex.ts` — Pure dual-index state (byPath + byKey) with dirty-flag sorted-key cache (directly testable)
- `src/cacheSearch.ts` — Pure cache helpers: `canonicalKey` and `findAdjacentKey` binary search (directly testable)
- `src/template.ts` — Template I/O: reading from vault, applying to file, creating notes (depends on obsidian)
- `src/templateRender.ts` — Pure template token replacement (directly testable)
- `src/format.ts` — Pure functions: format helpers, validation, path utils (directly testable)
- `src/commands.ts` — Command factory + context menu
- `src/constants.ts` — All constants (DEFAULT_FORMAT, WEEKDAYS, VIEW_TYPE_CALENDAR, etc.)
- `src/types.ts` — All shared types (Granularity, NoteConfig, Settings, CacheEntry)
- `src/platform.ts` — Platform detection helpers (isMetaPressed)
- `src/icons.ts` — SVG icon data
- `src/fileSuggest.ts` — File and folder autocomplete suggests
- `src/calendar/` — Svelte 5 sidebar calendar (see below)

### Build System

- **Build tool**: Vite with @sveltejs/vite-plugin-svelte
- **Entry point**: `src/main.ts`
- **Output**: `./main.js` (CommonJS format, tracked in git)
- **Externals**: `obsidian`, `electron`, `fs`, `os`, `path` are not bundled
- **Path alias**: `src` resolves to `src/` directory
- Vite outputs to project root (`outDir: "."`) with `emptyOutDir: false` — never change this
- Only the default export from `main.ts` — no named exports (vite output.exports: "default")

### Settings

- `plugin.settings` is a plain `Settings` object (not a Svelte store)
- Settings shape: `{ granularities: Record<Granularity, NoteConfig> }`
- Four granularities: day, week, month, year
- No migration — if saved data doesn't match v2 shape, defaults are used
- Native Obsidian `Setting` API in `settings.ts` — no Svelte in settings

### Cache

- `CacheIndex` (pure) owns the dual-index state: `byPath` (filePath → CacheEntry) and `byKey` (canonicalKey → CacheEntry), plus a per-granularity sorted-key cache with dirty-flag invalidation
- `NoteCache` (Obsidian-coupled) wraps a `CacheIndex` and adds vault/metadata event wiring, resolve/rename/delete handling, and template application
- `canonicalKey`: `${granularity}:${date.startOf(granularity).toISOString()}`
- `getPeriodicNote` is O(1) via byKey lookup; `findAdjacent` is O(log n) warm, O(m log m) cold rebuild (m = entries in one granularity)
- Resolves files by exact filename format or frontmatter — no loose/date-prefix matching
- `CacheEntry`: filePath, date, granularity, match ("filename" | "frontmatter")

### Calendar View (`src/calendar/`)

- Svelte 5 components mounted in an Obsidian `ItemView` sidebar panel
- **Reactivity bridge**: `CalendarView` communicates to Svelte via exported functions (`tick()`, `setActiveFilePath()`); Svelte communicates back via callback props (`onHover`, `onClick`, `onContextMenu`)
- **FileMap pattern**: Single subscription in `Calendar.svelte` pre-computes a `Map<string, TFile | null>` via `computeFileMap()`. Child components do `$derived` lookups via `fileMapKey()`
- **Store bridge**: `$derived.by()` does NOT track Svelte store auto-subscriptions — must use `$state` + `$effect` + `.subscribe()`
- **CalendarStore**: Counter-bump `Writable<number>` as notification mechanism

### Testing

- `bunfig.toml` preload (`src/test-preload.ts`) provides `window.moment` globally
- Pure modules — import directly in tests: `format.ts`, `cacheIndex.ts`, `cacheSearch.ts`, `templateRender.ts`, `calendar/store.ts` (pure parts), `calendar/utils.ts`
- Modules that CANNOT be imported in tests (import obsidian at top level): `cache.ts`, `template.ts`, `settings.ts`, `platform.ts`, `main.ts`, `commands.ts`

### Deploy to Local Vault

Copies build artifacts to the local Obsidian vault plugin directory:

```bash
bun run build && bun run deploy
```

### Release Process

Tag and push to trigger the GitHub Actions release workflow:

```bash
git tag -a X.Y.Z -m "Release X.Y.Z"
git push origin X.Y.Z
```

## Code Style

Enforced by Biome: 2-space indent, organized imports, git-aware VCS integration.
