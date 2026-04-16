# Changelog

## 2.1.1

### Fixed

- `openPeriodicNote` now catches rejections internally and surfaces them as a `Notice` naming the granularity and formatted date; previously, failures in template read, vault create, or folder create were silent across five fire-and-forget call sites (ribbon, commands, calendar, adjacent navigation)

### Changed

- Extracted a local `navCommand` helper in `commands.ts` to remove the duplicated `checkCallback` gating across four navigation commands
- Calendar `FileMap` now keys on `canonicalKey` (ISO-based) instead of a separate `fileMapKey` (format-based); unifies the single "granularity + date → key" concept and deletes the redundant helper

### Dependencies

- Bump `svelte` 5.55.1 → 5.55.4, `vite` 8.0.3 → 8.0.8, `@biomejs/biome` 2.4.10 → 2.4.12, `@types/bun` 1.3.11 → 1.3.12, `@types/node` 25.5.2 → 25.6.0

### Documentation

- Expanded `README.md` with features, usage, settings, and template-token reference
- Regenerated `walkthrough.md`

## 2.1.0

### Fixed

- Calendar dot now clears immediately when a periodic note is deleted (previously required navigating away and back)
- Calendar dot now clears immediately when a periodic note is renamed to a non-periodic path

### Performance

- `findAdjacent` (next/previous navigation) is now O(log n) on warm calls and O(m log m) on cold rebuilds, down from O(n log n) per call — benefit scales with vault size
- Cache invalidation is skipped when `set()` would write the same canonical key (e.g., metadata changes on already-indexed notes)
- Template rendering regex patterns hoisted to module-level constants

### Changed

- Calendar fully migrated to Svelte 5 runes; legacy `Writable<number>` counter-bump store and context `Writable<Moment>` replaced with `$state`-backed classes
- Extracted pure logic into directly testable modules: `cacheIndex.ts`, `cacheSearch.ts`, `templateRender.ts`
- Test coverage expanded from 61 to 86 tests, including direct coverage of cache dual-index invariants

### Removed

- `plugin.getPeriodicNotes()` — leftover from the v1.x switcher feature, no internal callers, not declared as public API

### Documentation

- Added `THEORY.md` explaining the architecture
- Regenerated `walkthrough.md`

### CI

- Bumped `softprops/action-gh-release` to v3

## 2.0.1

### Fixed

- Add missing parameters to `periodic-notes:resolve` event type
- Append path separator in cache folder prefix check
- Replace nested SVG wrapper with `<g>` in calendarYearIcon

### Performance

- Debounce settings text field saves

### Changed

- Remove unused sass devDependency
- CI workflow updates
- Bump @types/node to 25.5.2

## 2.0.0

### Breaking Changes

- Drop quarter granularity — only day, week, month, year remain
- Drop openAtStartup setting
- Drop getting-started banner
- Drop legacy daily-notes plugin migration code
- Drop loose/date-prefixed file matching — only exact filename format and frontmatter matching
- Drop localization settings UI (locale and week-start pickers) — app locale is respected automatically
- Restructure settings shape — existing settings are reset to defaults on first load
- Remove `svelte-writable-derived` dependency

### Improvements

- Replace Svelte settings UI with native Obsidian Setting API — simpler, smaller bundle
- Add secondary cache index for O(1) note lookups (was linear scan)
- Split utils.ts into focused modules: `format.ts` (pure, testable) and `template.ts`
- Plugin settings are now a plain object instead of a Svelte store
- Svelte is now only used for the calendar sidebar
- Bundle size reduced from 94 KB to 70 KB (25% reduction)

### Refactoring

- Rename: `PeriodicNotesCache` → `NoteCache`, `CalendarFileStore` → `CalendarStore`
- Rename: `IWeek` → `Week`, `IMonth` → `Month`, `IEventHandlers` → `EventHandlers`
- Rename: `WeekNum.svelte` → `Week.svelte`, `fileStore.ts` → `store.ts`
- Absorb `modal.ts` into `commands.ts` as `showContextMenu`
- Absorb `calendar/constants.ts` and `calendar/context.ts` into `src/constants.ts`
- Move `fileSuggest.ts` from `src/ui/` to `src/`
- Delete `parser.ts` (loose matching removed)
- Delete entire `src/settings/` directory (replaced by native `settings.ts`)
- Simplify `obsidian.d.ts` to workspace event types only

## 1.5.0

### Bug Fixes

