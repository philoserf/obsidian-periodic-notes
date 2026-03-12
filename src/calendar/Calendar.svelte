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

  let showWeekNums: boolean = $state(fileStore.isGranularityEnabled("week"));

  $effect(() => {
    return fileStore.store.subscribe(() => {
      showWeekNums = fileStore.isGranularityEnabled("week");
    });
  });
  let eventHandlers: IEventHandlers = $derived({
    onHover,
    onClick,
    onContextMenu,
  });

  let month: IMonth = $state.raw(getMonth(window.moment()));
  let daysOfWeek: string[] = $state.raw(getDaysOfWeek());

  $effect(() => {
    month = getMonth($displayedMonthStore);
  });

  $effect(() => {
    daysOfWeek = getDaysOfWeek();
  });

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
