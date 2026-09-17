import type { Moment } from "moment";
import {
  type App,
  type CachedMetadata,
  Component,
  parseFrontMatterEntry,
  type TAbstractFile,
  TFile,
  TFolder,
} from "obsidian";

import { CacheIndex } from "./cacheIndex";
import { resolveFile } from "./cacheResolve";
import type PeriodicNotesPlugin from "./main";
import { reportFailure } from "./platform";
import { applyTemplateToFile } from "./template";
import {
  type CacheEntry,
  type Granularity,
  getEnabledGranularities,
} from "./types";

export class NoteCache extends Component {
  private index = new CacheIndex();

  constructor(
    readonly app: App,
    readonly plugin: PeriodicNotesPlugin,
  ) {
    super();
  }

  // Wiring lives here rather than in the constructor so it happens only for a
  // component that was actually loaded — and so Component.unload() tears every
  // registration down again when the plugin is disabled.
  onload(): void {
    // onLayoutReady defers whenever layout is not ready yet, and the component
    // can be unloaded before it fires — enabled at app start, disabled from
    // Settings while the workspace is still restoring. registerEvent on an
    // already-unloaded component has nothing left to tear down, since unload()
    // drains its teardown list once and does not run again, so the five
    // listeners below would outlive the plugin. CalendarStore and CalendarView
    // guard the same shape; this was the one place taking the default.
    let closed = false;
    this.register(() => {
      closed = true;
    });

    this.app.workspace.onLayoutReady(() => {
      if (closed) return;
      console.info("[Periodic Notes] initializing cache");
      this.initialize();
      this.registerEvent(
        this.app.vault.on("create", (file) => {
          if (file instanceof TFile) void this.resolveCreated(file);
        }),
      );
      this.registerEvent(
        this.app.vault.on("delete", (file) => {
          if (file instanceof TFile) this.index.remove(file.path);
        }),
      );
      this.registerEvent(this.app.vault.on("rename", this.onRename, this));
      this.registerEvent(
        this.app.metadataCache.on("changed", (file, _data, cache) =>
          this.resolveFrontmatter(file, cache),
        ),
      );
      this.registerEvent(
        this.app.workspace.on(
          "periodic-notes:settings-updated",
          this.reset,
          this,
        ),
      );
    });
  }

  public reset(): void {
    console.info("[Periodic Notes] resetting cache");
    this.index.clear();
    this.initialize();
  }

  private initialize(): void {
    const settings = this.plugin.settings;
    // Shared across granularities: when configured folders overlap (e.g.
    // day in "/" and week in "daily/"), each folder is walked only once.
    const visited = new Set<TFolder>();
    const files: TFile[] = [];
    const collect = (folder: TFolder) => {
      if (visited.has(folder)) return;
      visited.add(folder);
      for (const c of folder.children) {
        if (c instanceof TFile) files.push(c);
        else if (c instanceof TFolder) collect(c);
      }
    };

    for (const granularity of getEnabledGranularities(settings)) {
      const folder = settings.granularities[granularity].folder || "/";
      const rootFolder = this.app.vault.getAbstractFileByPath(folder);
      if (rootFolder instanceof TFolder) collect(rootFolder);
    }

    for (const file of files) this.resolve(file);
  }

  // Deliberately does NOT trigger periodic-notes:resolve, and does not go
  // through resolve(): that would fire the plugin's public event on every
  // metadata save of every periodic note, and route a plain save through the
  // template-capable path. Reads the event's own frontmatter rather than
  // getFileCache, which may not yet reflect this change.
  private resolveFrontmatter(file: TFile, cache: CachedMetadata): void {
    const entry = resolveFile(file, this.plugin.settings, (granularity) =>
      parseFrontMatterEntry(cache.frontmatter, granularity),
    );
    // A property edited away leaves nothing behind: resolveFile has already
    // offered the file to filename matching, so a null here means it is not a
    // periodic note at all. remove() also reaches contenders, which byPath
    // lookups cannot see.
    if (entry) this.index.set(entry);
    else this.index.remove(file.path);
  }