- Fix stale cache entries after deleting periodic notes (#86)
- Fix nested folder creation in ensureFolderExists (#88)
- Fix frontmatter parsing ignoring user-configured date format (#87)
- Fix case-sensitive Moment.js token validation in format complexity check (#84)
- Fix setIcon race condition in settings Arrow.svelte (#82)
- Consolidate asymmetric template path guard in getTemplateContents (#89)

### Refactoring

- Extract shared WEEKDAYS constant, eliminating duplication across three files (#91)
- Replace duplicate KEY_FORMATS with shared DEFAULT_FORMAT constant (#78)
- Remove unused \_app parameter from showFileMenu (#92)
- Remove redundant this.plugin assignment in PeriodicNotesSettingsTab (#83)

### Documentation

- Add inline comments explaining store counter and subscription bridge patterns (#90)

## 1.4.0

### Features

- Update repository settings configuration

### Bug Fixes

- Guard against null systemLang in configureGlobalMomentLocale

### Chores

- Normalize manifest.json field order
- Update dev dependencies (@biomejs/biome, @types/node)
- Add vite.config.ts to biome includes

### Documentation

- Update LICENSE to MIT with current copyright

## 1.3.0

### Breaking Changes

- Remove quick switcher and related-files switcher feature (#73)
- Remove NLDates (Natural Language Dates) plugin dependency (#73)

### Bug Fixes

- Fix suggestion selection not saving folder and template values

### Security

- Update vite, svelte, and vite-plugin-svelte to resolve vulnerabilities

### Documentation

- Regenerate walkthrough after switcher removal

## 1.2.0

### Features

- Add calendar sidebar view ported from obsidian-calendar-plugin (#66, #67)
- Calendar shows day cells with note indicators, week numbers, month/year headers
- Click to open or create periodic notes; context menu to delete
- Keyboard accessible day, week, month, and year cells

### Performance

- Replace 48 per-cell store subscriptions with single FileMap derivation (#68)
- Filter non-periodic vault events in fileStore to skip irrelevant re-renders (#68)
- Separate month grid computation from file-store subscription (#68)

### Refactoring

- Extract `fileMapKey()` helper to centralize map key formats (#68)
- Use locale-aware week key format (`gggg-[W]ww`) instead of ISO (#68)
- Replace 6 Month.svelte handlers with `makeHandlers()` factory (#68)
- Add `getEnabledGranularities()` to batch settings reads (#68)
- Split `bump()` into filtered and unconditional variants for correct event routing (#68)

## 1.1.1

### Bug Fixes

- Add `[Periodic Notes]` prefix to template error log for consistent filtering (#52)
- Fix day fallback suggestion using wrong granularity for relative date label (#47)
- Return NaN for invalid day in `getDayOfWeekNumericalValue` (#44)
- Use correct granularity in `getTemplateContents` error message (#53)

### Refactoring

- Narrow `setConfig` value type from `any` to `VaultSettings[T]` (#49)
- Centralize test global mocks via Bun preload, eliminating per-file boilerplate (#51)
- Replace switcher query-to-granularity conditionals with declarative lookup (#47)
- Remove dead `installedVersion` setting
- Clamp invalid day index to 0 per PR feedback

### Documentation

- Document private API access pattern for `SuggestModal.chooser` (#50)

## 1.1.0

### Bug Fixes

- Clamp invalid `weekStart` index to 0 instead of passing -1 to moment
- Catch rejected promises from async template application (#20)
- Include file path in template failure notice for easier debugging

### Refactoring

- Add fallbacks for private API usage (`vault.getConfig`, `moment.localeData()._week`) (#15, #16, #23)
- Add `console.debug` logging to private API fallback paths
- Extract shared `replaceGranularityTokens` helper to consolidate token replacement
- Rename `monthStart` to `periodStart` in quarter/year transforms for clarity

### Tests

- Expand test coverage for cache, parser, validation, settings, and localization modules (#22)
- Add week branch and time token coverage for template transforms
- Fix and strengthen test assertions for granularity filtering

## 1.0.1

### Bug Fixes

- Replace unsafe type casts of `getAbstractFileByPath` results with `instanceof` guards (#24)
- Evict stale cache entries when files no longer resolve, continue lookup loop for remaining matches
- Add null guard on `inputEl` in Svelte `$effect` blocks to prevent runtime errors before DOM mount (#28)

### Refactoring

- Remove lodash dependency; replace `memoize`, `sortBy`, and `capitalize` with native alternatives (#26)
- Extract shared `capitalize` utility into `src/utils.ts`

### CI

- Add `bun audit` step for dependency security scanning (#27)
- Add test coverage reporting via `bun test --coverage` (#25)

### Chores

- Bump svelte 5.53.7 → 5.53.9, @types/node 25.3.5 → 25.4.0

## 1.0.0

Initial release. Create and manage daily, weekly, monthly, quarterly, and yearly notes in Obsidian.
