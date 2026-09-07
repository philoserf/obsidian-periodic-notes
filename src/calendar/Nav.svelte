<script lang="ts">
  import type { Moment } from "moment";
  import { getContext } from "svelte";

  import Arrow from "./Arrow.svelte";
  import { DISPLAYED_MONTH } from "src/constants";
  import type { DisplayedMonth } from "./displayedMonth.svelte";
  import Month from "./Month.svelte";
  import type { FileMap, EventHandlers } from "./types";

  let {
    fileMap,
    today,
    eventHandlers,
    activeFilePath = null,
  }: {
    fileMap: FileMap;
    today: Moment;
    eventHandlers: EventHandlers;
    activeFilePath: string | null;
  } = $props();

  const displayedMonth = getContext<DisplayedMonth>(DISPLAYED_MONTH);

  // Normalized first: moment clamps the day when the target month is shorter,
  // so paging Jan 31 -> Feb 28 -> Mar 28 drifts the day component downward and
  // never recovers. The grid discards the day, but the drifted moment is what
  // reaches createPeriodicNote, which formats it as-is — so a custom month or
  // year format containing a day token would embed the drifted day.
  function incrementDisplayedMonth() {
    displayedMonth.current = displayedMonth.current
      .clone()
      .startOf("month")
      .add(1, "month");
  }

  function decrementDisplayedMonth() {
    displayedMonth.current = displayedMonth.current
      .clone()
      .startOf("month")
      .subtract(1, "month");
  }

  function resetDisplayedMonth() {
    displayedMonth.current = today.clone().startOf("month");
  }

  let showingCurrentMonth = $derived(
    displayedMonth.current.isSame(today, "month"),
  );
</script>

<div class="nav">
  <Month {fileMap} {resetDisplayedMonth} {activeFilePath} {...eventHandlers} />
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
