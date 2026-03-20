import type { Moment } from "moment";
import type { Component, TAbstractFile, TFile } from "obsidian";
import { DEFAULT_FORMAT } from "src/constants";
import type PeriodicNotesPlugin from "src/main";
import type { Granularity } from "src/types";
import { get, type Writable, writable } from "svelte/store";

import type { FileMap, IMonth } from "./types";

export default class CalendarFileStore {
  // Svelte 5 runes don't track store auto-subscriptions.
  // Bumping a counter triggers subscribers to re-read plugin state.
  public store: Writable<number>;
  private plugin: PeriodicNotesPlugin;

  constructor(component: Component, plugin: PeriodicNotesPlugin) {
    this.plugin = plugin;
    this.store = writable(0);

    plugin.app.workspace.onLayoutReady(() => {
      const { vault, metadataCache, workspace } = plugin.app;
      component.registerEvent(vault.on("create", this.bump, this));
      component.registerEvent(vault.on("delete", this.bump, this));
      component.registerEvent(vault.on("rename", this.onRename, this));
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
      // Re-read cache after layout is ready (cache populates in its own onLayoutReady)
      this.bump();
    });
  }

  private bump(file?: TAbstractFile): void {
    if (file && !this.plugin.isPeriodic(file.path)) return;
    this.store.update((n) => n + 1);
  }

  private bumpUnconditionally(): void {
    this.store.update((n) => n + 1);
  }

  private onRename(file: TAbstractFile, oldPath: string): void {
    if (this.plugin.isPeriodic(file.path) || this.plugin.isPeriodic(oldPath)) {
      this.store.update((n) => n + 1);
    }
  }

  public getFile(date: Moment, granularity: Granularity): TFile | null {
    return this.plugin.getPeriodicNote(granularity, date);
  }

  public isGranularityEnabled(granularity: Granularity): boolean {
    const settings = get(this.plugin.settings);
    return settings[granularity]?.enabled ?? granularity === "day";
  }

  public getEnabledGranularities(): Granularity[] {
    const settings = get(this.plugin.settings);
    return (["week", "month", "year"] as Granularity[]).filter(
      (g) => settings[g]?.enabled,
    );
  }
}

export function fileMapKey(granularity: Granularity, date: Moment): string {
  return `${granularity}:${date.format(DEFAULT_FORMAT[granularity])}`;
}

export function computeFileMap(
  month: IMonth,
  getFile: (date: Moment, granularity: Granularity) => TFile | null,
  enabledGranularities: Granularity[],
): FileMap {
  const map: FileMap = new Map();
  const displayedMonth = month[1].days[0];

  for (const week of month) {
    for (const day of week.days) {
      map.set(fileMapKey("day", day), getFile(day, "day"));
    }
    if (enabledGranularities.includes("week")) {
      const weekStart = week.days[0];
      map.set(fileMapKey("week", weekStart), getFile(weekStart, "week"));
    }
  }

  if (enabledGranularities.includes("month")) {
    map.set(
      fileMapKey("month", displayedMonth),
      getFile(displayedMonth, "month"),
    );
  }
  if (enabledGranularities.includes("year")) {
    map.set(
      fileMapKey("year", displayedMonth),
      getFile(displayedMonth, "year"),
    );
  }

  return map;
}
