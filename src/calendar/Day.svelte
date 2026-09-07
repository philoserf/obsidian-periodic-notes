<script lang="ts">
  import type { Moment } from "moment";
  import { getContext } from "svelte";

  import { isMetaPressed } from "src/platform";
  import { DISPLAYED_MONTH } from "src/constants";
  import { canonicalKey } from "src/cacheSearch";
  import type { DisplayedMonth } from "./displayedMonth.svelte";
  import type { FileMap, EventHandlers } from "./types";

  let {
    date,
    fileMap,
    onHover,
    onClick,
    onContextMenu,
    today,
    activeFilePath = null,
    dayEnabled = true,
  }: {
    date: Moment;
    fileMap: FileMap;
    onHover: EventHandlers["onHover"];
    onClick: EventHandlers["onClick"];
    onContextMenu: EventHandlers["onContextMenu"];
    today: Moment;
    activeFilePath: string | null;
    dayEnabled: boolean;
  } = $props();

  const displayedMonth = getContext<DisplayedMonth>(DISPLAYED_MONTH);

  let file = $derived(fileMap.get(canonicalKey("day", date)) ?? null);

  // With daily notes off, a cell is a date label and nothing more. Clicking one
  // used to call openPeriodicNote("day", ...), which fell through to
  // createPeriodicNote with the disabled config — writing a note the user had
  // explicitly turned off to the vault root.
  function handleClick(event: MouseEvent) {
    if (!dayEnabled) return;
    onClick?.("day", date, file, isMetaPressed(event));
  }

  function handleHover(event: PointerEvent) {
    if (!dayEnabled || !event.target) return;
    onHover?.("day", date, file, event.target, isMetaPressed(event));
  }

  function handleContextmenu(event: MouseEvent) {
    if (!dayEnabled) return;
    onContextMenu?.("day", date, file, event);
  }
</script>

<td>
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div
    role={dayEnabled ? "button" : undefined}
    tabindex={dayEnabled ? 0 : undefined}
    class="day"
    class:clickable={dayEnabled}
    class:active={file !== null && file.path === activeFilePath}
    class:adjacent-month={!date.isSame(displayedMonth.current, "month")}
    class:has-note={file !== null}
    class:today={date.isSame(today, "day")}
    onclick={handleClick}
    onkeydown={(e) => {
      if (dayEnabled && (e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        onClick?.("day", date, file, false);
      }
    }}
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
    cursor: default;
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
  .day.clickable {
    cursor: pointer;
  }

  .day.clickable:hover {
    background-color: var(--interactive-hover);
  }

  .day.active:hover {
    background-color: var(--interactive-accent-hover);
  }

  .adjacent-month {
    opacity: 0.25;
  }

  .has-note::after {
    background-color: var(--text-muted);
    border-radius: 50%;
    content: "";
    display: block;
    height: 3px;
    margin: 1px auto 0;
    width: 3px;
  }

  .has-note.active::after {
    background-color: var(--text-on-accent);
  }

  .today {
    color: var(--interactive-accent);
    font-weight: 600;
  }

  .day.clickable:active,
  .active,
  .active.today {
    color: var(--text-on-accent);
    background-color: var(--interactive-accent);
  }
</style>
