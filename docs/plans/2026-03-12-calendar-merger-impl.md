# Calendar Merger (Phase 1) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Port the calendar view from obsidian-calendar into periodic-notes, stripping dots/sources/confirmation and wiring all interactions through the periodic-notes public API.

**Architecture:** Calendar becomes a `src/calendar/` subdirectory inside periodic-notes. Components are ported with minimal changes — dropped features stripped, API calls rewired to `plugin.openPeriodicNote()` and `plugin.getPeriodicNote()`. A thin `fileStore.ts` bridges the plugin cache to the Svelte component tree.

**Tech Stack:** TypeScript, Svelte 5 (runes), Vite, Obsidian API, Moment.js

---

## Reference

- Design doc: `docs/plans/2026-03-12-calendar-merger-design.md`
- Calendar source: `../obsidian-calendar/src/`
- Periodic-notes source: `src/`

## Conventions

- Run `bun run check` after each commit to catch type/lint/svelte errors
- Run `bun test` after test-related commits
- Use `bun run lint:fix` if biome complains about formatting
- Commit messages: conventional commits (`feat:`, `test:`, `refactor:`)
- All new files go in `src/calendar/`

---

### Task 1: Add calendar constants and types

**Files:**

- Create: `src/calendar/constants.ts`
- Create: `src/calendar/context.ts`
- Create: `src/calendar/types.ts`

**Step 1: Create constants**

```typescript
// src/calendar/constants.ts
export const VIEW_TYPE_CALENDAR = "calendar";
```

**Step 2: Create context symbol**

```typescript
// src/calendar/context.ts
export const DISPLAYED_MONTH = Symbol("displayedMonth");
```

**Step 3: Create types (stripped of dots/sources)**

```typescript
// src/calendar/types.ts
import type { Moment } from "moment";
import type { TFile } from "obsidian";
import type { Granularity } from "src/types";

export interface IWeek {
  days: Moment[];
  weekNum: number;
}

export type IMonth = IWeek[];

export interface IEventHandlers {
  onHover: (
    granularity: Granularity,
    date: Moment,
    file: TFile | null,
    targetEl: EventTarget,
    isMetaPressed: boolean,
  ) => void;
  onClick: (
    granularity: Granularity,
    date: Moment,
    existingFile: TFile | null,
    inNewSplit: boolean,
  ) => void;
  onContextMenu: (
    granularity: Granularity,
    date: Moment,
    file: TFile | null,
    event: MouseEvent,
  ) => void;
}
```

**Step 4: Run checks**

Run: `bun run check`
Expected: PASS (no errors)

**Step 5: Commit**

```bash
git add src/calendar/constants.ts src/calendar/context.ts src/calendar/types.ts
git commit -m "feat: add calendar constants, context, and types"
```

---

### Task 2: Port calendar utils and tests

**Files:**

- Create: `src/calendar/utils.ts`
- Create: `src/calendar/utils.test.ts`

**Step 1: Write the test file**

Port the calendar's `utils.test.ts`. The test file re-implements pure functions to avoid obsidian imports — this is the established pattern in this codebase (see `bunfig.toml` preload which provides `window.moment` globally).

```typescript
// src/calendar/utils.test.ts
import { describe, expect, it } from "bun:test";

import { getDaysOfWeek, getMonth, getStartOfWeek, isWeekend } from "./utils";

describe("getMonth", () => {
  it("always returns exactly 6 weeks (42 days)", () => {
    const months = [
      moment("2024-01-01"),
      moment("2024-02-01"),
      moment("2024-03-01"),
      moment("2024-12-01"),
    ];
    for (const m of months) {
      const grid = getMonth(m);
      expect(grid).toHaveLength(6);
      let total = 0;
      for (const week of grid) {
        total += week.days.length;
      }
      expect(total).toBe(42);
    }
  });

  it("first day of first week is on or before the 1st of the month", () => {
    const displayed = moment("2024-03-01");
    const grid = getMonth(displayed);
    const firstDay = grid[0].days[0];
    expect(firstDay.isSameOrBefore(displayed.clone().startOf("month"))).toBe(
      true,
    );
  });

  it("days within grid are in chronological order", () => {
    const grid = getMonth(moment("2024-06-01"));
    const days = grid.flatMap((w) => w.days);
    for (let i = 1; i < days.length; i++) {
      expect(days[i].valueOf()).toBeGreaterThan(days[i - 1].valueOf());
    }
  });

  it("each week has exactly 7 days", () => {
    const grid = getMonth(moment("2024-02-01"));
    for (const week of grid) {
      expect(week.days).toHaveLength(7);
    }
  });

  it("weekNum matches moment week number for each row", () => {
    const grid = getMonth(moment("2024-01-01"));
    for (const week of grid) {
      expect(week.weekNum).toBe(week.days[0].week());
    }
  });
});

describe("isWeekend", () => {
  it("returns true for Saturday (isoWeekday 6)", () => {
    expect(isWeekend(moment("2024-02-24"))).toBe(true);
  });

  it("returns true for Sunday (isoWeekday 7)", () => {
    expect(isWeekend(moment("2024-02-25"))).toBe(true);
  });

  it("returns false for a weekday", () => {
    expect(isWeekend(moment("2024-02-26"))).toBe(false);
    expect(isWeekend(moment("2024-02-22"))).toBe(false);
  });
});

describe("getStartOfWeek", () => {
  it("returns weekday(0) of the week containing the provided days", () => {
    const days = [moment("2024-02-28"), moment("2024-02-29")];
    const start = getStartOfWeek(days);
    expect(start.weekday()).toBe(0);
  });
});

describe("getDaysOfWeek", () => {
  it("returns 7 abbreviated day names", () => {
    const names = getDaysOfWeek();
    expect(names).toHaveLength(7);
    for (const name of names) {
      expect(typeof name).toBe("string");
      expect(name.length).toBeGreaterThan(0);
    }
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `bun test src/calendar/utils.test.ts`
Expected: FAIL — module `./utils` not found

**Step 3: Write the utils module**

```typescript
// src/calendar/utils.ts
import type { Moment } from "moment";
import type { IMonth, IWeek } from "./types";

