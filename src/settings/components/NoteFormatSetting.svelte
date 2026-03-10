<script lang="ts">
  import type { Readable } from "svelte/store";

  import { DEFAULT_FORMAT } from "src/constants";
  import type { Granularity, PeriodicConfig } from "src/types";
  import { displayConfigs } from "src/commands";

  import { validateFormat, validateFormatComplexity } from "../validation";

  let { granularity, config }: { granularity: Granularity; config: Readable<PeriodicConfig> } = $props();

  let inputEl: HTMLInputElement;
  let error = $state("");
  let warning = $state("");

  const defaultFormat = $derived(DEFAULT_FORMAT[granularity]);
  let value = $derived($config.format || "");

  $effect(() => {
    if (!inputEl) return;
    error = validateFormat(inputEl.value, granularity);
    warning = validateFormatComplexity(inputEl.value, granularity);
  });

  function clearError() {
    error = "";
  }

  function onChange() {
    error = validateFormat(inputEl.value, granularity);
    warning = validateFormatComplexity(inputEl.value, granularity);
  }
</script>

<div class="setting-item">
  <div class="setting-item-info">
    <div class="setting-item-name">Format</div>
    <div class="setting-item-description">
      <a href="https://momentjs.com/docs/#/displaying/format/"
        >Syntax Reference</a
      >
      <div>
        Your current syntax looks like this: <b class="u-pop"
          >{window.moment().format(value || defaultFormat)}
        </b>
      </div>
    </div>
    {#if error}
      <div class="has-error">{error}</div>
    {:else if warning !== "valid"}
      <div class="alert-warning">
        {#if warning === "loose-parsing"}
          Your filename format cannot be parsed. If you would still like to use
          this format for your {displayConfigs[granularity].periodicity} notes, you
          will need to include the following in the frontmatter of your template
          file:
          <pre><code>{granularity}: {DEFAULT_FORMAT[granularity]}</code></pre>
        {:else if warning === "fragile-basename"}
          Your base filename is not uniquely identifiable. If you would still
          like to use this format, it is recommended that you include the
          following in the frontmatter of your daily note template:
          <pre><code>{granularity}: {DEFAULT_FORMAT[granularity]}</code></pre>
        {/if}
      </div>
    {/if}
  </div>
  <div class="setting-item-control">
    <input
      bind:value={$config.format}
      bind:this={inputEl}
      class:has-error={!!error}
      type="text"
      spellcheck={false}
      placeholder={defaultFormat}
      onchange={onChange}
      oninput={clearError}
    />
  </div>
</div>

<style>
  .alert-warning {
    color: var(--text-muted);
    font-size: 80%;
    margin-top: 0.6em;
  }
  .setting-item-control input {
    flex-grow: 1;
  }
</style>
