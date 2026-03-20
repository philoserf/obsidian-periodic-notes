import type { Moment } from "moment";
import { addIcon, Plugin, type TFile } from "obsidian";

import { NoteCache } from "./cache";
import { CalendarView } from "./calendar/view";
import { getCommands, granularityLabels, showContextMenu } from "./commands";
import { DEFAULT_SETTINGS, VIEW_TYPE_CALENDAR } from "./constants";
import { getConfig, getFormat } from "./format";
import {
  calendarDayIcon,
  calendarMonthIcon,
  calendarWeekIcon,
  calendarYearIcon,
} from "./icons";
import { isMetaPressed } from "./platform";
import { SettingsTab } from "./settings";
import { applyTemplate, getNoteCreationPath, readTemplate } from "./template";
import {
  type CacheEntry,
  type Granularity,
  granularities,
  type Settings,
} from "./types";

const langToMomentLocale: Record<string, string> = {
  en: "en-gb",
  zh: "zh-cn",
  "zh-TW": "zh-tw",
  ru: "ru",
  ko: "ko",
  it: "it",
  id: "id",
  ro: "ro",
  "pt-BR": "pt-br",
  cz: "cs",
  da: "da",
  de: "de",
  es: "es",
  fr: "fr",
  no: "nn",
  pl: "pl",
  pt: "pt",
  tr: "tr",
  hi: "hi",
  nl: "nl",
  ar: "ar",
  ja: "ja",
};

function configureLocale(): void {
  const obsidianLang = localStorage.getItem("language") || "en";
  const systemLang = navigator.language?.toLowerCase();
  let momentLocale = langToMomentLocale[obsidianLang];
  if (systemLang?.startsWith(obsidianLang)) {
    momentLocale = systemLang;
  }
  const actual = window.moment.locale(momentLocale);
  console.debug(
    `[Periodic Notes] Configured locale: requested ${momentLocale}, got ${actual}`,
  );
}

interface OpenOpts {
  inNewSplit?: boolean;
}

export default class PeriodicNotesPlugin extends Plugin {
  public settings!: Settings;
  private ribbonEl!: HTMLElement | null;
  private cache!: NoteCache;

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

    const enabled = granularities.filter(
      (g) => this.settings.granularities[g].enabled,
    );
    if (enabled.length) {
      const granularity = enabled[0];
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
    this.settings = saved?.granularities
      ? saved
      : structuredClone(DEFAULT_SETTINGS);
  }

  public async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.configureRibbonIcons();
    this.app.workspace.trigger("periodic-notes:settings-updated");
  }

  public async createPeriodicNote(
    granularity: Granularity,
    date: Moment,
  ): Promise<TFile> {
    const config = getConfig(this.settings, granularity);
    const format = getFormat(this.settings, granularity);
    const filename = date.format(format);
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
    const destPath = await getNoteCreationPath(this.app, filename, config);
    return this.app.vault.create(destPath, rendered);
  }

  public getPeriodicNote(granularity: Granularity, date: Moment): TFile | null {
    return this.cache.getPeriodicNote(granularity, date);
  }

  public getPeriodicNotes(
    granularity: Granularity,
    date: Moment,
    includeFinerGranularities = false,
  ): CacheEntry[] {
    return this.cache.getPeriodicNotes(
      granularity,
      date,
      includeFinerGranularities,
    );
  }

  public isPeriodic(filePath: string, granularity?: Granularity): boolean {
    return this.cache.isPeriodic(filePath, granularity);
  }

  public findAdjacent(
    filePath: string,
    direction: "forwards" | "backwards",
  ): CacheEntry | null {
    return this.cache.findAdjacent(filePath, direction);
  }

  public findInCache(filePath: string): CacheEntry | null {
    return this.cache.find(filePath);
  }

  public async openPeriodicNote(
    granularity: Granularity,
    date: Moment,
    opts?: OpenOpts,
  ): Promise<void> {
    const { inNewSplit = false } = opts ?? {};
    const { workspace } = this.app;
    let file = this.cache.getPeriodicNote(granularity, date);
    if (!file) {
      file = await this.createPeriodicNote(granularity, date);
    }
    const leaf = inNewSplit ? workspace.getLeaf("split") : workspace.getLeaf();
    await leaf.openFile(file, { active: true });
  }
}