export function getDaysOfWeek(): string[] {
  return window.moment.weekdaysShort(true);
}

export function isWeekend(date: Moment): boolean {
  return date.isoWeekday() === 6 || date.isoWeekday() === 7;
}

export function getStartOfWeek(days: Moment[]): Moment {
  return days[0].clone().weekday(0);
}

export function getMonth(displayedMonth: Moment): IMonth {
  const locale = window.moment().locale();
  const month: IMonth = [];
  let week!: IWeek;

  const startOfMonth = displayedMonth.clone().locale(locale).date(1);
  const startOffset = startOfMonth.weekday();
  let date: Moment = startOfMonth.clone().subtract(startOffset, "days");

  for (let _day = 0; _day < 42; _day++) {
    if (_day % 7 === 0) {
      week = {
        days: [],
        weekNum: date.week(),
      };
      month.push(week);
    }

    week.days.push(date);
    date = date.clone().add(1, "days");
  }

  return month;
}
```

**Step 4: Run tests to verify they pass**

Run: `bun test src/calendar/utils.test.ts`
Expected: PASS (all 8 tests)

**Step 5: Run full checks**

Run: `bun run check`
Expected: PASS

**Step 6: Commit**

```bash
git add src/calendar/utils.ts src/calendar/utils.test.ts
git commit -m "feat: port calendar grid utils with tests"
```

---

### Task 3: Create fileStore (thin cache wrapper)

**Files:**

- Create: `src/calendar/fileStore.ts`

The calendar's `fileStore.ts` was a full cache with its own vault event listeners and `getAllDailyNotes()` calls. The new version is a thin wrapper around the periodic-notes plugin's cache. It provides a reactive Svelte store that components subscribe to for re-renders, and delegates all lookups to `plugin.getPeriodicNote()`.

**Step 1: Write fileStore**

```typescript
// src/calendar/fileStore.ts
import type { Moment } from "moment";
import type { Component, TAbstractFile, TFile } from "obsidian";
import { get, writable, type Writable } from "svelte/store";
import type PeriodicNotesPlugin from "src/main";
import type { Granularity } from "src/types";

export default class CalendarFileStore {
  public store: Writable<number>;
  private plugin: PeriodicNotesPlugin;

  constructor(component: Component, plugin: PeriodicNotesPlugin) {
    this.plugin = plugin;
    // A simple counter store — incrementing it triggers Svelte reactivity
    this.store = writable(0);

    plugin.app.workspace.onLayoutReady(() => {
      const { vault } = plugin.app;
      component.registerEvent(vault.on("create", this.bump, this));
      component.registerEvent(vault.on("delete", this.bump, this));
      component.registerEvent(vault.on("rename", this.bump, this));
      component.registerEvent(
        plugin.app.workspace.on(
          "periodic-notes:settings-updated",
          this.bump,
          this,
        ),
      );
    });
  }

  private bump(_file?: TAbstractFile | string): void {
    this.store.update((n) => n + 1);
  }

  public getFile(date: Moment, granularity: Granularity): TFile | null {
    return this.plugin.getPeriodicNote(granularity, date);
  }

