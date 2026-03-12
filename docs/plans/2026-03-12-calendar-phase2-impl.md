# Calendar Phase 2 Refactor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Optimize the calendar view's reactivity pipeline — eliminate per-cell subscription fan-out, filter irrelevant vault events, and clean up handler duplication.

**Architecture:** A single subscription in `Calendar.svelte` pre-computes a `FileMap` from `fileStore` on each bump and passes it down as a prop. `fileStore.bump()` checks `plugin.isPeriodic()` to skip non-periodic file events. `Month.svelte` uses a factory function to generate handlers for each granularity.

**Tech Stack:** TypeScript, Svelte 5 (runes), Obsidian API, Bun (test runner), Biome (linter)

---

### Task 1: Add `FileMap` type and `computeFileMap` method to fileStore

**Files:**

- Modify: `src/calendar/fileStore.ts:1-44`
- Modify: `src/calendar/types.ts:1-32`
- Test: `src/calendar/fileStore.test.ts` (create)

**Step 1: Write the failing test**

Create `src/calendar/fileStore.test.ts`:

```typescript
import { describe, expect, it } from "bun:test";
import moment from "moment";

import { computeFileMap } from "./fileStore";
import type { IMonth } from "./types";
import { getMonth } from "./utils";

describe("computeFileMap", () => {
  it("generates keys for all 42 days in the month grid", () => {
    const month = getMonth(moment("2024-03-01"));
    const getFile = () => null;
    const map = computeFileMap(month, getFile, []);
    // 42 day keys
    const dayKeys = [...map.keys()].filter((k) => k.startsWith("day:"));
    expect(dayKeys).toHaveLength(42);
  });

  it("generates week keys for all 6 weeks when week is enabled", () => {
    const month = getMonth(moment("2024-03-01"));
    const getFile = () => null;
    const map = computeFileMap(month, getFile, ["week"]);
    const weekKeys = [...map.keys()].filter((k) => k.startsWith("week:"));
    expect(weekKeys).toHaveLength(6);
  });

  it("generates month and year keys when those granularities are enabled", () => {
    const month = getMonth(moment("2024-03-01"));
    const getFile = () => null;
    const map = computeFileMap(month, getFile, ["month", "year"]);
    expect(map.has("month:2024-03")).toBe(true);
    expect(map.has("year:2024")).toBe(true);
  });

  it("does not generate week/month/year keys when not enabled", () => {
    const month = getMonth(moment("2024-03-01"));
    const getFile = () => null;
    const map = computeFileMap(month, getFile, []);
    const nonDayKeys = [...map.keys()].filter((k) => !k.startsWith("day:"));
    expect(nonDayKeys).toHaveLength(0);
  });

  it("calls getFile with correct granularity and date for each key", () => {
    const month = getMonth(moment("2024-03-01"));
    const calls: Array<{ granularity: string; date: string }> = [];
    const getFile = (date: moment.Moment, granularity: string) => {
      calls.push({ granularity, date: date.format() });
      return null;
    };
    computeFileMap(month, getFile, ["week", "month", "year"]);
    // 42 days + 6 weeks + 1 month + 1 year = 50 calls
    expect(calls).toHaveLength(50);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/calendar/fileStore.test.ts`
Expected: FAIL — `computeFileMap` is not exported from `./fileStore`

**Step 3: Add `FileMap` type to `types.ts`**

In `src/calendar/types.ts`, add at the end:

```typescript
import type { TFile } from "obsidian";

export type FileMap = Map<string, TFile | null>;
```

Note: `TFile` is already imported in `types.ts` for `IEventHandlers`. Just add the `FileMap` export.

**Step 4: Implement `computeFileMap` as an exported pure function in `fileStore.ts`**

Add this exported function at the bottom of `src/calendar/fileStore.ts`:

