# Changelog

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