  public isGranularityEnabled(granularity: Granularity): boolean {
    const settings = get(this.plugin.settings);
    return settings[granularity]?.enabled ?? granularity === "day";
  }
}
```

**Step 2: Run checks**

Run: `bun run check`
Expected: PASS

**Step 3: Commit**

```bash
git add src/calendar/fileStore.ts
git commit -m "feat: add calendar file store wrapping periodic-notes cache"
```

---

### Task 4: Port Arrow component

**Files:**

- Create: `src/calendar/Arrow.svelte`

The original used `isMobile()` from `obsidian-internals.ts`. Use Obsidian's `Platform.isMobile` instead.

**Step 1: Write Arrow.svelte**

```svelte
<!-- src/calendar/Arrow.svelte -->
<script lang="ts">
  import { Platform } from "obsidian";

  let {
    onClick,
    tooltip,
    direction,
  }: {
    onClick: () => void;
    tooltip: string;
    direction: "left" | "right";
  } = $props();
</script>

<button
  type="button"
  class="arrow"
  class:is-mobile={Platform.isMobile}
  class:right={direction === "right"}
  onclick={onClick}
  aria-label={tooltip}
>
  <svg
    focusable="false"
    role="img"
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 320 512"
    ><path
      fill="currentColor"
      d="M34.52 239.03L228.87 44.69c9.37-9.37 24.57-9.37 33.94 0l22.67 22.67c9.36 9.36 9.37 24.52.04 33.9L131.49 256l154.02 154.75c9.34 9.38 9.32 24.54-.04 33.9l-22.67 22.67c-9.37 9.37-24.57 9.37-33.94 0L34.52 272.97c-9.37-9.37-9.37-24.57 0-33.94z"
    ></path></svg
  >
</button>

<style>
  .arrow {
    align-items: center;
    appearance: none;
    background: none;
    border: none;
    cursor: pointer;
    display: flex;
    justify-content: center;
    padding: 0;
    width: 24px;
  }

  .arrow.is-mobile {
    width: 32px;
  }

  .right {
    transform: rotate(180deg);
  }

  .arrow svg {
    color: var(--color-arrow);
    height: 16px;
    width: 16px;
  }
</style>
```

**Step 2: Run checks**

Run: `bun run check`
Expected: PASS

**Step 3: Commit**

```bash
git add src/calendar/Arrow.svelte
git commit -m "feat: port Arrow component"
```

---

### Task 5: Port Day component

**Files:**

- Create: `src/calendar/Day.svelte`

Key changes from original:

- Strip `Dots`, `MetadataResolver`, `IDayMetadata`, `ISourceSettings`, `getSourceSettings`
- Strip drag support (no `onDragStart`, `fileCache.onDragStart`)
- Use `isMetaPressed` from `src/utils` (not calendar's local copy)
- Use `Granularity` from `src/types` (not `IGranularity` from periodic-notes/)
- Remove `getDateUID` usage — use file path comparison for active state

**Step 1: Write Day.svelte**

```svelte
<!-- src/calendar/Day.svelte -->
<script lang="ts">
  import type { Moment } from "moment";
  import type { TFile } from "obsidian";
  import { getContext } from "svelte";
  import type { Writable } from "svelte/store";

  import { isMetaPressed } from "src/utils";
  import type { Granularity } from "src/types";
  import { DISPLAYED_MONTH } from "./context";
  import type CalendarFileStore from "./fileStore";

  let {
    date,
    fileStore,
    onHover,
    onClick,
    onContextMenu,
    today,
    activeFilePath = null,
  }: {
    date: Moment;
    fileStore: CalendarFileStore;
    onHover: (
      granularity: Granularity,
      date: Moment,
      file: TFile | null,
      targetEl: EventTarget,
      isMetaPressed: boolean,
    ) => void;
    onClick: (
      granularity: Granularity,
      date: Moment,
      existingFile: TFile | null,
      inNewSplit: boolean,
    ) => void;
    onContextMenu: (
      granularity: Granularity,
      date: Moment,
      file: TFile | null,
      event: MouseEvent,
    ) => void;
    today: Moment;
    activeFilePath: string | null;
  } = $props();

  const displayedMonth = getContext<Writable<Moment>>(DISPLAYED_MONTH);

  let file: TFile | null = $state(null);

  $effect(() => {
    return fileStore.store.subscribe(() => {
      file = fileStore.getFile(date, "day");
    });
  });

  function handleClick(event: MouseEvent) {
    onClick?.("day", date, file, isMetaPressed(event));
  }

  function handleHover(event: PointerEvent) {
    if (event.target) {
      onHover?.("day", date, file, event.target, isMetaPressed(event));
    }
  }

  function handleContextmenu(event: MouseEvent) {
    onContextMenu?.("day", date, file, event);
  }
</script>

