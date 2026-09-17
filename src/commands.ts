import {
  type App,
  type Command,
  Menu,
  Notice,
  type Point,
  TFile,
} from "obsidian";
import { getEnabledGranularities } from "./format";
import type PeriodicNotesPlugin from "./main";
import { reportFailure } from "./platform";
import type { CacheEntry, Granularity } from "./types";

interface GranularityLabel {
  periodicity: string;
  labelOpenPresent: string;
}

export const granularityLabels: Record<Granularity, GranularityLabel> = {
  day: {
    periodicity: "daily",
    labelOpenPresent: "Open today's daily note",
  },
  week: {
    periodicity: "weekly",
    labelOpenPresent: "Open this week's note",
  },
  month: {
    periodicity: "monthly",
    labelOpenPresent: "Open this month's note",
  },
  year: {
    periodicity: "yearly",
    labelOpenPresent: "Open this year's note",
  },
};

async function jumpToAdjacentNote(
  app: App,
  plugin: PeriodicNotesPlugin,
  direction: "forwards" | "backwards",
  meta: CacheEntry,
): Promise<void> {
  const adjacent = plugin.cache.findAdjacent(meta.filePath, direction);
  if (adjacent) {
    const file = app.vault.getAbstractFileByPath(adjacent.filePath);
    if (file && file instanceof TFile) {
      const leaf = app.workspace.getLeaf();
      await leaf.openFile(file, { active: true });
    }
  } else {
    const qualifier = direction === "forwards" ? "after" : "before";
    new Notice(
      `There's no ${granularityLabels[meta.granularity].periodicity} note ${qualifier} this`,
    );
  }
}

async function openAdjacentNote(
  plugin: PeriodicNotesPlugin,
  direction: "forwards" | "backwards",
  meta: CacheEntry,
): Promise<void> {
  const offset = direction === "forwards" ? 1 : -1;
  const adjacentDate = meta.date.clone().add(offset, meta.granularity);
  await plugin.openPeriodicNote(meta.granularity, adjacentDate);
}

export function getCommands(
  app: App,
  plugin: PeriodicNotesPlugin,
  granularity: Granularity,
): Command[] {
  const label = granularityLabels[granularity];

  const navCommand = (
    id: string,
    name: string,
    run: (entry: CacheEntry) => void | Promise<void>,
  ): Command => ({
    id,
    name,
    // Resolved once, not twice: checkCallback runs a second time to execute,
    // and the entry the check found is exactly what the handler needs.
    checkCallback: (checking: boolean) => {
      if (!plugin.settings.granularities[granularity].enabled) return false;
      const activeFile = app.workspace.getActiveFile();
      if (!activeFile) return false;
      const entry = plugin.cache.find(activeFile.path);
      if (entry?.granularity !== granularity) return false;
      if (checking) return true;
      // A dropped promise here is a silent failure: openFile rejects when the
      // vault refuses the path, and the command would appear to do nothing.
      // Same shape as main.ts's show-calendar callback.
      void Promise.resolve(run(entry)).catch((err) => {
        reportFailure(`${name} failed`, err);
      });
    },
  });

  return [
    {
      id: `open-${label.periodicity}-note`,
      name: label.labelOpenPresent,
      checkCallback: (checking: boolean) => {
        if (!plugin.settings.granularities[granularity].enabled) return false;
        if (checking) return true;
        plugin.openPeriodicNote(granularity, window.moment());
      },
    },
    navCommand(
      `next-${label.periodicity}-note`,
      `Jump forwards to closest ${label.periodicity} note`,
      (entry) => jumpToAdjacentNote(app, plugin, "forwards", entry),
    ),
    navCommand(
      `prev-${label.periodicity}-note`,
      `Jump backwards to closest ${label.periodicity} note`,
      (entry) => jumpToAdjacentNote(app, plugin, "backwards", entry),
    ),
    navCommand(
      `open-next-${label.periodicity}-note`,
      `Open next ${label.periodicity} note`,
      (entry) => openAdjacentNote(plugin, "forwards", entry),
    ),
    navCommand(
      `open-prev-${label.periodicity}-note`,
      `Open previous ${label.periodicity} note`,
      (entry) => openAdjacentNote(plugin, "backwards", entry),
    ),
  ];
}

export function showContextMenu(
  plugin: PeriodicNotesPlugin,
  position: Point,
): void {
  const menu = new Menu();
  const enabled = getEnabledGranularities(plugin.settings);

  for (const granularity of enabled) {
    const label = granularityLabels[granularity];
    menu.addItem((item) =>
      item
        .setTitle(label.labelOpenPresent)
        .setIcon(`calendar-${granularity}`)
        .onClick(() => plugin.openPeriodicNote(granularity, window.moment())),
    );
  }

  menu.showAtPosition(position);
}
