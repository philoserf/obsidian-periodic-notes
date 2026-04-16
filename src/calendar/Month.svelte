<script lang="ts">
  import type { TFile } from "obsidian";
  import { getContext } from "svelte";

  import type { Granularity } from "src/types";
  import { isMetaPressed } from "src/platform";
  import { DISPLAYED_MONTH } from "src/constants";
  import { canonicalKey } from "src/cacheSearch";
  import type { DisplayedMonth } from "./displayedMonth.svelte";
  import type { FileMap, EventHandlers } from "./types";

  let {
    fileMap,
    onHover,
    onClick,
    onContextMenu,
    resetDisplayedMonth,
  }: {
    fileMap: FileMap;
    onHover: EventHandlers["onHover"];
    onClick: EventHandlers["onClick"];
    onContextMenu: EventHandlers["onContextMenu"];
    resetDisplayedMonth: () => void;
  } = $props();

  const displayedMonth = getContext<DisplayedMonth>(DISPLAYED_MONTH);

  let monthKey = $derived(canonicalKey("month", displayedMonth.current));
  let yearKey = $derived(canonicalKey("year", displayedMonth.current));
  let monthEnabled = $derived(fileMap.has(monthKey));
  let yearEnabled = $derived(fileMap.has(yearKey));
  let monthFile = $derived(fileMap.get(monthKey) ?? null);
  let yearFile = $derived(fileMap.get(yearKey) ?? null);

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
            displayedMonth.current,
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
          displayedMonth.current,
          getFile(),
          event.target,
          isMetaPressed(event),
        );
      },
      context: (event: MouseEvent) => {
        const f = getFile();
        if (getEnabled() && f) {
          onContextMenu?.(granularity, displayedMonth.current, f, event);
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
</script>

<div>
  <span class="title">
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <span
      class="month"
      class:clickable={monthEnabled}
      role={monthEnabled ? "button" : undefined}
      tabindex={monthEnabled ? 0 : undefined}
      onclick={monthH.click}
      onkeydown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          if (monthEnabled) {
            onClick?.("month", displayedMonth.current, monthFile, false);
          } else {
            resetDisplayedMonth();
          }
        }
      }}
      oncontextmenu={monthH.context}
      onpointerenter={monthH.hover}
    >
      {displayedMonth.current.format("MMM")}
    </span>
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <span
      class="year"
      class:clickable={yearEnabled}
      role={yearEnabled ? "button" : undefined}
      tabindex={yearEnabled ? 0 : undefined}
      onclick={yearH.click}
      onkeydown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          if (yearEnabled) {
            onClick?.("year", displayedMonth.current, yearFile, false);
          }
        }
      }}
      oncontextmenu={yearH.context}
      onpointerenter={yearH.hover}
    >
      {displayedMonth.current.format("YYYY")}
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
