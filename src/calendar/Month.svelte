<script lang="ts">
  import type { Moment } from "moment";
  import { getContext } from "svelte";
  import type { Writable } from "svelte/store";

  import { isMetaPressed } from "src/utils";
  import { DISPLAYED_MONTH } from "./context";
  import type { FileMap, IEventHandlers } from "./types";

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

  let monthEnabled = $derived(
    fileMap.has(`month:${$displayedMonth.format("YYYY-MM")}`),
  );
  let yearEnabled = $derived(
    fileMap.has(`year:${$displayedMonth.format("YYYY")}`),
  );
  let monthFile = $derived(
    fileMap.get(`month:${$displayedMonth.format("YYYY-MM")}`) ?? null,
  );
  let yearFile = $derived(
    fileMap.get(`year:${$displayedMonth.format("YYYY")}`) ?? null,
  );

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
        if (e.key === "Enter" || e.key === " ") {
          if (monthEnabled) {
            onClick?.("month", $displayedMonth, monthFile, false);
          } else {
            resetDisplayedMonth();
          }
        }
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
        if (e.key === "Enter" || e.key === " ") {
          if (yearEnabled) {
            onClick?.("year", $displayedMonth, yearFile, false);
          }
        }
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
