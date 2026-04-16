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

import { canonicalKey, findAdjacentKey } from "./cacheSearch";
import {
  getEnabledGranularities,
  getFormat,
  getPossibleFormats,
  removeEscapedCharacters,
  validateFormatComplexity,
} from "./format";
import type PeriodicNotesPlugin from "./main";
import { applyTemplateToFile } from "./template";
import { type CacheEntry, type Granularity, granularities } from "./types";

export type { CacheEntry };

function pathWithoutExtension(file: TFile): string {
  const extLen = file.extension.length + 1;
  return file.path.slice(0, -extLen);
}

function getDateInput(
  file: TFile,
  format: string,
  granularity: Granularity,
): string {
  if (validateFormatComplexity(format, granularity) === "fragile-basename") {
    const fileName = pathWithoutExtension(file);
    const strippedFormat = removeEscapedCharacters(format);
    const nestingLvl = (strippedFormat.match(/\//g)?.length ?? 0) + 1;
    const pathParts = fileName.split("/");
    return pathParts.slice(-nestingLvl).join("/");
  }
  return file.basename;
}

export class NoteCache extends Component {
  private byPath: Map<string, CacheEntry>;
  private byKey: Map<string, CacheEntry>;
  private sortedByGranularity: Map<Granularity, string[]>;
  private dirtyGranularities: Set<Granularity>;

  constructor(
    readonly app: App,
    readonly plugin: PeriodicNotesPlugin,
  ) {
    super();
    this.byPath = new Map();
    this.byKey = new Map();
    this.sortedByGranularity = new Map();
    this.dirtyGranularities = new Set(granularities);

    this.app.workspace.onLayoutReady(() => {
      console.info("[Periodic Notes] initializing cache");
      this.initialize();
      this.registerEvent(
        this.app.vault.on("create", (file) => {
          if (file instanceof TFile) this.resolve(file, "create");
        }),
      );
      this.registerEvent(
        this.app.vault.on("delete", (file) => {
          if (file instanceof TFile) this.remove(file.path);
        }),
      );
      this.registerEvent(this.app.vault.on("rename", this.onRename, this));
      this.registerEvent(
        this.app.metadataCache.on("changed", this.onMetadataChanged, this),
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
    this.byPath.clear();
    this.byKey.clear();
    this.sortedByGranularity.clear();
    this.dirtyGranularities = new Set(granularities);
    this.initialize();
  }

  private initialize(): void {
    const settings = this.plugin.settings;
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
          this.resolve(file, "initialize");
          const metadata = this.app.metadataCache.getFileCache(file);
          if (metadata) this.onMetadataChanged(file, "", metadata);
        }
      });
    }
  }

  private onMetadataChanged(
    file: TFile,
    _data: string,
    cache: CachedMetadata,
  ): void {
    const settings = this.plugin.settings;
    const active = getEnabledGranularities(settings);
    if (active.length === 0) return;

    for (const granularity of active) {
      const folder = settings.granularities[granularity].folder || "/";
      if (!file.path.startsWith(folder === "/" ? "" : `${folder}/`)) continue;
      const frontmatterEntry = parseFrontMatterEntry(
        cache.frontmatter,
        granularity,
      );
      if (!frontmatterEntry) continue;

      const format = getFormat(settings, granularity);
      if (typeof frontmatterEntry === "string") {
        const date = window.moment(frontmatterEntry, format, true);
        if (date.isValid()) {
          this.set({
            filePath: file.path,
            date,
            granularity,
            match: "frontmatter",
          });
        }
        return;
      }
    }
  }

  private onRename(file: TAbstractFile, oldPath: string): void {
    if (file instanceof TFile) {
      this.remove(oldPath);
      this.resolve(file, "rename");
    }
  }

  private resolve(
    file: TFile,
    reason: "create" | "rename" | "initialize" = "create",
  ): void {
    const settings = this.plugin.settings;
    const active = getEnabledGranularities(settings);
    if (active.length === 0) return;

    const existing = this.byPath.get(file.path);
    if (existing && existing.match === "frontmatter") return;

    for (const granularity of active) {
      const folder = settings.granularities[granularity].folder || "/";
      if (!file.path.startsWith(folder === "/" ? "" : `${folder}/`)) continue;

      const formats = getPossibleFormats(settings, granularity);
      const dateInputStr = getDateInput(file, formats[0], granularity);
      const date = window.moment(dateInputStr, formats, true);
      if (date.isValid()) {
        const entry: CacheEntry = {
          filePath: file.path,
          date,
          granularity,
          match: "filename",
        };
        this.set(entry);

        if (reason === "create" && file.stat.size === 0) {
          applyTemplateToFile(this.app, file, settings, entry).catch((err) => {
            console.error("[Periodic Notes] failed to apply template", err);
            new Notice(
              `Periodic Notes: failed to apply template to "${file.path}". See console for details.`,
            );
          });
        }

        this.app.workspace.trigger("periodic-notes:resolve", granularity, file);
        return;
      }
    }
  }

  private set(entry: CacheEntry): void {
    const newKey = canonicalKey(entry.granularity, entry.date);
    const oldByPath = this.byPath.get(entry.filePath);
    if (oldByPath) {
      const oldKey = canonicalKey(oldByPath.granularity, oldByPath.date);
      if (oldKey !== newKey) {
        this.byKey.delete(oldKey);
        this.dirtyGranularities.add(oldByPath.granularity);
      }
    }
    // Evict any other file that claims the same canonical key
    const oldByKey = this.byKey.get(newKey);
    if (oldByKey && oldByKey.filePath !== entry.filePath) {
      this.byPath.delete(oldByKey.filePath);
    }
    const isNewKey = !this.byKey.has(newKey);
    this.byPath.set(entry.filePath, entry);
    this.byKey.set(newKey, entry);
    if (isNewKey) {
      this.dirtyGranularities.add(entry.granularity);
    }
  }

  private remove(filePath: string): void {
    const entry = this.byPath.get(filePath);
    if (entry) {
      this.byKey.delete(canonicalKey(entry.granularity, entry.date));
      this.byPath.delete(filePath);
      this.dirtyGranularities.add(entry.granularity);
    }
  }

  public getPeriodicNote(
    granularity: Granularity,
    targetDate: Moment,
  ): TFile | null {
    const key = canonicalKey(granularity, targetDate);
    const entry = this.byKey.get(key);
    if (!entry) return null;
    const file = this.app.vault.getAbstractFileByPath(entry.filePath);
    if (file instanceof TFile) return file;
    this.remove(entry.filePath);
    return null;
  }

  public isPeriodic(targetPath: string, granularity?: Granularity): boolean {
    const entry = this.byPath.get(targetPath);
    if (!entry) return false;
    if (!granularity) return true;
    return granularity === entry.granularity;
  }

  public find(filePath: string | undefined): CacheEntry | null {
    if (!filePath) return null;
    return this.byPath.get(filePath) ?? null;
  }

  public findAdjacent(
    filePath: string,
    direction: "forwards" | "backwards",
  ): CacheEntry | null {
    const curr = this.find(filePath);
    if (!curr) return null;

    const sorted = this.getSortedKeys(curr.granularity);
    const key = canonicalKey(curr.granularity, curr.date);
    const adjKey = findAdjacentKey(sorted, key, direction);
    return adjKey ? (this.byKey.get(adjKey) ?? null) : null;
  }

  private getSortedKeys(granularity: Granularity): string[] {
    if (!this.dirtyGranularities.has(granularity)) {
      const cached = this.sortedByGranularity.get(granularity);
      if (cached) return cached;
    }
    const prefix = `${granularity}:`;
    const keys: string[] = [];
    for (const k of this.byKey.keys()) {
      if (k.startsWith(prefix)) keys.push(k);
    }
    keys.sort();
    this.sortedByGranularity.set(granularity, keys);
    this.dirtyGranularities.delete(granularity);
    return keys;
  }
}
