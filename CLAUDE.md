# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Obsidian plugin to create and manage daily, weekly, monthly, and yearly notes. Built with Svelte 5 (calendar only) and Vite.

The current next step for this repo is tracked in the workspace backlog at `../NEXT.md` (the `obsidian-periodic-notes` row). Read it when starting work; update it when that step ships.

## Architecture

### Build System

- **Output**: `./main.js` (CommonJS format, gitignored — `release.yml` builds the bundle it publishes, so the committed copy was only ever diffed against a fresh build of the same source)
- Vite outputs to project root (`outDir: "."`) with `emptyOutDir: false` — never change this
- Only the default export from `main.ts` — no named exports (vite output.exports: "default")

### Settings

- `plugin.settings` is a plain `Settings` object (not a Svelte store)
- No migration — if saved data doesn't match v2 shape, defaults are used
- Native Obsidian `Setting` API in `settings.ts` — no Svelte in settings

### Cache

- `canonicalKey`: `${granularity}:${date.startOf(granularity).toISOString()}`
- `getPeriodicNote` is O(1) via byKey lookup; `findAdjacent` is O(m log m) — it builds and sorts the keys for one granularity where it uses them (m = entries in that granularity)
- Resolves files by exact filename format or frontmatter — no loose/date-prefix matching
- `periodic-notes:resolve` fires after the entry is indexed and — on the create path — after the template has been applied, so listeners may read file contents

### Testing

- `bunfig.toml` preload (`src/test-preload.ts`) provides `window.moment` globally
- **A module can be imported directly in a test unless it imports a _value_ from `obsidian`** — `import type` does not count, since it is erased. Read the module's import block; the ones that cannot be imported are the wiring half of each core/wiring pair. This replaced two hand-maintained inventories that had drifted three ways at once
- Test files are typechecked (`tsconfig.json` has no `exclude`, and `types` includes `bun`), so a stale call signature in a test is a build failure rather than a surprise at runtime

### Release Process

Use the `release-gate` then `release-ship` skills — do not tag by hand. `release-ship` is user-invoked.
