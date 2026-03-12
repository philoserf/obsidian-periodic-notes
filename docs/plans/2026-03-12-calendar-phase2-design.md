# Calendar Phase 2 Refactor Design

**Goal:** Optimize the calendar view's reactivity pipeline and clean up handler duplication.

**Context:** Phase 1 (PR #67) ported the calendar view from obsidian-calendar into periodic-notes. The port is functional but has three performance/quality issues inherited from the original or introduced during the Svelte 5 migration.

## 1. Derived file map (subscription fan-out)

**Problem:** 48+ components (42 Day cells, up to 6 WeekNum cells, Month) each independently subscribe to `fileStore.store` and call `fileStore.getFile()`, which does a cache lookup per cell per bump. Every vault event triggers 48+ cache scans.

**Solution:** `fileStore` gains a `computeFileMap(month, enabledGranularities)` method that returns a `Map<string, TFile | null>` keyed by format strings like `"day:YYYY-MM-DD"`, `"week:YYYY-[W]WW"`, `"month:YYYY-MM"`, `"year:YYYY"`. `Calendar.svelte` subscribes once, computes the map, and passes it down as a prop. Child components do a simple `map.get(key)` lookup with no subscriptions and no cache scans.

**Key type:**

```typescript
type FileMap = Map<string, TFile | null>;
```

**Impact:** 48 subscriptions become 1. 48 cache scans per bump become 1 batch computation.

## 2. Vault event filtering

**Problem:** `bump()` fires on every vault create/delete/rename and every metadataCache change, regardless of whether the file is a periodic note. Most vault activity is irrelevant to the calendar.

**Solution:** `bump(file?)` checks `plugin.isPeriodic(filePath)` before incrementing the counter. Events without a file arg (`settings-updated`, `resolve`) bump unconditionally since they are always relevant.

**Edge case:** `rename` passes `(file, oldPath)`. We check both paths since renaming into or out of a periodic note pattern both matter. This requires a separate `onRename` callback.

```typescript
private bump(file?: TAbstractFile | string): void {
  if (file) {
    const path = typeof file === "string" ? file : file.path;
    if (!this.plugin.isPeriodic(path)) return;
  }
  this.store.update((n) => n + 1);
}

private onRename(file: TAbstractFile, oldPath: string): void {
  if (this.plugin.isPeriodic(file.path) || this.plugin.isPeriodic(oldPath)) {
    this.store.update((n) => n + 1);
  }
}
```

## 3. Month.svelte handler factory

**Problem:** 6 near-identical handler functions (`handleMonthClick`, `handleMonthHover`, `handleMonthContext`, `handleYearClick`, `handleYearHover`, `handleYearContext`) differ only in granularity and which file/enabled flag they reference.

**Solution:** A `makeHandlers(granularity, getEnabled, getFile)` factory function returns `{ click, hover, context }`. Called twice for `"month"` and `"year"`, cutting 6 handlers to 1 factory + 2 calls.

```typescript
function makeHandlers(
  granularity: Granularity,
  getEnabled: () => boolean,
  getFile: () => TFile | null,
) {
  return {
    click: (event: MouseEvent) => {
      if (getEnabled()) {
        onClick?.(
          granularity,
          $displayedMonth,
          getFile(),
          isMetaPressed(event),
        );
      } else if (granularity === "month") {
        resetDisplayedMonth();
      }
    },
    hover: (event: PointerEvent) => {
      if (!getEnabled() || !event.target) return;
      onHover?.(
        granularity,
        $displayedMonth,
        getFile(),
        event.target,
        isMetaPressed(event),
      );
    },
    context: (event: MouseEvent) => {
      const f = getFile();
      if (getEnabled() && f) {
        onContextMenu?.(granularity, $displayedMonth, f, event);
      }
    },
  };
}

const monthHandlers = makeHandlers(
  "month",
  () => monthEnabled,
  () => monthFile,
);
const yearHandlers = makeHandlers(
  "year",
  () => yearEnabled,
  () => yearFile,
);
```

## Ordering

1. Derived file map (highest impact — eliminates redundant subscriptions and cache scans)
2. Vault event filtering (reduces bump frequency for non-periodic file operations)
3. Month handler factory (code cleanliness, lowest risk)
