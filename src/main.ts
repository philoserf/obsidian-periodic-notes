import type { Moment } from "moment";
import { addIcon, Notice, normalizePath, Plugin, TFile } from "obsidian";

import { NoteCache } from "./cache";
import { CalendarView } from "./calendar/view";
import { getCommands, granularityLabels, showContextMenu } from "./commands";
import { VIEW_TYPE_CALENDAR } from "./constants";
import { getConfig, getFormat } from "./format";
import {
  calendarDayIcon,
  calendarMonthIcon,
  calendarWeekIcon,
  calendarYearIcon,
} from "./icons";
import { configureLocale } from "./locale";
import { canonicalFolder } from "./paths";
import { isMetaPressed } from "./platform";
import { SettingsTab } from "./settings";
import { sanitizeSettings } from "./settingsLoad";
import { getNoteCreationPath, readTemplate } from "./template";
import { applyTemplate } from "./templateRender";
import {
  type Granularity,
  granularities,
  type NoteConfig,
  type Settings,
} from "./types";

interface OpenOpts {
  inNewSplit?: boolean;
}

export default class PeriodicNotesPlugin extends Plugin {
  public declare settings: Settings;
  private ribbonEl!: HTMLElement | null;
  // Public because commands and the calendar read the index directly: a
  // forwarder here would only pass the call along. Not `readonly` — it is
  // built in onload, not in the constructor.
  public cache!: NoteCache;
  // The settings the cache index is built from, as last persisted. Compared on
  // save so only a change that actually affects indexing costs a vault rescan.
  private indexingSnapshot = "";
  // Creations in progress, keyed by destination path. The index only learns of
  // a file from the vault's "create" event, so two callers racing to open the
  // same note both see a cache miss; without this the second reaches
  // vault.create and throws for a note that was created correctly.
  private creating = new Map<string, Promise<TFile>>();

  async onload(): Promise<void> {
    addIcon("calendar-day", calendarDayIcon);
    addIcon("calendar-week", calendarWeekIcon);
    addIcon("calendar-month", calendarMonthIcon);
    addIcon("calendar-year", calendarYearIcon);

    await this.loadSettings();
    configureLocale();

    this.ribbonEl = null;
    this.cache = new NoteCache(this.app, this);

    this.openPeriodicNote = this.openPeriodicNote.bind(this);
    this.addSettingTab(new SettingsTab(this.app, this));

    this.configureRibbonIcons();
    this.configureCommands();

    this.registerView(
      VIEW_TYPE_CALENDAR,
      (leaf) => new CalendarView(leaf, this),
    );

    this.addCommand({
      id: "show-calendar",
      name: "Show calendar",
      checkCallback: (checking: boolean) => {
        if (checking) {
          return (
            this.app.workspace.getLeavesOfType(VIEW_TYPE_CALENDAR).length === 0
          );
        }
        this.app.workspace.getRightLeaf(false)?.setViewState({
          type: VIEW_TYPE_CALENDAR,
        });
      },
    });
  }

  private configureRibbonIcons(): void {
    this.ribbonEl?.detach();

    const granularity = granularities.find(
      (g) => this.settings.granularities[g].enabled,
    );
    if (granularity) {
      const label = granularityLabels[granularity];
      this.ribbonEl = this.addRibbonIcon(
        `calendar-${granularity}`,
        label.labelOpenPresent,
        (e: MouseEvent) => {
          if (e.type !== "auxclick") {
            this.openPeriodicNote(granularity, window.moment(), {
              inNewSplit: isMetaPressed(e),
            });
          }
        },
      );
      this.ribbonEl.addEventListener("contextmenu", (e: MouseEvent) => {
        e.preventDefault();
        showContextMenu(this, { x: e.pageX, y: e.pageY });
      });
    }
  }

  private configureCommands(): void {
    for (const granularity of granularities) {
      getCommands(this.app, this, granularity).forEach(
        this.addCommand.bind(this),
      );
    }
  }

  async loadSettings(): Promise<void> {
    const saved = await this.loadData();
    this.settings = sanitizeSettings(saved, (folder) =>
      canonicalFolder(normalizePath(folder)),
    );
    this.indexingSnapshot = this.indexingSnapshotOf(this.settings);
  }

  // Only `enabled`, `format` and `folder` decide what the cache indexes;
  // templatePath does not, so editing it must not trigger a rescan.
  private indexingSnapshotOf(settings: Settings): string {
    return JSON.stringify(
      granularities.map((g) => {
        const { enabled, format, folder } = settings.granularities[g];
        return [enabled, format, folder];
      }),
    );
  }

  public async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.configureRibbonIcons();

    // NoteCache.reset() re-walks every configured folder and re-parses every
    // filename, so firing this on each debounce tick meant a full vault scan
    // per typing pause — including for fields the index never reads.
    const snapshot = this.indexingSnapshotOf(this.settings);
    if (snapshot !== this.indexingSnapshot) {
      this.indexingSnapshot = snapshot;
      this.app.workspace.trigger("periodic-notes:settings-updated");
    }
  }

  // Get-or-create: returning a note that already exists is the right answer for
  // every caller, all of which are opening it.
  public async createPeriodicNote(
    granularity: Granularity,
    date: Moment,
  ): Promise<TFile> {
    const config = getConfig(this.settings, granularity);
    const format = getFormat(this.settings, granularity);
    const filename = date.format(format);
    const destPath = await getNoteCreationPath(this.app, filename, config);

    // Covers a note created since the caller checked the cache — by a second
    // click, by another device, or outside Obsidian entirely.
    const existing = this.app.vault.getAbstractFileByPath(destPath);
    if (existing instanceof TFile) return existing;

    const inFlight = this.creating.get(destPath);
    if (inFlight) return inFlight;

    const creation = this.writeNote(
      destPath,
      filename,
      granularity,
      date,
      config,
      format,
    ).finally(() => this.creating.delete(destPath));
    this.creating.set(destPath, creation);
    return creation;
  }

  private async writeNote(
    destPath: string,
    filename: string,
    granularity: Granularity,
    date: Moment,
    config: NoteConfig,
    format: string,
  ): Promise<TFile> {
    const templateContents = await readTemplate(
      this.app,
      config.templatePath,
      granularity,
    );
    const rendered = applyTemplate(
      filename,
      granularity,
      date,
      format,
      templateContents,
    );
    return this.app.vault.create(destPath, rendered);
  }

  public async openPeriodicNote(
    granularity: Granularity,
    date: Moment,
    opts?: OpenOpts,
  ): Promise<void> {
    const { inNewSplit = false } = opts ?? {};
    const { workspace } = this.app;
    try {
      let file = this.cache.getPeriodicNote(granularity, date);
      if (!file) {
        file = await this.createPeriodicNote(granularity, date);
      }
      const leaf = inNewSplit
        ? workspace.getLeaf("split")
        : workspace.getLeaf();
      await leaf.openFile(file, { active: true });
    } catch (err) {
      const label = date.format(getFormat(this.settings, granularity));
      console.error(
        `[Periodic Notes] failed to open ${granularity} note "${label}"`,
        err,
      );
      // Carry the message: the folder-collision error from ensureFolderExists
      // says exactly what is wrong and where, which is no use in a console the
      // user does not have open.
      new Notice(
        err instanceof Error
          ? `Periodic Notes: failed to open ${granularity} note "${label}" — ${err.message}`
          : `Periodic Notes: failed to open ${granularity} note "${label}". See console for details.`,
      );
    }
  }
}