```typescript
export function computeFileMap(
  month: IMonth,
  getFile: (date: Moment, granularity: Granularity) => TFile | null,
  enabledGranularities: Granularity[],
): FileMap {
  const map: FileMap = new Map();
  const displayedMonth = month[1].days[0];

  for (const week of month) {
    for (const day of week.days) {
      map.set(`day:${day.format("YYYY-MM-DD")}`, getFile(day, "day"));
    }
    if (enabledGranularities.includes("week")) {
      const weekStart = week.days[0];
      map.set(
        `week:${weekStart.format("YYYY-[W]WW")}`,
        getFile(weekStart, "week"),
      );
    }
  }

  if (enabledGranularities.includes("month")) {
    map.set(
      `month:${displayedMonth.format("YYYY-MM")}`,
      getFile(displayedMonth, "month"),
    );
  }
  if (enabledGranularities.includes("year")) {
    map.set(
      `year:${displayedMonth.format("YYYY")}`,
      getFile(displayedMonth, "year"),
    );
  }

  return map;
}
```

Also add the import for `FileMap` from `./types` and `IMonth` from `./types`.

**Step 5: Run test to verify it passes**

Run: `bun test src/calendar/fileStore.test.ts`
Expected: PASS — all 5 tests green

**Step 6: Commit**

```bash
git add src/calendar/fileStore.ts src/calendar/fileStore.test.ts src/calendar/types.ts
git commit -m "feat(calendar): add computeFileMap pure function and FileMap type"
```

---

### Task 2: Wire `Calendar.svelte` to compute and pass `FileMap` down

**Files:**

- Modify: `src/calendar/Calendar.svelte:1-63`
- Modify: `src/calendar/Day.svelte:1-53`
- Modify: `src/calendar/WeekNum.svelte:1-42`

**Step 1: Update `Calendar.svelte` to compute `fileMap`**

Replace the existing `$effect` that subscribes to `fileStore.store` for `showWeekNums` with a single subscription that computes everything:

```typescript
let showWeekNums: boolean = $state(false);
let fileMap: FileMap = $state.raw(new Map());

$effect(() => {
  // Re-derive when displayedMonth changes
  const currentMonth = $displayedMonthStore;
  return fileStore.store.subscribe(() => {
    showWeekNums = fileStore.isGranularityEnabled("week");
    const enabledGranularities = (
      ["week", "month", "year"] as Granularity[]
    ).filter((g) => fileStore.isGranularityEnabled(g));
    fileMap = computeFileMap(
      getMonth(currentMonth),
      (date, granularity) => fileStore.getFile(date, granularity),
      enabledGranularities,
    );
  });
});
```

Add imports for `computeFileMap` from `./fileStore` and `type FileMap` and `type Granularity` from appropriate modules.

**Step 2: Pass `fileMap` instead of `fileStore` to Day and WeekNum**

In `Calendar.svelte` template, change Day props:

```svelte
<Day
  date={day}
  {fileMap}
  {today}
  {activeFilePath}
  {...eventHandlers}
/>
```

Change WeekNum props:

```svelte
<WeekNum
  {fileMap}
  {activeFilePath}
  {...week}
  {...eventHandlers}
/>
```

**Step 3: Update `Day.svelte` to use `fileMap` instead of `fileStore`**

Replace the `fileStore` prop and subscription with a `fileMap` prop and derived lookup:

```typescript
let {
  date,
  fileMap,
  onHover,
  onClick,
  onContextMenu,
  today,
  activeFilePath = null,
}: {
  date: Moment;
  fileMap: FileMap;
  onHover: IEventHandlers["onHover"];
  onClick: IEventHandlers["onClick"];
  onContextMenu: IEventHandlers["onContextMenu"];
  today: Moment;
  activeFilePath: string | null;
} = $props();

let file = $derived(fileMap.get(`day:${date.format("YYYY-MM-DD")}`) ?? null);
```

Remove the `$effect` subscription block and the `$state(null)` for `file`. Add import for `type FileMap` from `./types`.

**Step 4: Update `WeekNum.svelte` to use `fileMap` instead of `fileStore`**

Replace the `fileStore` prop and subscription with:

```typescript
let {
  weekNum,
  days,
  onHover,
  onClick,
  onContextMenu,
  fileMap,
  activeFilePath = null,
}: {
  weekNum: number;
  days: Moment[];
  onHover: IEventHandlers["onHover"];
  onClick: IEventHandlers["onClick"];
  onContextMenu: IEventHandlers["onContextMenu"];
  fileMap: FileMap;
  activeFilePath: string | null;
} = $props();

let startOfWeek = $derived(getStartOfWeek(days));
let file = $derived(
  fileMap.get(`week:${startOfWeek.format("YYYY-[W]WW")}`) ?? null,
);
```

