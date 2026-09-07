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
  /**
   * Entries that lost a canonical-key collision, kept per key so the period is
   * not silently emptied when the winner stops claiming it. Only losers land
   * here, so a vault without collisions carries no extra state at all.
   */
  private contenders = new Map<string, CacheEntry[]>();
  private sortedByGranularity = new Map<Granularity, string[]>();
  private dirtyGranularities = new Set<Granularity>(granularities);

  private addContender(key: string, entry: CacheEntry): void {
    const list = this.contenders.get(key);
    if (list) list.push(entry);
    else this.contenders.set(key, [entry]);
  }

  /** Forget any contender for this path, wherever it is filed. */
  private dropContender(filePath: string): void {
    for (const [key, list] of this.contenders) {
      const index = list.findIndex((entry) => entry.filePath === filePath);
      if (index === -1) continue;
      list.splice(index, 1);
      if (list.length === 0) this.contenders.delete(key);
      return;
    }
  }

  /**
   * Hand a freed key to the best remaining contender. The promoted entry may
   * point at a file that is gone; that is fine, because every read resolves
   * against the vault and removes what it cannot find, which promotes again.
   */
  private promote(key: string): void {
    const list = this.contenders.get(key);
    if (!list?.length) return;
    const next = list.reduce((a, b) => preferred(a, b));
    this.dropContender(next.filePath);
    this.byPath.set(next.filePath, next);
    this.byKey.set(key, next);
    this.dirtyGranularities.add(next.granularity);
  }

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
        // This is the other way a winner stops claiming a key: not removed,
        // but re-dated by a frontmatter edit. The key is just as free as it is
        // after remove(), so a contender has to be offered it here too.
        this.promote(oldKey);
      }
    }

    // Unconditional, and before the collision check below: a prior entry for
    // this path may have been a loser, which never reaches byPath, so the
    // oldByPath cleanup above cannot have found it.
    this.dropContender(entry.filePath);

    const incumbent = this.byKey.get(newKey);
    if (incumbent && incumbent.filePath !== entry.filePath) {
      const winner = preferred(incumbent, entry);
      const loser = winner === incumbent ? entry : incumbent;
      console.warn(
        `[Periodic Notes] "${winner.filePath}" and "${loser.filePath}" are both ${entry.granularity} notes for the same date (${newKey}); indexing "${winner.filePath}" and ignoring "${loser.filePath}"`,
      );
      // The loser is not a periodic note as far as the rest of the plugin is
      // concerned: byPath backs get and findAdjacent, so leaving it there would
      // report a note the calendar and nav commands cannot act on. It is kept
      // as a contender instead, so freeing the key brings it back.
      this.byPath.delete(loser.filePath);
      this.addContender(newKey, loser);
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
    // Unconditional for the same reason as in set: a loser is absent from
    // byPath, so the lookup below would miss it and strand its contender.
    this.dropContender(filePath);
    const entry = this.byPath.get(filePath);
    if (entry) {
      const key = canonicalKey(entry.granularity, entry.date);
      this.byKey.delete(key);
      this.byPath.delete(filePath);
      this.dirtyGranularities.add(entry.granularity);
      this.promote(key);
    }
  }

  clear(): void {
    this.byPath.clear();
    this.byKey.clear();
    this.contenders.clear();
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
