<script lang="ts">
  import type { App } from "obsidian";
  import type { Readable } from "svelte/store";

  import { FolderSuggest } from "src/ui/fileSuggest";
  import type { Granularity, PeriodicConfig } from "src/types";
  import { displayConfigs } from "src/commands";

  import { validateFolder } from "../validation";

  let { config, app, granularity }: { config: Readable<PeriodicConfig>; app: App; granularity: Granularity } = $props();

  let inputEl: HTMLInputElement;
  let error = $state("");

  function onChange() {
    error = validateFolder(app, inputEl.value);
  }

  function clearError() {
    error = "";
  }

  $effect(() => {
    if (!inputEl) return;
    error = validateFolder(app, inputEl.value);
    const suggest = new FolderSuggest(app, inputEl);
    return () => suggest.close();
  });
</script>

<div class="setting-item">
  <div class="setting-item-info">
    <div class="setting-item-name">Note Folder</div>
    <div class="setting-item-description">
      New {displayConfigs[granularity].periodicity} notes will be placed here
    </div>
    {#if error}
      <div class="has-error">{error}</div>
    {/if}
  </div>
  <div class="setting-item-control">
    <input
      bind:value={$config.folder}
      bind:this={inputEl}
      class:has-error={!!error}
      type="text"
      spellcheck={false}
      placeholder="e.g. folder 1/folder 2"
      onchange={onChange}
      oninput={clearError}
    />
  </div>
</div>

<style>
  .setting-item-control input {
    flex-grow: 1;
  }
</style>
