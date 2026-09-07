<script lang="ts">
  import type { Moment } from "moment";
  import { Platform } from "obsidian";
  import { getContext } from "svelte";

  import { DISPLAYED_MONTH } from "src/constants";
  import type { DisplayedMonth } from "./displayedMonth.svelte";
  import Month from "./Month.svelte";
  import type { FileMap, EventHandlers } from "./types";

  let {
    fileMap,
    today,
    onHover,
    onClick,
    onContextMenu,
    activeFilePath = null,
  }: {
    fileMap: FileMap;
    today: Moment;
    onHover: EventHandlers["onHover"];
    onClick: EventHandlers["onClick"];
    onContextMenu: EventHandlers["onContextMenu"];
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

{#snippet arrow(
  direction: "left" | "right",
  tooltip: string,
  onclick: () => void,
)}
  <button
    type="button"
    class="arrow"
    class:is-mobile={Platform.isMobile}
    class:right={direction === "right"}
    {onclick}
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
{/snippet}

<div class="nav">
  <Month
    {fileMap}
    {resetDisplayedMonth}
    {activeFilePath}
    {onHover}
    {onClick}
    {onContextMenu}
  />
  <div class="right-nav">
    {@render arrow("left", "Previous Month", decrementDisplayedMonth)}
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
    {@render arrow("right", "Next Month", incrementDisplayedMonth)}
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
