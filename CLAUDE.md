# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Obsidian plugin to create and manage daily, weekly, monthly, and yearly notes. Built with Svelte 5 (calendar only) and Vite.

The current next step for this repo is tracked in the workspace backlog at `../NEXT.md` (the `obsidian-periodic-notes` row). Read it when starting work; update it when that step ships.

## Architecture

### Build System

- **Output**: `./main.js` (CommonJS format, tracked in git)
- Vite outputs to project root (`outDir: "."`) with `emptyOutDir: false` — never change this
- Only the default export from `main.ts` — no named exports (vite output.exports: "default")

### Settings

- `plugin.settings` is a plain `Settings` object (not a Svelte store)
- No migration — if saved data doesn't match v2 shape, defaults are used
- Native Obsidian `Setting` API in `settings.ts` — no Svelte in settings

### Cache

- `canonicalKey`: `${granularity}:${date.startOf(granularity).toISOString()}`
- `getPeriodicNote` is O(1) via byKey lookup; `findAdjacent` is O(log n) warm, O(m log m) cold rebuild (m = entries in one granularity)
- Resolves files by exact filename format or frontmatter — no loose/date-prefix matching
- `periodic-notes:resolve` fires after the entry is indexed and — on the create path — after the template has been applied, so listeners may read file contents

### Testing

- `bunfig.toml` preload (`src/test-preload.ts`) provides `window.moment` globally
- Pure modules — import directly in tests: `format.ts`, `paths.ts`, `settingsLoad.ts`, `cacheResolve.ts`, `cacheFrontmatter.ts`, `cacheIndex.ts`, `cacheSearch.ts`, `templateRender.ts`, `calendar/store.ts`, `calendar/utils.ts`
- Modules that CANNOT be imported in tests (import obsidian at top level): `cache.ts`, `template.ts`, `settings.ts`, `platform.ts`, `main.ts`, `commands.ts`

### Release Process

Use the `obsidian-release-gate` then `obsidian-release-ship` skills — do not tag by hand.
