# Changelog

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
