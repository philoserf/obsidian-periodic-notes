<script lang="ts">
  import type { Moment } from "moment";
  import type { TFile } from "obsidian";
  import { getContext } from "svelte";
  import type { Writable } from "svelte/store";

  import type { Granularity } from "src/types";
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
            $displayedMonth,
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
          $displayedMonth,
          getFile(),
          event.target,
          isMetaPressed(event),
        );
      },
      context: (event: MouseEvent) => {
        const f = getFile();
        if (getEnabled() && f) {
          onContextMenu?.(granularity, $displayedMonth, f, event);
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
    <span
      class="month"
      class:clickable={monthEnabled}
      role={monthEnabled ? "button" : undefined}
      tabindex={monthEnabled ? 0 : undefined}
      onclick={monthH.click}
      onkeydown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          if (monthEnabled) {
            onClick?.("month", $displayedMonth, monthFile, false);
          } else {
            resetDisplayedMonth();
          }
        }
      }}
      oncontextmenu={monthH.context}
      onpointerenter={monthH.hover}
    >
      {$displayedMonth.format("MMM")}
    </span>
    <span
      class="year"
      class:clickable={yearEnabled}
      role={yearEnabled ? "button" : undefined}
      tabindex={yearEnabled ? 0 : undefined}
      onclick={yearH.click}
      onkeydown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          if (yearEnabled) {
            onClick?.("year", $displayedMonth, yearFile, false);
          }
        }
      }}
      oncontextmenu={yearH.context}
      onpointerenter={yearH.hover}
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
