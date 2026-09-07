import type { Moment } from "moment";

import { canonicalKey, findAdjacentKey } from "./cacheSearch";
import { type CacheEntry, type Granularity, granularities } from "./types";

/**
 * Which of two entries claiming one canonical key keeps it. Frontmatter is an
 * explicit statement about the note's date, so it beats a filename that merely
 * parses; otherwise the smaller path wins, which is arbitrary but stable —
 * unlike the vault walk order that used to decide.
 */
function preferred(a: CacheEntry, b: CacheEntry): CacheEntry {
  if (a.match !== b.match) return a.match === "frontmatter" ? a : b;
  return a.filePath <= b.filePath ? a : b;
}

export class CacheIndex {
  private byPath = new Map<string, CacheEntry>();
  private byKey = new Map<string, CacheEntry>();
  private sortedByGranularity = new Map<Granularity, string[]>();
  private dirtyGranularities = new Set<Granularity>(granularities);

  /**
   * Index an entry, returning whichever entry now holds its canonical key —
   * which is not always the one passed in. One file per key is what keeps
   * getPeriodicNote O(1), so a collision still evicts, but the loser is chosen
   * by `preferred` rather than by whoever was written last.
   */
  set(entry: CacheEntry): CacheEntry {
    const newKey = canonicalKey(entry.granularity, entry.date);
    const oldByPath = this.byPath.get(entry.filePath);
    if (oldByPath) {
      const oldKey = canonicalKey(oldByPath.granularity, oldByPath.date);
      if (oldKey !== newKey) {
        this.byKey.delete(oldKey);
        this.dirtyGranularities.add(oldByPath.granularity);
      }
    }

    const incumbent = this.byKey.get(newKey);
    if (incumbent && incumbent.filePath !== entry.filePath) {
      const winner = preferred(incumbent, entry);
      const loser = winner === incumbent ? entry : incumbent;
      console.warn(
        `[Periodic Notes] "${winner.filePath}" and "${loser.filePath}" are both ${entry.granularity} notes for the same date (${newKey}); indexing "${winner.filePath}" and ignoring "${loser.filePath}"`,
      );
      // The loser is not a periodic note as far as the rest of the plugin is
      // concerned: byPath backs get/has/findAdjacent, so leaving it there would
      // report a note the calendar and nav commands cannot act on.
      this.byPath.delete(loser.filePath);
      if (winner === incumbent) return incumbent;
    }

    const isNewKey = !this.byKey.has(newKey);
    this.byPath.set(entry.filePath, entry);
    this.byKey.set(newKey, entry);
    if (isNewKey) {
      this.dirtyGranularities.add(entry.granularity);
    }
    return entry;
  }

  remove(filePath: string): void {
    const entry = this.byPath.get(filePath);
    if (entry) {
      this.byKey.delete(canonicalKey(entry.granularity, entry.date));
      this.byPath.delete(filePath);
      this.dirtyGranularities.add(entry.granularity);
    }
  }

  clear(): void {
    this.byPath.clear();
    this.byKey.clear();
    this.sortedByGranularity.clear();
    this.dirtyGranularities = new Set(granularities);
  }

  get(filePath: string): CacheEntry | null {
    return this.byPath.get(filePath) ?? null;
  }

  getByKey(granularity: Granularity, date: Moment): CacheEntry | null {
    // The one read path that takes a date from outside the index, so it is
    // where an unvalidated Moment is turned away rather than let into
    // canonicalKey, which throws on one.
    if (!date.isValid()) return null;
    return this.byKey.get(canonicalKey(granularity, date)) ?? null;
  }

  has(filePath: string, granularity?: Granularity): boolean {
    const entry = this.byPath.get(filePath);
    if (!entry) return false;
    if (!granularity) return true;
    return granularity === entry.granularity;
  }

  findAdjacent(
    filePath: string,
    direction: "forwards" | "backwards",
  ): CacheEntry | null {
    const curr = this.get(filePath);
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
