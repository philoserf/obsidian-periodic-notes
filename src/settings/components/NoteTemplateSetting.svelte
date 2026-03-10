<script lang="ts">
  import type { App } from "obsidian";
  import type { Readable } from "svelte/store";
  import type { Granularity, PeriodicConfig } from "src/types";
  import { FileSuggest } from "src/ui/fileSuggest";
  import { displayConfigs } from "src/commands";

  import { validateTemplate } from "../validation";

  let { app, granularity, config }: { app: App; granularity: Granularity; config: Readable<PeriodicConfig> } = $props();

  let error = $state("");
  let inputEl: HTMLInputElement;

  function validateOnBlur() {
    error = validateTemplate(app, inputEl.value);
  }

  function clearError() {
    error = "";
  }

  $effect(() => {
    error = validateTemplate(app, inputEl.value);
    const suggest = new FileSuggest(app, inputEl);
    return () => suggest.close();
  });
</script>

<div class="setting-item">
  <div class="setting-item-info">
    <div class="setting-item-name">
      {displayConfigs[granularity].periodicity.charAt(0).toUpperCase() + displayConfigs[granularity].periodicity.slice(1)} Note Template
    </div>
    <div class="setting-item-description">
      Choose the file to use as a template
    </div>
    {#if error}
      <div class="has-error">{error}</div>
    {/if}
  </div>
  <div class="setting-item-control">
    <input
      class:has-error={!!error}
      type="text"
      spellcheck={false}
      placeholder="e.g. templates/template-file"
      bind:value={$config.templatePath}
      bind:this={inputEl}
      onchange={validateOnBlur}
      oninput={clearError}
    />
  </div>
</div>

<style>
  .setting-item-control input {
    flex-grow: 1;
  }
</style>