<td>
  <div
    class="day"
    class:active={file !== null && file.path === activeFilePath}
    class:adjacent-month={!date.isSame($displayedMonth, "month")}
    class:has-note={file !== null}
    class:today={date.isSame(today, "day")}
    onclick={handleClick}
    oncontextmenu={handleContextmenu}
    onpointerenter={handleHover}
  >
    {date.format("D")}
  </div>
</td>

<style>
  .day {
    background-color: var(--color-background-day);
    border-radius: 4px;
    color: var(--color-text-day);
    cursor: pointer;
    font-size: 0.8em;
    height: 100%;
    padding: 4px;
    position: relative;
    text-align: center;
    transition:
      background-color 0.1s ease-in,
      color 0.1s ease-in;
    vertical-align: baseline;
  }
  .day:hover {
    background-color: var(--interactive-hover);
  }

  .day.active:hover {
    background-color: var(--interactive-accent-hover);
  }

  .adjacent-month {
    opacity: 0.25;
  }

  .today {
    color: var(--color-text-today);
  }

  .day:active,
  .active,
  .active.today {
    color: var(--text-on-accent);
    background-color: var(--interactive-accent);
  }
</style>
```

**Step 2: Run checks**

Run: `bun run check`
Expected: PASS

**Step 3: Commit**

```bash
git add src/calendar/Day.svelte
git commit -m "feat: port Day component"
```

---

### Task 6: Port WeekNum component

**Files:**

- Create: `src/calendar/WeekNum.svelte`

Same treatment as Day — strip dots, metadata, drag, source settings.

**Step 1: Write WeekNum.svelte**

```svelte
<!-- src/calendar/WeekNum.svelte -->
<script lang="ts">
  import type { Moment } from "moment";
  import type { TFile } from "obsidian";

  import { isMetaPressed } from "src/utils";
  import type { Granularity } from "src/types";
  import type CalendarFileStore from "./fileStore";
  import { getStartOfWeek } from "./utils";

  let {
    weekNum,
    days,
    onHover,
    onClick,
    onContextMenu,
    fileStore,
    activeFilePath = null,
  }: {
    weekNum: number;
    days: Moment[];
    onHover: (
      granularity: Granularity,
      date: Moment,
      file: TFile | null,
      targetEl: EventTarget,
      isMetaPressed: boolean,
    ) => void;
    onClick: (
      granularity: Granularity,
      date: Moment,
      existingFile: TFile | null,
      inNewSplit: boolean,
    ) => void;
    onContextMenu: (
      granularity: Granularity,
      date: Moment,
      file: TFile | null,
      event: MouseEvent,
    ) => void;
    fileStore: CalendarFileStore;
    activeFilePath: string | null;
  } = $props();

  let file: TFile | null = $state(null);
  let startOfWeek = $derived(getStartOfWeek(days));

  $effect(() => {
    return fileStore.store.subscribe(() => {
      file = fileStore.getFile(startOfWeek, "week");
    });
  });

  function handleHover(event: PointerEvent) {
    if (event.target) {
      onHover?.("week", startOfWeek, file, event.target, isMetaPressed(event));
    }
  }
</script>

<td>
  <div
    role="button"
    tabindex="0"
    class="week-num"
    class:active={file !== null && file.path === activeFilePath}
    onclick={onClick &&
      ((e) => onClick("week", startOfWeek, file, isMetaPressed(e)))}
    onkeydown={onClick &&
      ((e) =>
        (e.key === "Enter" || e.key === " ") &&
        onClick("week", startOfWeek, file, false))}
    oncontextmenu={onContextMenu &&
      ((e) => onContextMenu("week", startOfWeek, file, e))}
    onpointerenter={handleHover}
  >
    {weekNum}
  </div>
</td>

<style>
  td {
    border-right: 1px solid var(--background-modifier-border);
  }

  .week-num {
    background-color: var(--color-background-weeknum);
    border-radius: 4px;
    color: var(--color-text-weeknum);
    cursor: pointer;
    font-size: 0.65em;
    height: 100%;
    padding: 4px;
    text-align: center;
    transition:
      background-color 0.1s ease-in,
      color 0.1s ease-in;
    vertical-align: baseline;
  }

  .week-num:hover {
    background-color: var(--interactive-hover);
  }

  .week-num.active:hover {
    background-color: var(--interactive-accent-hover);
  }

  .active {
    color: var(--text-on-accent);
    background-color: var(--interactive-accent);
  }
