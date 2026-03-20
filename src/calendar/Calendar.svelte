<script lang="ts">
  import type { Moment } from "moment";
  import { setContext } from "svelte";
  import { writable } from "svelte/store";

  import { DISPLAYED_MONTH } from "./context";
  import Day from "./Day.svelte";
  import type CalendarFileStore from "./fileStore";
  import { computeFileMap, fileMapKey } from "./fileStore";
  import Nav from "./Nav.svelte";
  import type { FileMap, IEventHandlers, IMonth } from "./types";
  import { getMonth, getWeekdayLabels, isWeekend } from "./utils";
  import WeekNum from "./WeekNum.svelte";

  let {
    fileStore,
    onHover,
    onClick,
    onContextMenu,
  }: {
    fileStore: CalendarFileStore;
    onHover: IEventHandlers["onHover"];
    onClick: IEventHandlers["onClick"];
    onContextMenu: IEventHandlers["onContextMenu"];
  } = $props();

  let activeFilePath: string | null = $state(null);

  let today: Moment = $state.raw(window.moment());

  const displayedMonthStore = writable<Moment>(window.moment());
  setContext(DISPLAYED_MONTH, displayedMonthStore);

  let month: IMonth = $state.raw(getMonth(window.moment()));
  let showWeekNums: boolean = $state(false);
  let fileMap: FileMap = $state.raw(new Map());

  $effect(() => {
    month = getMonth($displayedMonthStore);
  });

  // $derived.by() doesn't track Svelte store subscriptions,
  // so we manually subscribe inside $effect and return the unsubscribe.
  $effect(() => {
    const currentMonth = month;
    return fileStore.store.subscribe(() => {
      showWeekNums = fileStore.isGranularityEnabled("week");
      fileMap = computeFileMap(
        currentMonth,
        (date, granularity) => fileStore.getFile(date, granularity),
        fileStore.getEnabledGranularities(),
      );
    });
  });

  let eventHandlers: IEventHandlers = $derived({
    onHover,
    onClick,
    onContextMenu,
  });

  const daysOfWeek: string[] = getWeekdayLabels();

  export function tick() {
    const now = window.moment();
    if (!now.isSame(today, "day")) {
      today = now;
    }
  }

  export function setActiveFilePath(path: string | null) {
    activeFilePath = path;
  }
</script>

<div id="calendar-container" class="container">
  <Nav {fileMap} {today} {eventHandlers} />
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
      {#each month as week (fileMapKey("week", week.days[0]))}
        <tr>
          {#if showWeekNums}
            <WeekNum
              {fileMap}
              {activeFilePath}
              {...week}
              {...eventHandlers}
            />
          {/if}
          {#each week.days as day (day.format())}
            <Day
              date={day}
              {fileMap}
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
