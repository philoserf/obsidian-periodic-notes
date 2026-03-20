import { Menu, type Point } from "obsidian";
import { get } from "svelte/store";
import { displayConfigs } from "./commands";
import type PeriodicNotesPlugin from "./main";
import { getEnabledGranularities } from "./settings/utils";

export function showFileMenu(
  plugin: PeriodicNotesPlugin,
  position: Point,
): void {
  const contextMenu = new Menu();

  getEnabledGranularities(get(plugin.settings)).forEach((granularity) => {
    const config = displayConfigs[granularity];
    contextMenu.addItem((item) =>
      item
        .setTitle(config.labelOpenPresent)
        .setIcon(`calendar-${granularity}`)
        .onClick(() => {
          plugin.openPeriodicNote(granularity, window.moment());
        }),
    );
  });

  contextMenu.showAtPosition(position);
}
