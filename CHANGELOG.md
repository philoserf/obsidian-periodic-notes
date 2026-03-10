# Changelog

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