</style>
```

**Step 2: Run checks**

Run: `bun run check`
Expected: PASS

**Step 3: Commit**

```bash
git add src/calendar/WeekNum.svelte
git commit -m "feat: port WeekNum component"
```

---

### Task 7: Port Month component

**Files:**

- Create: `src/calendar/Month.svelte`

Key changes: strip dots/metadata/drag/source settings. Wire month click to `onClick("month", ...)` guarded by `fileStore.isGranularityEnabled("month")`. Add year click guarded by `fileStore.isGranularityEnabled("year")`. If granularity not enabled, month click resets displayed month (preserving original behavior), year click does nothing.

**Step 1: Write Month.svelte**

```svelte
<!-- src/calendar/Month.svelte -->
<script lang="ts">
  import type { Moment } from "moment";
  import type { TFile } from "obsidian";
  import { getContext } from "svelte";
  import type { Writable } from "svelte/store";

  import { isMetaPressed } from "src/utils";
  import type { Granularity } from "src/types";
  import { DISPLAYED_MONTH } from "./context";
  import type CalendarFileStore from "./fileStore";

  let {
    fileStore,
    onHover,
    onClick,
    onContextMenu,
    resetDisplayedMonth,
  }: {
    fileStore: CalendarFileStore;
    onHover: (
      granularity: Granularity,
      date: Moment,
      file: TFile | null,
      targetEl: EventTarget,
      isMetaPressed: boolean,
    ) => void;
    onClick: (
      granularity: Granularity,
      date: Moment,
      existingFile: TFile | null,
      inNewSplit: boolean,
    ) => void;
    onContextMenu: (
      granularity: Granularity,
      date: Moment,
      file: TFile | null,
      event: MouseEvent,
    ) => void;
    resetDisplayedMonth: () => void;
  } = $props();

  let displayedMonth = getContext<Writable<Moment>>(DISPLAYED_MONTH);

  let monthFile: TFile | null = $state(null);
  let yearFile: TFile | null = $state(null);
  let monthEnabled = $derived(fileStore.isGranularityEnabled("month"));
  let yearEnabled = $derived(fileStore.isGranularityEnabled("year"));

  $effect(() => {
    $displayedMonth;
    return fileStore.store.subscribe(() => {
      monthFile = monthEnabled
        ? fileStore.getFile($displayedMonth, "month")
        : null;
      yearFile = yearEnabled
        ? fileStore.getFile($displayedMonth, "year")
        : null;
    });
  });

  function handleMonthClick(event: MouseEvent) {
    if (monthEnabled) {
      onClick?.("month", $displayedMonth, monthFile, isMetaPressed(event));
    } else {
      resetDisplayedMonth();
    }
  }

  function handleMonthHover(event: PointerEvent) {
    if (!monthEnabled) return;
    if (event.target) {
      onHover?.(
        "month",
        $displayedMonth,
        monthFile,
        event.target,
        isMetaPressed(event),
      );
    }
  }

  function handleMonthContext(event: MouseEvent) {
    if (monthEnabled && monthFile) {
      onContextMenu?.("month", $displayedMonth, monthFile, event);
    }
  }

  function handleYearClick(event: MouseEvent) {
    if (yearEnabled) {
      onClick?.("year", $displayedMonth, yearFile, isMetaPressed(event));
    }
  }

  function handleYearHover(event: PointerEvent) {
    if (!yearEnabled) return;
    if (event.target) {
      onHover?.(
        "year",
        $displayedMonth,
        yearFile,
        event.target,
        isMetaPressed(event),
      );
    }
  }

  function handleYearContext(event: MouseEvent) {
    if (yearEnabled && yearFile) {
      onContextMenu?.("year", $displayedMonth, yearFile, event);
    }
  }
</script>

<div>
  <span class="title">
    <span
      class="month"
      class:clickable={monthEnabled}
      role={monthEnabled ? "button" : undefined}
      tabindex={monthEnabled ? 0 : undefined}
      onclick={handleMonthClick}
      onkeydown={(e) => {
        if (e.key === "Enter" || e.key === " ") handleMonthClick(e);
      }}
      oncontextmenu={handleMonthContext}
      onpointerenter={handleMonthHover}
    >
      {$displayedMonth.format("MMM")}
    </span>
    <span
      class="year"
      class:clickable={yearEnabled}
      role={yearEnabled ? "button" : undefined}
      tabindex={yearEnabled ? 0 : undefined}
      onclick={handleYearClick}
      onkeydown={(e) => {
        if (e.key === "Enter" || e.key === " ") handleYearClick(e);
      }}
      oncontextmenu={handleYearContext}
      onpointerenter={handleYearHover}
    >
      {$displayedMonth.format("YYYY")}
    </span>
  </span>
</div>

<style>
  .title {
    color: var(--color-text-title);
    display: flex;
    font-size: 1.4em;
    gap: 0.3em;
    margin: 0;
  }

  .month {
    font-weight: 500;
  }

  .year {
    color: var(--interactive-accent);
  }

  .clickable {
    cursor: pointer;
  }