  private onRename(file: TAbstractFile, oldPath: string): void {
    if (!(file instanceof TFile)) return;

    // No splice branch: resolve() reads the file's frontmatter at its new
    // path, so a match made by a property is re-found there rather than
    // carried over, and the folder test that applies to every other write
    // into the index applies here too. This was the last of the four
    // mechanisms that used to encode frontmatter-beats-filename separately.
    this.index.remove(oldPath);
    this.resolve(file);
  }

  /** The frontmatter a file's path currently carries, for resolveFile's reader. */
  private frontmatterOf(file: TFile): unknown {
    return this.app.metadataCache.getFileCache(file)?.frontmatter ?? null;
  }

  private entryFor(file: TFile): CacheEntry | null {
    // Hoisted out of the closure: resolveFile asks for each enabled
    // granularity in turn, and an in-closure lookup would repeat this read up
    // to four times per file across initialize()'s whole-folder walk.
    const frontmatter = this.frontmatterOf(file);
    const entry = resolveFile(file, this.plugin.settings, (granularity) =>
      parseFrontMatterEntry(frontmatter, granularity),
    );
    if (!entry) return null;
    // A canonical-key collision can leave this file unindexed in favour of
    // another note for the same date. Nothing downstream should be told the
    // file resolved when it did not.
    return this.index.set(entry).filePath === file.path ? entry : null;
  }

  /** Index a file and announce it. Synchronous throughout. */
  private resolve(file: TFile): void {
    const entry = this.entryFor(file);
    if (entry) this.announce(entry.granularity, file);
  }

  /** The vault "create" path: index, stamp the template, then announce. */
  private async resolveCreated(file: TFile): Promise<void> {
    const entry = this.entryFor(file);
    if (!entry) return;

    if (file.stat.size === 0) {
      try {
        await applyTemplateToFile(this.app, file, this.plugin.settings, entry);
      } catch (err) {
        reportFailure(`failed to apply template to "${file.path}"`, err);
      }

      // index.set above was synchronous, but the delete and rename handlers
      // run on this same file while the template write is suspended. Telling
      // listeners a file resolved when it has since been deleted, or binding
      // the pre-rename granularity to a post-rename file, is worse than
      // staying quiet: the handler that moved the file has already reindexed
      // it, and will announce it itself.
      if (!this.index.get(entry.filePath)) return; // deleted mid-write
      if (this.app.vault.getAbstractFileByPath(entry.filePath) !== file) {
        return; // renamed mid-write
      }
    }

    this.announce(entry.granularity, file);
  }

  // Fires after template application, so listeners may read file contents.
  private announce(granularity: Granularity, file: TFile): void {
    this.app.workspace.trigger("periodic-notes:resolve", granularity, file);
  }

  // The index can outlive the file it points at — a delete event missed or
  // arriving out of order is enough. Every read path resolves the entry against
  // the vault and drops it if the file is gone, so the cache heals itself no
  // matter which method the caller reached for.
  private fileFor(entry: CacheEntry | null): TFile | null {
    if (!entry) return null;
    const file = this.app.vault.getAbstractFileByPath(entry.filePath);
    if (file instanceof TFile) return file;
    this.index.remove(entry.filePath);
    return null;
  }

  private verify(entry: CacheEntry | null): CacheEntry | null {
    return this.fileFor(entry) ? entry : null;
  }

  public getPeriodicNote(
    granularity: Granularity,
    targetDate: Moment,
  ): TFile | null {
    return this.fileFor(this.index.getByKey(granularity, targetDate));
  }

  public find(filePath: string): CacheEntry | null {
    return this.verify(this.index.get(filePath));
  }

  public findAdjacent(
    filePath: string,
    direction: "forwards" | "backwards",
  ): CacheEntry | null {
    // A stale neighbour must not end the search: the note after it may well
    // exist, and returning null here is how "jump forwards" fails silently.
    // Each miss removes one entry, which dirties the sorted keys, so the next
    // pass sees a shorter list and the loop terminates.
    for (;;) {
      const entry = this.index.findAdjacent(filePath, direction);
      if (!entry) return null;
      const verified = this.verify(entry);
      if (verified) return verified;
    }
  }
}
