# CLAUDE.md

## Project Overview

Obsidian plugin to create and manage daily, weekly, monthly, quarterly, and yearly notes. Built with Svelte 5 and Vite.

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
bun run validate         # Full validation: types, checks, build, verify main.js + manifest.json + styles.css exist
bun run version          # Sync package.json version to manifest.json + versions.json
bun test                 # Run tests
```

## Architecture

### Source Structure

- `src/calendar/` — Svelte 5 sidebar calendar (see below)
- `src/settings/` — Settings UI with validation, localization, and page-based layout
- `src/switcher/` — Quick switcher and related-files switcher
- `src/ui/` — Shared UI components (file suggest)

### Build System

- **Build tool**: Vite with @sveltejs/vite-plugin-svelte
- **Entry point**: `src/main.ts`
- **Output**: `./main.js` (CommonJS format, tracked in git)
- **Externals**: `obsidian`, `electron`, `fs`, `os`, `path` are not bundled
- **Path alias**: `src` resolves to `src/` directory
- Vite outputs to project root (`outDir: "."`) with `emptyOutDir: false` — never change this

### Calendar View (`src/calendar/`)

- Svelte 5 components mounted in an Obsidian `ItemView` sidebar panel
- **Reactivity bridge**: `CalendarView` (TypeScript) communicates to Svelte via exported functions (`tick()`, `setActiveFilePath()`); Svelte communicates back via callback props (`onHover`, `onClick`, `onContextMenu`)
- **FileMap pattern**: Single subscription in `Calendar.svelte` pre-computes a `Map<string, TFile | null>` via `computeFileMap()`. Child components do `$derived` lookups via `fileMapKey()` — no per-cell subscriptions
- **Event filtering**: `fileStore.bump()` checks `isPeriodic()` before notifying subscribers; `bumpUnconditionally()` handles events that always matter (`resolve`, `settings-updated`)
- **Store bridge**: `$derived.by()` does NOT track Svelte store auto-subscriptions — must use `$state` + `$effect` + `.subscribe()`

### Testing

- `bunfig.toml` preload (`src/test-preload.ts`) provides `window.moment` globally
- Test files re-implement pure functions to avoid `obsidian` imports
- Modules that cannot be imported in tests: `cache.ts`, `utils.ts`, `settings/validation.ts`

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
