import type { Moment } from "moment";

import type { Granularity } from "./types";

export function canonicalKey(granularity: Granularity, date: Moment): string {
  // Moment.toISOString() returns null for an invalid moment, which the template
  // literal would turn into the string "null" — so every invalid date for a
  // granularity would alias to one key and silently collide. Callers holding a
  // date they did not validate should check isValid() first; reaching here with
  // one is a bug, not a runtime condition.
  if (!date.isValid()) {
    throw new Error(
      `Cannot build a ${granularity} cache key from an invalid date`,
    );
  }
  return `${granularity}:${date.clone().startOf(granularity).toISOString()}`;
}

export function findAdjacentKey(
  sorted: string[],
  key: string,
  direction: "forwards" | "backwards",
): string | null {
  let lo = 0;
  let hi = sorted.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const midKey = sorted[mid];
    if (midKey === key) {
      const offset = direction === "forwards" ? 1 : -1;
      return sorted[mid + offset] ?? null;
    }
    if (midKey < key) lo = mid + 1;
    else hi = mid - 1;
  }
  return null;
}
