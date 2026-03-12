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