</style>
```

**Step 2: Run checks**

Run: `bun run check`
Expected: PASS

**Step 3: Commit**

```bash
git add src/calendar/Month.svelte
git commit -m "feat: port Month component with year/month click support"
```

---

### Task 8: Port Nav component

**Files:**

- Create: `src/calendar/Nav.svelte`

Stripped: `Dot` (reset button indicator), `fileCache`/`getSourceSettings` props (Month no longer needs them for dots). Added a simple circle character for the reset indicator instead of the Dot SVG component.

**Step 1: Write Nav.svelte**

```svelte
<!-- src/calendar/Nav.svelte -->
<script lang="ts">
  import type { Moment } from "moment";
  import { getContext } from "svelte";
  import type { Writable } from "svelte/store";

  import Arrow from "./Arrow.svelte";
  import { DISPLAYED_MONTH } from "./context";
  import type CalendarFileStore from "./fileStore";
  import Month from "./Month.svelte";
  import type { IEventHandlers } from "./types";

  let {
    fileStore,
    today,
    eventHandlers,
  }: {
    fileStore: CalendarFileStore;
    today: Moment;
    eventHandlers: IEventHandlers;
  } = $props();

  let displayedMonth = getContext<Writable<Moment>>(DISPLAYED_MONTH);

  function incrementDisplayedMonth() {
    displayedMonth.update((month) => month.clone().add(1, "month"));
  }

  function decrementDisplayedMonth() {
    displayedMonth.update((month) => month.clone().subtract(1, "month"));
  }

  function resetDisplayedMonth() {
    displayedMonth.set(today.clone());
  }

  let showingCurrentMonth = $derived($displayedMonth.isSame(today, "month"));
</script>

<div class="nav">
  <Month {fileStore} {resetDisplayedMonth} {...eventHandlers} />
  <div class="right-nav">
    <Arrow
      direction="left"
      onClick={decrementDisplayedMonth}
      tooltip="Previous Month"
    />
    <button
      type="button"
      aria-label={showingCurrentMonth
        ? "Current month"
        : "Reset to current month"}
      class="reset-button"
      class:active={!showingCurrentMonth}
      onclick={resetDisplayedMonth}
    >
      &#x25CF;
    </button>
    <Arrow
      direction="right"
      onClick={incrementDisplayedMonth}
      tooltip="Next Month"
    />
  </div>
</div>

<style>
  .nav {
    align-items: baseline;
    display: flex;
    margin: 0.6em 0 1em;
    padding: 0 8px;
    width: 100%;
  }

  .right-nav {
    align-items: center;
    display: flex;
    justify-content: center;
    margin-left: auto;
  }

  .reset-button {
    align-items: center;
    appearance: none;
    background: none;
    border: none;
    color: var(--color-arrow);
    cursor: default;
    display: flex;
    font-size: 8px;
    opacity: 0.4;
    padding: 0.5em;
  }

  .reset-button.active {
    cursor: pointer;
    opacity: 1;
  }
</style>
```

**Step 2: Run checks**

Run: `bun run check`
Expected: PASS

**Step 3: Commit**

```bash
git add src/calendar/Nav.svelte
git commit -m "feat: port Nav component"
```

---

### Task 9: Port Calendar root component

**Files:**

- Create: `src/calendar/Calendar.svelte`

Key changes: strip `sources`, `ICalendarSource`, heartbeat (no dots to refresh), `getSourceSettings`. Replace `fileCache: PeriodicNotesCache` with `fileStore: CalendarFileStore`. Replace `selectedId` string with `activeFilePath` string. Remove `showWeekNums` from settings store — read from `fileStore.isGranularityEnabled("week")`.

**Step 1: Write Calendar.svelte**

```svelte
<!-- src/calendar/Calendar.svelte -->
<script lang="ts">
  import type { Moment } from "moment";
  import { setContext } from "svelte";
  import { writable } from "svelte/store";

  import { DISPLAYED_MONTH } from "./context";
  import Day from "./Day.svelte";
  import type CalendarFileStore from "./fileStore";
  import Nav from "./Nav.svelte";
  import type { IEventHandlers, IMonth } from "./types";
  import { getDaysOfWeek, getMonth, isWeekend } from "./utils";
  import WeekNum from "./WeekNum.svelte";

  let {
    fileStore,
    onHover,
    onClick,
    onContextMenu,
    activeFilePath = null,
  }: {
    fileStore: CalendarFileStore;
    onHover: IEventHandlers["onHover"];
    onClick: IEventHandlers["onClick"];
    onContextMenu: IEventHandlers["onContextMenu"];
    activeFilePath: string | null;
  } = $props();

  let today: Moment = $state.raw(window.moment());

  let displayedMonthStore = writable<Moment>(window.moment());
  setContext(DISPLAYED_MONTH, displayedMonthStore);

  let showWeekNums = $derived(fileStore.isGranularityEnabled("week"));
  let eventHandlers: IEventHandlers = $derived({
    onHover,
    onClick,
    onContextMenu,
  });

  let month: IMonth = $derived.by(() => getMonth($displayedMonthStore));
  let daysOfWeek: string[] = $derived.by(() => getDaysOfWeek());

  export function tick() {
    today = window.moment();
  }

  export function setDisplayedMonth(date: Moment) {
    displayedMonthStore.set(date);
  }
