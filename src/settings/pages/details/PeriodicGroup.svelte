<script lang="ts">
  import type { App } from "obsidian";
  import { slide } from "svelte/transition";
  import { displayConfigs } from "src/commands";
  import NoteFormatSetting from "src/settings/components/NoteFormatSetting.svelte";
  import NoteTemplateSetting from "src/settings/components/NoteTemplateSetting.svelte";
  import NoteFolderSetting from "src/settings/components/NoteFolderSetting.svelte";
  import type { Granularity } from "src/types";
  import Arrow from "src/settings/components/Arrow.svelte";
  import { DEFAULT_PERIODIC_CONFIG } from "src/constants";
  import type { Settings } from "src/settings";
  import type { Writable } from "svelte/store";
  import writableDerived from "svelte-writable-derived";
  import OpenAtStartupSetting from "src/settings/components/OpenAtStartupSetting.svelte";

  let { app, granularity, settings }: {
    app: App;
    granularity: Granularity;
    settings: Writable<Settings>;
  } = $props();

  let displayConfig = $derived(displayConfigs[granularity]);
  let isExpanded = $state(false);

  // svelte-ignore state_referenced_locally
  let config = writableDerived(
    settings,
    ($settings) => $settings[granularity] ?? { ...DEFAULT_PERIODIC_CONFIG },
    (reflecting, $settings) => {
      $settings[granularity] = reflecting;
      return $settings;
    },
  );

  function toggleExpand() {
    isExpanded = !isExpanded;
  }
</script>

<div class="periodic-group">
  <div
    class="setting-item setting-item-heading periodic-group-heading"
    role="button"
    tabindex="0"
    onclick={toggleExpand}
    onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') toggleExpand(); }}
  >
    <div class="setting-item-info">
      <h3 class="setting-item-name periodic-group-title">
        <Arrow {isExpanded} />
        {displayConfig.periodicity.charAt(0).toUpperCase() + displayConfig.periodicity.slice(1)} Notes
        {#if $config.openAtStartup}
          <span class="badge">Opens at startup</span>
        {/if}
      </h3>
    </div>
    <div class="setting-item-control">
      <label
        class="checkbox-container"
        class:is-enabled={$config.enabled}
      >
        <input
          type="checkbox"
          bind:checked={$config.enabled}
          style="display: none;"
        />
      </label>
    </div>
  </div>
  {#if isExpanded}
    <div
      class="periodic-group-content"
      in:slide={{ duration: 300 }}
      out:slide={{ duration: 300 }}
    >
      <NoteFormatSetting {config} {granularity} />
      <NoteFolderSetting {app} {config} {granularity} />
      <NoteTemplateSetting {app} {config} {granularity} />
      <OpenAtStartupSetting {config} {settings} {granularity} />
    </div>
  {/if}
</div>

<style lang="scss">
  .periodic-group-title {
    display: flex;
  }

  .badge {
    font-style: italic;
    margin-left: 1em;
    color: var(--text-muted);
    font-weight: 500;
    font-size: 70%;
  }

  .periodic-group {
    background: var(--background-primary-alt);
    border: 1px solid var(--background-modifier-border);
    border-radius: 16px;

    &:not(:last-of-type) {
      margin-bottom: 24px;
    }
  }

  .periodic-group-heading {
    cursor: pointer;
    padding: 24px;

    h3 {
      font-size: 1.1em;
      margin: 0;
    }
  }

  .periodic-group-content {
    padding: 24px;
  }
</style>
