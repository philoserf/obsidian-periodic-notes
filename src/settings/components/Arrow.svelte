<script lang="ts">
  import { setIcon } from "obsidian";

  let { isExpanded }: { isExpanded: boolean } = $props();

  let arrowEl: HTMLElement;

  $effect(() => {
    if (arrowEl) setIcon(arrowEl, "chevron-right");
  });
</script>

<div class="arrow" class:expanded={isExpanded} bind:this={arrowEl}></div>

<style>
  .arrow {
    align-items: center;
    display: flex;
    margin-right: 0.6em;
    transition: 0.2s transform ease-in;
  }

  .expanded {
    transform: rotate(90deg);
  }
</style>
