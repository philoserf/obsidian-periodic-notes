import type { Moment } from "moment";

import { canonicalKey, findAdjacentKey } from "./cacheSearch";
import { type CacheEntry, type Granularity, granularities } from "./types";

export class CacheIndex {
  private byPath = new Map<string, CacheEntry>();
  private byKey = new Map<string, CacheEntry>();
  private sortedByGranularity = new Map<Granularity, string[]>();
  private dirtyGranularities = new Set<Granularity>(granularities);

  set(entry: CacheEntry): void {
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

  get(filePath: string | undefined): CacheEntry | null {
    if (!filePath) return null;
    return this.byPath.get(filePath) ?? null;
  }

  getByKey(granularity: Granularity, date: Moment): CacheEntry | null {
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
