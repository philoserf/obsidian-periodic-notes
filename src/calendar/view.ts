import type { Moment } from "moment";
import { ItemView, Menu, type TFile, type WorkspaceLeaf } from "obsidian";
import type PeriodicNotesPlugin from "src/main";
import type { Granularity } from "src/types";
import { mount, unmount } from "svelte";
import Calendar from "./Calendar.svelte";
import { VIEW_TYPE_CALENDAR } from "./constants";
import CalendarFileStore from "./fileStore";

interface CalendarExports {
  tick: () => void;
  setDisplayedMonth: (date: Moment) => void;
}

export class CalendarView extends ItemView {
  private calendar!: CalendarExports;
  private plugin: PeriodicNotesPlugin;
  private activeFilePath: string | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: PeriodicNotesPlugin) {
    super(leaf);
    this.plugin = plugin;

    this.registerEvent(
      this.app.workspace.on("file-open", this.onFileOpen.bind(this)),
    );
  }

  getViewType(): string {
    return VIEW_TYPE_CALENDAR;
  }

  getDisplayText(): string {
    return "Calendar";
  }

  getIcon(): string {
    return "calendar-day";
  }

  onClose(): Promise<void> {
    if (this.calendar) {
      unmount(this.calendar);
    }
    return Promise.resolve();
  }

  async onOpen(): Promise<void> {
    const fileStore = new CalendarFileStore(this, this.plugin);

    const cal = mount(Calendar, {
      target: this.contentEl,
      props: {
        fileStore,
        activeFilePath: this.activeFilePath,
        onHover: this.onHover.bind(this),
        onClick: this.onClick.bind(this),
        onContextMenu: this.onContextMenu.bind(this),
      },
    });
    if (!("tick" in cal && "setDisplayedMonth" in cal)) {
      throw new Error("Calendar component missing expected exports");
    }
    this.calendar = cal as CalendarExports;
  }

  private onHover(
    granularity: Granularity,
    date: Moment,
    file: TFile | null,
    targetEl: EventTarget,
    metaPressed: boolean,
  ): void {
    if (!metaPressed) return;
    const formattedDate = date.format(
      granularity === "day"
        ? "YYYY-MM-DD"
        : date.localeData().longDateFormat("L"),
    );
    this.app.workspace.trigger(
      "link-hover",
      this,
      targetEl,
      formattedDate,
      file?.path,
    );
  }

  private onClick(
    granularity: Granularity,
    date: Moment,
    _existingFile: TFile | null,
    inNewSplit: boolean,
  ): void {
    this.plugin.openPeriodicNote(granularity, date, { inNewSplit });
  }

  private onContextMenu(
    _granularity: Granularity,
    _date: Moment,
    file: TFile | null,
    event: MouseEvent,
  ): void {
    if (!file) return;
    const menu = new Menu();
    menu.addItem((item) =>
      item
        .setTitle("Delete")
        .setIcon("trash")
        .onClick(() => {
          this.app.vault.trash(file, true);
        }),
    );
    this.app.workspace.trigger(
      "file-menu",
      menu,
      file,
      "calendar-context-menu",
      null,
    );
    menu.showAtPosition({ x: event.pageX, y: event.pageY });
  }

  private onFileOpen(_file: TFile | null): void {
    if (!this.app.workspace.layoutReady) return;
    const file = this.app.workspace.getActiveFile();
    this.activeFilePath = file?.path ?? null;

    if (this.calendar) {
      this.calendar.tick();

      if (file) {
        const cached = this.plugin.findInCache(file.path);
        if (cached) {
          this.calendar.setDisplayedMonth(cached.date);
        }
      }
    }
  }

  public revealActiveNote(): void {
    if (!this.calendar) return;
    const file = this.app.workspace.getActiveFile();
    if (!file) return;

    const cached = this.plugin.findInCache(file.path);
    if (cached) {
      this.calendar.setDisplayedMonth(cached.date);
    }
  }
}
