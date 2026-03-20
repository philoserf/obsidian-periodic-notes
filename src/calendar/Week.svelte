<script lang="ts">
  import type { Moment } from "moment";

  import { isMetaPressed } from "src/platform";
  import { fileMapKey } from "./store";
  import type { FileMap, EventHandlers } from "./types";
  import { getStartOfWeek } from "./utils";

  let {
    weekNum,
    days,
    onHover,
    onClick,
    onContextMenu,
    fileMap,
    activeFilePath = null,
  }: {
    weekNum: number;
    days: Moment[];
    onHover: EventHandlers["onHover"];
    onClick: EventHandlers["onClick"];
    onContextMenu: EventHandlers["onContextMenu"];
    fileMap: FileMap;
    activeFilePath: string | null;
  } = $props();

  let startOfWeek = $derived(getStartOfWeek(days));
  let file = $derived(fileMap.get(fileMapKey("week", startOfWeek)) ?? null);

  function handleHover(event: PointerEvent) {
    if (event.target) {
      onHover?.("week", startOfWeek, file, event.target, isMetaPressed(event));
    }
  }
</script>

<td>
  <div
    role="button"
    tabindex="0"
    class="week-num"
    class:active={file !== null && file.path === activeFilePath}
    onclick={onClick &&
      ((e) => onClick("week", startOfWeek, file, isMetaPressed(e)))}
    onkeydown={onClick &&
      ((e) =>
        (e.key === "Enter" || e.key === " ") &&
        onClick("week", startOfWeek, file, false))}
    oncontextmenu={onContextMenu &&
      ((e) => onContextMenu("week", startOfWeek, file, e))}
    onpointerenter={handleHover}
  >
    {weekNum}
  </div>
</td>

<style>
  td {
    border-right: 1px solid var(--background-modifier-border);
  }

  .week-num {
    background-color: var(--color-background-weeknum);
    border-radius: 4px;
    color: var(--color-text-weeknum);
    cursor: pointer;
    font-size: 0.65em;
    height: 100%;
    padding: 4px;
    text-align: center;
    transition:
      background-color 0.1s ease-in,
      color 0.1s ease-in;
    vertical-align: baseline;
  }

  .week-num:hover {
    background-color: var(--interactive-hover);
  }

  .week-num.active:hover {
    background-color: var(--interactive-accent-hover);
  }

  .active {
    color: var(--text-on-accent);
    background-color: var(--interactive-accent);
  }
</style>