Remove the `$effect` subscription block and the `$state(null)` for `file`. Remove import of `CalendarFileStore`. Add import for `type FileMap` from `./types`.

**Step 5: Run checks**

Run: `bun run check`
Expected: PASS — no type errors, no lint errors

**Step 6: Commit**

```bash
git add src/calendar/Calendar.svelte src/calendar/Day.svelte src/calendar/WeekNum.svelte
git commit -m "refactor(calendar): replace per-cell subscriptions with derived FileMap"
```

---

### Task 3: Update `Month.svelte` to use `fileMap`

**Files:**

- Modify: `src/calendar/Month.svelte:1-163`

**Step 1: Replace `fileStore` subscription with `fileMap` lookup**

Replace the `fileStore` prop with `fileMap` prop. Replace the `$effect` subscription with derived lookups:

```typescript
let {
  fileMap,
  onHover,
  onClick,
  onContextMenu,
  resetDisplayedMonth,
}: {
  fileMap: FileMap;
  onHover: IEventHandlers["onHover"];
  onClick: IEventHandlers["onClick"];
  onContextMenu: IEventHandlers["onContextMenu"];
  resetDisplayedMonth: () => void;
} = $props();

let displayedMonth = getContext<Writable<Moment>>(DISPLAYED_MONTH);

let monthFile = $derived(
  fileMap.get(`month:${$displayedMonth.format("YYYY-MM")}`) ?? null,
);
let yearFile = $derived(
  fileMap.get(`year:${$displayedMonth.format("YYYY")}`) ?? null,
);
let monthEnabled = $derived(
  fileMap.has(`month:${$displayedMonth.format("YYYY-MM")}`),
);
let yearEnabled = $derived(
  fileMap.has(`year:${$displayedMonth.format("YYYY")}`),
);
```

Remove the `$effect` subscription, the `$state` declarations for `monthFile`/`yearFile`/`monthEnabled`/`yearEnabled`, and the `CalendarFileStore` import. Add `FileMap` import from `./types`.

**Step 2: Update `Calendar.svelte` to pass `fileMap` to `Nav`**

In `Calendar.svelte`, update the Nav component:

```svelte
<Nav {fileMap} {today} {eventHandlers} />
```

**Step 3: Update `Nav.svelte` to accept and pass `fileMap`**

Change `Nav.svelte` props from `fileStore` to `fileMap`:

```typescript
let {
  fileMap,
  today,
  eventHandlers,
}: {
  fileMap: FileMap;
  today: Moment;
  eventHandlers: IEventHandlers;
} = $props();
```

Update the Month component call:

```svelte
<Month {fileMap} {resetDisplayedMonth} {...eventHandlers} />
```

Remove `CalendarFileStore` import, add `FileMap` import from `./types`.

**Step 4: Run checks**

Run: `bun run check`
Expected: PASS

**Step 5: Commit**

```bash
git add src/calendar/Month.svelte src/calendar/Nav.svelte src/calendar/Calendar.svelte
git commit -m "refactor(calendar): update Month and Nav to use FileMap"
```

---

### Task 4: Remove `fileStore` from child component imports and clean up

**Files:**

- Modify: `src/calendar/Calendar.svelte`
- Modify: `src/calendar/fileStore.ts`

**Step 1: Verify `fileStore` is only used in `Calendar.svelte`**

After tasks 2-3, `fileStore` should only be referenced in `Calendar.svelte` (the single subscriber). Verify no child components import `CalendarFileStore`.

Run: `rg "CalendarFileStore|fileStore" src/calendar/ --type svelte --type ts`

Expected: Only hits in `Calendar.svelte` and `fileStore.ts` itself.

**Step 2: Remove unused `getFile` and `isGranularityEnabled` if no longer needed externally**

If `Calendar.svelte` is the only consumer and it now uses `computeFileMap`, check whether `getFile` and `isGranularityEnabled` are still called. They are — `Calendar.svelte` passes `fileStore.getFile` to `computeFileMap` and calls `fileStore.isGranularityEnabled`. Keep them.

**Step 3: Run full validation**

Run: `bun run check && bun test`
Expected: All checks and tests pass

**Step 4: Commit**

```bash
git add -A
git commit -m "refactor(calendar): clean up unused fileStore imports from child components"
```

---

### Task 5: Add vault event filtering to `fileStore.bump()`

