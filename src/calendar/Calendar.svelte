<script lang="ts">
  import type { Moment } from "moment";
  import { setContext } from "svelte";

  import { DISPLAYED_MONTH } from "src/constants";
  import type CalendarStore from "./calendarStore.svelte";
  import Day from "./Day.svelte";
  import { DisplayedMonth } from "./displayedMonth.svelte";
  import { computeFileMap, fileMapKey } from "./store";
  import Nav from "./Nav.svelte";
  import type { FileMap, EventHandlers, Month } from "./types";
  import { getMonth, getWeekdayLabels, isWeekend } from "./utils";
  import Week from "./Week.svelte";

  let {
    fileStore,
    onHover,
    onClick,
    onContextMenu,
  }: {
    fileStore: CalendarStore;
    onHover: EventHandlers["onHover"];
    onClick: EventHandlers["onClick"];
    onContextMenu: EventHandlers["onContextMenu"];
  } = $props();

  let activeFilePath: string | null = $state(null);

  let today: Moment = $state.raw(window.moment());

  const displayedMonth = new DisplayedMonth();
  setContext(DISPLAYED_MONTH, displayedMonth);

  let month: Month = $state.raw(getMonth(window.moment()));
  let showWeeks: boolean = $state(false);
  let fileMap: FileMap = $state.raw(new Map());

  $effect(() => {
    month = getMonth(displayedMonth.current);
  });

  $effect(() => {
    // Track fileStore.version so mutations re-run this effect.
    fileStore.version;
    showWeeks = fileStore.isGranularityEnabled("week");
    fileMap = computeFileMap(
      month,
      (date, granularity) => fileStore.getFile(date, granularity),
      fileStore.getEnabledGranularities(),
    );
  });

  let eventHandlers: EventHandlers = $derived({
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
      {#if showWeeks}
        <col />
      {/if}
      {#each month[1].days as date}
        <col class:weekend={isWeekend(date)} />
      {/each}
    </colgroup>
    <thead>
      <tr>
        {#if showWeeks}
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
          {#if showWeeks}
            <Week
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
