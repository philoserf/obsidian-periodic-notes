# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Obsidian plugin to create and manage daily, weekly, monthly, and yearly notes. Built with Svelte 5 (calendar only) and Vite.

The current next step for this repo is tracked in the workspace backlog at `../NEXT.md` (the `obsidian-periodic-notes` row). Read it when starting work; update it when that step ships.

## Architecture

### Build System

- **Output**: `./main.js` (CommonJS format). Gitignored build output: `bun run build` ends with `deploy.ts`, which copies `main.js`, `manifest.json` and `styles.css` to `OBSIDIAN_DEPLOY_DEST` from `.env.local`, or does nothing when it is unset. A release attaches a fresh build. Tracked until 2026-10-28 (#307 untracked it, #327 restored it to match the template's CI, which is gone)
- **Two TypeScripts are installed on purpose.** `@typescript/native` (TS 7) is what `svelte-check --tsgo` loads, and the editor's language server with it (`typecheck` is `bun --check`, not `bun check`, which would run the `check` script and loop); `svelte-check`'s peer range is `typescript ^5 || ^6`, so a transitive `typescript@6` sits beside it for svelte-check alone. Do not remove either
- Vite outputs to project root (`outDir: "."`) with `emptyOutDir: false` — setting it to `true` would make Vite empty the repository root on every build

### Settings

- `plugin.settings` is a plain `Settings` object (not a Svelte store)
- No migration — `sanitizeSettings` (`src/settingsLoad.ts`) type-checks each saved field and falls back to that field's own default; only saved data without a `granularities` object gets all defaults
- Declarative settings (Obsidian 1.13, hence `minAppVersion`): `src/settingsDefinitions.ts` builds the tab as data — one page per period, its entry showing the format and folder and a warning when the folder or template is missing — and is tested as data. `settings.ts` is the wiring: the vault checks, and `getControlValue`/`setControlValue` keyed `week.format` and so on. Every write goes through `sanitizeSettings`, so a control stores what a reload would produce. A save and an external change (`onExternalSettingsChange`, e.g. Obsidian Sync rewriting `data.json`) both end in `applySettings` in `main.ts`, which rescans the cache only when `indexingSnapshotOf` (`settingsLoad.ts`) moved. No Svelte in settings

### Cache

- `canonicalKey`: `${granularity}:${date.startOf(granularity).toISOString()}`
- `getPeriodicNote` is O(1) via byKey lookup; `findAdjacent` is O(m log m) — it builds and sorts the keys for one granularity where it uses them (m = entries in that granularity)
- Resolves files by exact filename format or frontmatter — no loose/date-prefix matching
- `periodic-notes:resolve` fires after the entry is indexed and — on the create path — after the template has been applied, so listeners may read file contents

### CLI

- `periodic-notes:create` (`main.ts`'s `createFromCli`) is a ribbon click without the open: cache lookup, then `createPeriodicNote`, so a CLI-made note gets the template exactly as a clicked one does. It prints the path or `error: <reason>` and raises no Notice. Flag checking is `parseCreateRequest` in `cli.ts`, kept free of `obsidian` imports so it can be tested
- The vault's periodic skills and `sky` call it instead of creating journal files themselves

### Testing

- `bunfig.toml` preload (`src/test-preload.ts`) provides `window.moment` globally
- **A module can be imported directly in a test unless it imports a _value_ from `obsidian`** — `import type` does not count, since it is erased. Read the module's import block; the ones that cannot be imported are the wiring half of each core/wiring pair
- Test files are typechecked (`tsconfig.json` has no `exclude`, and `types` includes `bun`), so a stale call signature in a test is a build failure rather than a surprise at runtime

### Release Process

Use the `release-gate` then `release-ship` skills — do not tag by hand. `release-ship` is user-invoked.
