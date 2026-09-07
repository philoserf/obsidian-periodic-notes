import type { Moment } from "moment";
import {
  type App,
  type CachedMetadata,
  Component,
  Notice,
  parseFrontMatterEntry,
  type TAbstractFile,
  TFile,
  TFolder,
} from "obsidian";

import { resolveFrontmatterEntry } from "./cacheFrontmatter";
import { CacheIndex } from "./cacheIndex";
import { resolveEntry } from "./cacheResolve";
import { getEnabledGranularities } from "./format";
import type PeriodicNotesPlugin from "./main";
import { applyTemplateToFile } from "./template";
import type { CacheEntry, Granularity } from "./types";

export type { CacheEntry };

export class NoteCache extends Component {
  private index = new CacheIndex();

  constructor(
    readonly app: App,
    readonly plugin: PeriodicNotesPlugin,
  ) {
    super();

    this.app.workspace.onLayoutReady(() => {
      console.info("[Periodic Notes] initializing cache");
      this.initialize();
      this.registerEvent(
        this.app.vault.on("create", (file) => {
          if (file instanceof TFile) void this.resolve(file, "create");
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
    const recurseChildren = (
      folder: TFolder,
      cb: (file: TAbstractFile) => void,
    ) => {
      if (visited.has(folder)) return;
      visited.add(folder);
      for (const c of folder.children) {
        if (c instanceof TFile) cb(c);
        else if (c instanceof TFolder) recurseChildren(c, cb);
      }
    };

    const active = getEnabledGranularities(settings);
    for (const granularity of active) {
      const folder = settings.granularities[granularity].folder || "/";
      const rootFolder = this.app.vault.getAbstractFileByPath(folder);
      if (!(rootFolder instanceof TFolder)) continue;

      recurseChildren(rootFolder, (file) => {
        if (file instanceof TFile) {
          void this.resolve(file, "initialize");
          const metadata = this.app.metadataCache.getFileCache(file);
          if (metadata) this.resolveFrontmatter(file, metadata);
        }
      });
    }
  }

  private resolveFrontmatter(file: TFile, cache: CachedMetadata): void {
    const entry = resolveFrontmatterEntry(
      file.path,
      this.plugin.settings,
      (granularity) => parseFrontMatterEntry(cache.frontmatter, granularity),
    );

    if (entry) {
      this.index.set(entry);
      return;
    }

    // The property that produced a frontmatter entry can be edited away, and
    // nothing else drops it: resolveEntry refuses to re-resolve a path already
    // matched by frontmatter. Remove it here, then offer the file to filename
    // matching — stripping frontmatter from a note whose name still parses
    // should leave it periodic.
    const existing = this.index.get(file.path);
    if (existing?.match === "frontmatter") {
      this.index.remove(file.path);
      void this.resolve(file, "metadata");
    }
  }

  private onRename(file: TAbstractFile, oldPath: string): void {
    if (!(file instanceof TFile)) return;

    const previous = this.index.get(oldPath);
    this.index.remove(oldPath);

    // A frontmatter match survives a rename — the property that made the file
    // periodic did not move. Re-resolving cannot preserve it: resolveEntry is
    // handed the entry for the *new* path, which does not exist yet, so it
    // would silently fall back to filename matching and drop the note.
    if (previous?.match === "frontmatter") {
      this.index.set({ ...previous, filePath: file.path });
      this.app.workspace.trigger(
        "periodic-notes:resolve",
        previous.granularity,
        file,
      );
      return;
    }

    void this.resolve(file, "rename");
  }

  // Runs synchronously through index.set and the trigger except on the
  // create-with-template path, where the trigger waits for the template.
  private async resolve(
    file: TFile,
    reason: "create" | "rename" | "initialize" | "metadata" = "create",
  ): Promise<void> {
    const settings = this.plugin.settings;
    const entry = resolveEntry(file, settings, this.index.get(file.path));
    if (!entry) return;

    // A canonical-key collision can leave this file unindexed in favour of
    // another note for the same date. Nothing downstream should be told the
    // file resolved when it did not.
    if (this.index.set(entry).filePath !== file.path) return;

    if (reason === "create" && file.stat.size === 0) {
      try {
        await applyTemplateToFile(this.app, file, settings, entry);
      } catch (err) {
        console.error("[Periodic Notes] failed to apply template", err);
        new Notice(
          `Periodic Notes: failed to apply template to "${file.path}". See console for details.`,
        );
      }
    }

    // Fires after template application, so listeners may read file contents.
    this.app.workspace.trigger(
      "periodic-notes:resolve",
      entry.granularity,
      file,
    );
  }

  public getPeriodicNote(
    granularity: Granularity,
    targetDate: Moment,
  ): TFile | null {
    const entry = this.index.getByKey(granularity, targetDate);
    if (!entry) return null;
    const file = this.app.vault.getAbstractFileByPath(entry.filePath);
    if (file instanceof TFile) return file;
    this.index.remove(entry.filePath);
    return null;
  }

  public isPeriodic(targetPath: string, granularity?: Granularity): boolean {
    return this.index.has(targetPath, granularity);
  }

  public find(filePath: string | undefined): CacheEntry | null {
    return this.index.get(filePath);
  }

  public findAdjacent(
    filePath: string,
    direction: "forwards" | "backwards",
  ): CacheEntry | null {
    return this.index.findAdjacent(filePath, direction);
  }
}