</script>

<div id="calendar-container" class="container">
  <Nav {fileStore} {today} {eventHandlers} />
  <table class="calendar">
    <colgroup>
      {#if showWeekNums}
        <col />
      {/if}
      {#each month[1].days as date}
        <col class:weekend={isWeekend(date)} />
      {/each}
    </colgroup>
    <thead>
      <tr>
        {#if showWeekNums}
          <th>W</th>
        {/if}
        {#each daysOfWeek as dayOfWeek}
          <th>{dayOfWeek}</th>
        {/each}
      </tr>
    </thead>
    <tbody>
      {#each month as week (week.weekNum)}
        <tr>
          {#if showWeekNums}
            <WeekNum
              {fileStore}
              {activeFilePath}
              {...week}
              {...eventHandlers}
            />
          {/if}
          {#each week.days as day (day.format())}
            <Day
              date={day}
              {fileStore}
              {today}
              {activeFilePath}
              {...eventHandlers}
            />
          {/each}
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  .container {
    --color-background-heading: transparent;
    --color-background-day: transparent;
    --color-background-weeknum: transparent;
    --color-background-weekend: transparent;

    --color-arrow: var(--text-muted);
    --color-button: var(--text-muted);

    --color-text-title: var(--text-normal);
    --color-text-heading: var(--text-muted);
    --color-text-day: var(--text-normal);
    --color-text-today: var(--interactive-accent);
    --color-text-weeknum: var(--text-muted);
  }

  .container {
    padding: 0 8px;
  }

  .weekend {
    background-color: var(--color-background-weekend);
  }

  .calendar {
    border-collapse: collapse;
    width: 100%;
  }

  th {
    background-color: var(--color-background-heading);
    color: var(--color-text-heading);
    font-size: 0.6em;
    letter-spacing: 1px;
    padding: 4px;
    text-align: center;
    text-transform: uppercase;
  }
</style>
```

**Step 2: Run checks**

Run: `bun run check`
Expected: PASS

**Step 3: Commit**

```bash
git add src/calendar/Calendar.svelte
git commit -m "feat: port Calendar root component"
```

---

### Task 10: Create CalendarView and register in plugin

**Files:**

- Create: `src/calendar/view.ts`
- Modify: `src/main.ts`
- Modify: `src/obsidian.d.ts` (if needed for file-menu event typing)

**Step 1: Write CalendarView**

```typescript
// src/calendar/view.ts
import type { Moment } from "moment";
import { ItemView, Menu, type TFile, type WorkspaceLeaf } from "obsidian";
import { mount, unmount } from "svelte";

import type PeriodicNotesPlugin from "src/main";
import type { Granularity } from "src/types";
import { isMetaPressed } from "src/utils";
import Calendar from "./Calendar.svelte";
import { VIEW_TYPE_CALENDAR } from "./constants";
import CalendarFileStore from "./fileStore";

interface CalendarExports {
  tick: () => void;
  setDisplayedMonth: (date: Moment) => void;
}

export class CalendarView extends ItemView {
  private calendar!: CalendarExports;
  private plugin: PeriodicNotesPlugin;
  private activeFilePath: string | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: PeriodicNotesPlugin) {
    super(leaf);
    this.plugin = plugin;

    this.registerEvent(
      this.app.workspace.on("file-open", this.onFileOpen.bind(this)),
    );
  }

  getViewType(): string {
    return VIEW_TYPE_CALENDAR;
  }

  getDisplayText(): string {
    return "Calendar";
  }

  getIcon(): string {
    return "calendar-day";
  }

  onClose(): Promise<void> {
    if (this.calendar) {
      unmount(this.calendar);
    }
    return Promise.resolve();
  }

  async onOpen(): Promise<void> {
    const fileStore = new CalendarFileStore(this, this.plugin);

    const cal = mount(Calendar, {
      target: this.contentEl,
      props: {
        fileStore,
        activeFilePath: this.activeFilePath,
        onHover: this.onHover.bind(this),
        onClick: this.onClick.bind(this),
        onContextMenu: this.onContextMenu.bind(this),
      },
    });
    if (!("tick" in cal && "setDisplayedMonth" in cal)) {
      throw new Error("Calendar component missing expected exports");
    }
    this.calendar = cal as CalendarExports;
  }

  private onHover(
    granularity: Granularity,
    date: Moment,
    file: TFile | null,
    targetEl: EventTarget,
    metaPressed: boolean,
  ): void {
    if (!metaPressed) return;
    if (!file) return;
    this.app.workspace.trigger("link-hover", this, targetEl, file.path, "");
  }

  private onClick(
    granularity: Granularity,
    date: Moment,
    existingFile: TFile | null,
    inNewSplit: boolean,
  ): void {
    this.plugin.openPeriodicNote(granularity, date, { inNewSplit });
  }

  private onContextMenu(
    _granularity: Granularity,
    _date: Moment,
    file: TFile | null,
    event: MouseEvent,
  ): void {
    if (!file) return;
    const menu = new Menu();
    menu.addItem((item) =>
      item
        .setTitle("Delete")
        .setIcon("trash")
        .onClick(() => {
          this.app.vault.trash(file, true);
        }),
    );
    this.app.workspace.trigger(
      "file-menu",
      menu,
      file,
      "calendar-context-menu",
      null,
    );
    menu.showAtPosition({ x: event.pageX, y: event.pageY });
  }

  private onFileOpen(_file: TFile | null): void {
    if (!this.app.workspace.layoutReady) return;
    const file = this.app.workspace.getActiveFile();
    this.activeFilePath = file?.path ?? null;

    if (this.calendar) {
      this.calendar.tick();

      if (file) {
        const cached = this.plugin.findInCache(file.path);
        if (cached) {
          this.calendar.setDisplayedMonth(cached.date);
        }
      }
    }
  }

  public revealActiveNote(): void {
    if (!this.calendar) return;
    const file = this.app.workspace.getActiveFile();
    if (!file) return;

    const cached = this.plugin.findInCache(file.path);
    if (cached) {
      this.calendar.setDisplayedMonth(cached.date);
    }
  }
}
```

**Step 2: Modify `src/main.ts`**

Add these imports at the top of the file:

```typescript
import { CalendarView } from "./calendar/view";
import { VIEW_TYPE_CALENDAR } from "./calendar/constants";
```

Add view registration and commands inside `onload()`, after the existing `this.addCommand` for date switcher and before the `this.app.workspace.onLayoutReady` block:

```typescript
// Calendar view
this.registerView(VIEW_TYPE_CALENDAR, (leaf) => new CalendarView(leaf, this));

this.addCommand({
  id: "show-calendar",
  name: "Show calendar",
  checkCallback: (checking: boolean) => {
    if (checking) {
      return (
        this.app.workspace.getLeavesOfType(VIEW_TYPE_CALENDAR).length === 0
      );
    }
    this.app.workspace.getRightLeaf(false)?.setViewState({
      type: VIEW_TYPE_CALENDAR,
    });
  },
});

this.addCommand({
  id: "reveal-active-note",
  name: "Reveal active note in calendar",
  checkCallback: (checking: boolean) => {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_CALENDAR);
    if (leaves.length === 0) return false;
    if (checking) return true;
    const view = leaves[0].view as CalendarView;
    view.revealActiveNote();
  },
});
```

**Step 3: Run checks**

Run: `bun run check`
Expected: PASS

**Step 4: Run build to verify output**

Run: `bun run build`
Expected: PASS — `main.js` and `styles.css` generated without errors

**Step 5: Commit**

```bash
git add src/calendar/view.ts src/main.ts
git commit -m "feat: register CalendarView with show and reveal commands"
```

---

### Task 11: Run full validation

**Step 1: Run the full validation suite**

Run: `bun run validate`
Expected: PASS — types, checks, build, output all good

**Step 2: Run tests**

Run: `bun test`
Expected: PASS — existing tests plus new calendar utils tests

**Step 3: Verify styles.css includes calendar styles**

Run: `grep -c "calendar" styles.css` (via build output inspection)
Expected: Calendar component styles present in output

**Step 4: Commit if any fixups were needed**

If validation revealed issues, fix and commit with:

```bash
git commit -m "fix: address validation issues from calendar port"
```

---

## Summary

| Task | What                          | Files             |
| ---- | ----------------------------- | ----------------- |
| 1    | Constants, context, types     | 3 new             |
| 2    | Utils + tests (TDD)           | 2 new             |
| 3    | FileStore (cache wrapper)     | 1 new             |
| 4    | Arrow component               | 1 new             |
| 5    | Day component                 | 1 new             |
| 6    | WeekNum component             | 1 new             |
| 7    | Month component               | 1 new             |
| 8    | Nav component                 | 1 new             |
| 9    | Calendar root component       | 1 new             |
| 10   | CalendarView + main.ts wiring | 1 new, 1 modified |
| 11   | Full validation               | 0 new             |

Total: 13 new files in `src/calendar/`, 1 modified (`src/main.ts`).
