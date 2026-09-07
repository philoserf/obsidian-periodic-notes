import type { Moment } from "moment";
import type { Component, TFile } from "obsidian";

import { getEnabledGranularities } from "src/format";
import type PeriodicNotesPlugin from "src/main";
import type { Granularity } from "src/types";

export default class CalendarStore {
  // Bumped on any vault/metadata event that may have changed the
  // periodic-note landscape. Consumers read this inside a $derived
  // or $effect to re-compute derived state (e.g., the FileMap).
  version = $state(0);
  private plugin: PeriodicNotesPlugin;

  constructor(component: Component, plugin: PeriodicNotesPlugin) {
    this.plugin = plugin;

    // onLayoutReady is deferred, and the leaf can be closed before it runs.
    // component.registerEvent on an already-unloaded component would never be
    // torn down again.
    let closed = false;
    component.register(() => {
      closed = true;
    });

    plugin.app.workspace.onLayoutReady(() => {
      if (closed) return;
      const { vault, metadataCache, workspace } = plugin.app;
      component.registerEvent(vault.on("delete", this.bump, this));
      component.registerEvent(vault.on("rename", this.bump, this));
      component.registerEvent(metadataCache.on("changed", this.bump, this));
      component.registerEvent(
        workspace.on("periodic-notes:resolve", this.bump, this),
      );
      component.registerEvent(
        workspace.on("periodic-notes:settings-updated", this.bump, this),
      );
      this.bump();
    });
  }

  // Unguarded, and every registration uses it. Filtering on whether the file
  // is already indexed only skipped a re-derive of computeFileMap — a 50-entry
  // Map of Map.get lookups — and cost a read of NoteCache's index that made
  // this store's correctness depend on NoteCache having wired its own
  // listeners first (#178).
  private bump(): void {
    this.version++;
  }

  public getFile(date: Moment, granularity: Granularity): TFile | null {
    return this.plugin.cache.getPeriodicNote(granularity, date);
  }

  public getEnabledGranularities(): Granularity[] {
    return getEnabledGranularities(this.plugin.settings);
  }
}
