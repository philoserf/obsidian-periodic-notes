<script lang="ts">
  import { getContext } from "svelte";

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

  // "MMM" and "YYYY" are the two titles; everything else about them is the
  // same shape, so it is derived once per granularity rather than twice by
  // hand. Keyed by granularity so the each block reuses the spans.
  const TITLES = [
    { granularity: "month", format: "MMM" },
    { granularity: "year", format: "YYYY" },
  ] as const;

  const titles = $derived(
    TITLES.map(({ granularity, format }) => {
      const key = canonicalKey(granularity, displayedMonth.current);
      // Presence in the map is the enabled signal for month and year, where a
      // day cell gets an explicit prop — see THEORY.md on the two signals.
      const enabled = fileMap.has(key);
      const file = fileMap.get(key) ?? null;

      // A disabled title has no note to open, so both fall back to jumping the
      // calendar home. The year branch used to do nothing, which was the only
      // inconsistency between the two.
      const open = (inNewSplit: boolean) => {
        if (!enabled) {
          resetDisplayedMonth();
          return;
        }
        onClick(granularity, displayedMonth.current, inNewSplit);
      };

      return {
        granularity,
        label: displayedMonth.current.format(format),
        enabled,
        active: file !== null && file.path === activeFilePath,
        click: (event: MouseEvent) => open(isMetaPressed(event)),
        key: activateOnKey(() => open(false)),
        hover: (event: PointerEvent) => {
          if (!enabled || !event.target) return;
          onHover(
            granularity,
            displayedMonth.current,
            file,
            event.target,
            isMetaPressed(event),
          );
        },
        context: (event: MouseEvent) => {
          if (!enabled || !file) return;
          // Otherwise the native menu can appear alongside the custom one.
          event.preventDefault();
          onContextMenu(file, event);
        },
      };
    }),
  );
</script>

<div>
  <span class="title">
    {#each titles as title (title.granularity)}
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <span
        class:month={title.granularity === "month"}
        class:year={title.granularity === "year"}
        class:clickable={title.enabled}
        class:active={title.active}
        role={title.enabled ? "button" : undefined}
        tabindex={title.enabled ? 0 : undefined}
        onclick={title.click}
        onkeydown={title.key}
        oncontextmenu={title.context}
        onpointerenter={title.hover}
      >
        {title.label}
      </span>
    {/each}
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
