import type { Moment } from "moment";
import { addIcon, Notice, normalizePath, Plugin, TFile } from "obsidian";

import { NoteCache } from "./cache";
import { CalendarView } from "./calendar/view";
import { getCommands, granularityLabels, showContextMenu } from "./commands";
import { VIEW_TYPE_CALENDAR } from "./constants";
import { getConfig, getEnabledGranularities, getFormat } from "./format";
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
  // One icon per enabled granularity, in canonical order. Rebuilt only when
  // that set changes — see configureRibbonIcons.
  private ribbonEls: HTMLElement[] = [];
  private ribbonKey = "";
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
    // moment's locale is global to the app, so put it back on unload.
    this.register(configureLocale());

    // addChild, not a bare field: Component.registerEvent only arranges teardown
    // during the component's own unload, and nothing else would ever unload the
    // cache. Without this its five vault listeners survive a disable, and a
    // disabled plugin goes on applying templates to newly created files.
    this.cache = this.addChild(new NoteCache(this.app, this));

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
    const enabled = getEnabledGranularities(this.settings);
    const key = enabled.join(",");
    // saveSettings calls this on every save, and saves are debounced per
    // keystroke burst across three text fields. Only the Enabled toggle can
    // change what the ribbon shows, so everything else returns here — which is
    // also what bounds addRibbonIcon's own per-call unload registration, since
    // detach() does not undo it.
    if (key === this.ribbonKey) return;
    this.ribbonKey = key;

    // Cleared before the loop, so a throw partway through cannot leave the
    // array pointing at elements that are no longer on screen.
    for (const el of this.ribbonEls) el.detach();
    this.ribbonEls = [];

    for (const granularity of enabled) {
      const label = granularityLabels[granularity];
      const el = this.addRibbonIcon(
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
      // registerDomEvent, not addEventListener: the listener closes over `this`
      // and would otherwise keep a detached element reachable for the life of
      // the app.
      this.registerDomEvent(el, "contextmenu", (e: MouseEvent) => {
        e.preventDefault();
        showContextMenu(this, { x: e.pageX, y: e.pageY });
      });
      this.ribbonEls.push(el);
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
