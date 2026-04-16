import type { Moment } from "moment";
import type { Component, TAbstractFile, TFile } from "obsidian";

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

    plugin.app.workspace.onLayoutReady(() => {
      const { vault, metadataCache, workspace } = plugin.app;
      component.registerEvent(vault.on("create", this.bump, this));
      // Delete and rename fire after NoteCache's handler, which already
      // removed the old entry from the index. isPeriodic(path) can return
      // false even for a file that was just a periodic note, so bump
      // unconditionally — getPeriodicNote self-heals stale entries.
      component.registerEvent(
        vault.on("delete", this.bumpUnconditionally, this),
      );
      component.registerEvent(
        vault.on("rename", this.bumpUnconditionally, this),
      );
      component.registerEvent(metadataCache.on("changed", this.bump, this));
      component.registerEvent(
        workspace.on("periodic-notes:resolve", this.bumpUnconditionally, this),
      );
      component.registerEvent(
        workspace.on(
          "periodic-notes:settings-updated",
          this.bumpUnconditionally,
          this,
        ),
      );
      this.bump();
    });
  }

  private bump(file?: TAbstractFile): void {
    if (file && !this.plugin.isPeriodic(file.path)) return;
    this.version++;
  }

  private bumpUnconditionally(): void {
    this.version++;
  }

  public getFile(date: Moment, granularity: Granularity): TFile | null {
    return this.plugin.getPeriodicNote(granularity, date);
  }

  public isGranularityEnabled(granularity: Granularity): boolean {
    return (
      this.plugin.settings.granularities[granularity]?.enabled ??
      granularity === "day"
    );
  }

  public getEnabledGranularities(): Granularity[] {
    return (["week", "month", "year"] as Granularity[]).filter(
      (g) => this.plugin.settings.granularities[g]?.enabled,
    );
  }
}
