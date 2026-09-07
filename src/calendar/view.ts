import type { Moment } from "moment";
import {
  ItemView,
  Menu,
  type TAbstractFile,
  type TFile,
  type WorkspaceLeaf,
} from "obsidian";
import { HUMANIZE_FORMAT, VIEW_TYPE_CALENDAR } from "src/constants";
import type PeriodicNotesPlugin from "src/main";
import type { Granularity } from "src/types";
import { mount, unmount } from "svelte";
import Calendar from "./Calendar.svelte";
import CalendarStore from "./calendarStore.svelte";

interface CalendarExports {
  tick: () => void;
  setActiveFilePath: (path: string | null) => void;
}

export class CalendarView extends ItemView {
  private calendar!: CalendarExports;
  private plugin: PeriodicNotesPlugin;
  // Mirrors what the calendar was last told, so a rename can tell whether the
  // file that moved is the one being highlighted.
  private activeFilePath: string | null = null;
  // The layout-ready sync below is deferred, so it can fire after the leaf has
  // been closed and the component unmounted.
  private closed = false;

  constructor(leaf: WorkspaceLeaf, plugin: PeriodicNotesPlugin) {
    super(leaf);
    this.plugin = plugin;

    this.registerEvent(
      this.app.workspace.on("file-open", this.onFileOpen.bind(this)),
    );
    // A pure rename changes the leaf's file without the file "opening", so
    // file-open does not fire and the tracked path would keep pointing at a
    // path nothing matches any more.
    this.registerEvent(this.app.vault.on("rename", this.onRename.bind(this)));
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

  async onClose(): Promise<void> {
    this.closed = true;
    if (this.calendar) {
      unmount(this.calendar);
    }
  }

  async onOpen(): Promise<void> {
    const fileStore = new CalendarStore(this, this.plugin);

    // svelte-check verifies Calendar.svelte's exports match this shape.
    this.calendar = mount(Calendar, {
      target: this.contentEl,
      props: {
        fileStore,
        onHover: this.onHover.bind(this),
        onClick: this.onClick.bind(this),
        onContextMenu: this.onContextMenu.bind(this),
      },
    }) as CalendarExports;

    // `today` was only ever reassigned from a file-open, so the highlight and
    // Nav's showingCurrentMonth stayed pinned to yesterday when the app sat
    // open overnight. An interval rather than a timer to midnight: a timeout
    // fires late after the machine sleeps and never reschedules. tick() no-ops
    // unless the day actually changed.
    this.registerInterval(
      window.setInterval(() => this.calendar?.tick(), 60_000),
    );

    // No file-open fires for a file that is already open, so a calendar
    // revealed next to an open periodic note would render with nothing
    // highlighted until the user switched away and back. Deferred because
    // onFileOpen returns early until layout is ready — which is exactly the
    // case when the sidebar is restored at startup with a note already active.
    this.app.workspace.onLayoutReady(() => this.onFileOpen(null));
  }

  private onHover(
    granularity: Granularity,
    date: Moment,
    file: TFile | null,
    targetEl: EventTarget,
    metaPressed: boolean,
  ): void {
    if (!metaPressed) return;
    // The locale short date ("9/1/2026") describes a day, so using it for a
    // month or year header labelled the wrong thing entirely.
    const formattedDate = date.format(
      HUMANIZE_FORMAT[granularity] ?? "YYYY-MM-DD",
    );
    this.app.workspace.trigger(
      "link-hover",
      this,
      targetEl,
      formattedDate,
      file?.path ?? "",
    );
  }

  private onClick(
    granularity: Granularity,
    date: Moment,
    inNewSplit: boolean,
  ): void {
    this.plugin.openPeriodicNote(granularity, date, { inNewSplit });
  }

  private onContextMenu(file: TFile | null, event: MouseEvent): void {
    if (!file) return;
    // No custom items: Obsidian's own file-menu handlers contribute Delete —
    // with its confirmation and the vault's "Deleted files" preference — plus
    // Rename and whatever other plugins add. The item that used to be here
    // called vault.trash(file, true), which hard-coded the *system* trash,
    // asked nothing, and dropped the promise so a failure was invisible.
    const menu = new Menu();
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
    if (this.closed || !this.app.workspace.layoutReady) return;
    if (this.calendar) {
      const path = this.app.workspace.getActiveFile()?.path ?? null;
      this.activeFilePath = path;
      this.calendar.setActiveFilePath(path);
      this.calendar.tick();
    }
  }

  private onRename(file: TAbstractFile, oldPath: string): void {
    if (this.closed || !this.calendar) return;
    if (this.activeFilePath === null || oldPath !== this.activeFilePath) return;
    this.activeFilePath = file.path;
    this.calendar.setActiveFilePath(file.path);
  }
}