**Files:**

- Modify: `src/calendar/fileStore.ts:15-34`

**Step 1: Update `bump` to filter non-periodic files**

Replace the current `bump` method:

```typescript
private bump(file?: TAbstractFile | string): void {
  if (file) {
    const path = typeof file === "string" ? file : file.path;
    if (!this.plugin.isPeriodic(path)) return;
  }
  this.store.update((n) => n + 1);
}
```

**Step 2: Add `onRename` method for the rename edge case**

Add a new method:

```typescript
private onRename(file: TAbstractFile, oldPath: string): void {
  if (this.plugin.isPeriodic(file.path) || this.plugin.isPeriodic(oldPath)) {
    this.store.update((n) => n + 1);
  }
}
```

**Step 3: Update the rename event registration**

Change the vault rename registration from `this.bump` to `this.onRename`:

```typescript
component.registerEvent(vault.on("rename", this.onRename, this));
```

The `create` and `delete` events keep using `this.bump`. The `metadataCache.on("changed")` callback receives `(file, data, cache)` where `file` is a `TFile` — update to pass the file:

```typescript
component.registerEvent(
  metadataCache.on("changed", (file) => this.bump(file), this),
);
```

Wait — `metadataCache.on("changed")` signature is `(file: TFile, data: string, cache: CachedMetadata)`. The current code passes `this.bump` directly, which receives the `TFile` as the first arg. This already works with our updated `bump` since `TFile` is not `TAbstractFile | string` — actually `TFile extends TAbstractFile`, so it works. No change needed for the `changed` listener.

**Step 4: Run checks**

Run: `bun run check && bun test`
Expected: PASS

**Step 5: Commit**

```bash
git add src/calendar/fileStore.ts
git commit -m "perf(calendar): filter non-periodic vault events in fileStore.bump()"
```

---

### Task 6: Refactor `Month.svelte` handlers with factory function

**Files:**

- Modify: `src/calendar/Month.svelte:47-97`

**Step 1: Add the `makeHandlers` factory function**

Replace the 6 handler functions with:

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

const monthH = makeHandlers(
  "month",
  () => monthEnabled,
  () => monthFile,
);
const yearH = makeHandlers(
  "year",
  () => yearEnabled,
  () => yearFile,
);
```

Add import for `Granularity` from `src/types`.

**Step 2: Update the template to use factory handlers**

Replace handler references in template:

```svelte
<span
  class="month"
  class:clickable={monthEnabled}
  role={monthEnabled ? "button" : undefined}
  tabindex={monthEnabled ? 0 : undefined}
  onclick={monthH.click}
  onkeydown={(e) => {
    if (e.key === "Enter" || e.key === " ") {
      if (monthEnabled) {
        onClick?.("month", $displayedMonth, monthFile, false);
      } else {
        resetDisplayedMonth();
      }
    }
  }}
  oncontextmenu={monthH.context}
  onpointerenter={monthH.hover}
>
  {$displayedMonth.format("MMM")}
</span>
<span
  class="year"
  class:clickable={yearEnabled}
  role={yearEnabled ? "button" : undefined}
  tabindex={yearEnabled ? 0 : undefined}
  onclick={yearH.click}
  onkeydown={(e) => {
    if (e.key === "Enter" || e.key === " ") {
      if (yearEnabled) {
        onClick?.("year", $displayedMonth, yearFile, false);
      }
    }
  }}
  oncontextmenu={yearH.context}
  onpointerenter={yearH.hover}
>
  {$displayedMonth.format("YYYY")}
</span>
```

**Step 3: Run checks**

Run: `bun run check && bun test`
Expected: PASS

**Step 4: Commit**

```bash
git add src/calendar/Month.svelte
git commit -m "refactor(calendar): replace 6 Month handlers with makeHandlers factory"
```

---

### Task 7: Final validation and lint

**Step 1: Run full validation**

Run: `bun run validate`
Expected: Types pass, checks pass, build succeeds, output files present

**Step 2: Run lint fix**

Run: `bun run lint:fix`
Expected: Clean or auto-fixed

**Step 3: Run all tests**

Run: `bun test`
Expected: All tests pass

**Step 4: Commit any lint fixes**

```bash
git add -A
git commit -m "chore: lint fixes from phase 2 refactor"
```
