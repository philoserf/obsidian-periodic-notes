<script lang="ts">
  import type { TFile } from "obsidian";
  import { getContext } from "svelte";

  import type { Granularity } from "src/types";
  import { isMetaPressed } from "src/platform";
  import { DISPLAYED_MONTH } from "src/constants";
  import { canonicalKey } from "src/cacheSearch";
  import type { DisplayedMonth } from "./displayedMonth.svelte";
  import type { FileMap, EventHandlers } from "./types";
  import { activateOnKey } from "./utils";

  let {
    fileMap,
    onHover,
    onClick,
    onContextMenu,
    resetDisplayedMonth,
    activeFilePath = null,
  }: {
    fileMap: FileMap;
    onHover: EventHandlers["onHover"];
    onClick: EventHandlers["onClick"];
    onContextMenu: EventHandlers["onContextMenu"];
    resetDisplayedMonth: () => void;
    activeFilePath: string | null;
  } = $props();

  const displayedMonth = getContext<DisplayedMonth>(DISPLAYED_MONTH);

  let monthKey = $derived(canonicalKey("month", displayedMonth.current));
  let yearKey = $derived(canonicalKey("year", displayedMonth.current));
  let monthEnabled = $derived(fileMap.has(monthKey));
  let yearEnabled = $derived(fileMap.has(yearKey));
  let monthFile = $derived(fileMap.get(monthKey) ?? null);
  let yearFile = $derived(fileMap.get(yearKey) ?? null);
  let monthActive = $derived(
    monthFile !== null && monthFile.path === activeFilePath,
  );
  let yearActive = $derived(
    yearFile !== null && yearFile.path === activeFilePath,
  );

  // A disabled title has no note to open, so both fall back to jumping the
  // calendar home. The year branch used to do nothing, which was the only
  // inconsistency between the two.
  function activate(granularity: Granularity) {
    const enabled = granularity === "month" ? monthEnabled : yearEnabled;
    if (!enabled) {
      resetDisplayedMonth();
      return;
    }
    onClick(granularity, displayedMonth.current, false);
  }

  function makeHandlers(
    granularity: Granularity,
    getEnabled: () => boolean,
    getFile: () => TFile | null,
  ) {
    return {
      click: (event: MouseEvent) => {
        if (getEnabled()) {
          onClick(granularity, displayedMonth.current, isMetaPressed(event));
        } else {
          resetDisplayedMonth();
        }
      },
      hover: (event: PointerEvent) => {
        if (!getEnabled() || !event.target) return;
        onHover(
          granularity,
          displayedMonth.current,
          getFile(),
          event.target,
          isMetaPressed(event),
        );
      },
      context: (event: MouseEvent) => {
        const f = getFile();
        if (!getEnabled() || !f) return;
        // Otherwise the native menu can appear alongside the custom one.
        event.preventDefault();
        onContextMenu(f, event);
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
      class:active={monthActive}
      role={monthEnabled ? "button" : undefined}
      tabindex={monthEnabled ? 0 : undefined}
      onclick={monthH.click}
      onkeydown={activateOnKey(() => activate("month"))}
      oncontextmenu={monthH.context}
      onpointerenter={monthH.hover}
    >
      {displayedMonth.current.format("MMM")}
    </span>
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <span
      class="year"
      class:clickable={yearEnabled}
      class:active={yearActive}
      role={yearEnabled ? "button" : undefined}
      tabindex={yearEnabled ? 0 : undefined}
      onclick={yearH.click}
      onkeydown={activateOnKey(() => activate("year"))}
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

  .month.active,
  .year.active {
    background-color: var(--interactive-accent);
    border-radius: 4px;
    color: var(--text-on-accent);
    padding: 0 0.2em;
  }
</style>
