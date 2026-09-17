import type { Moment } from "moment";
import type { TFile } from "obsidian";
import { canonicalKey } from "src/cacheSearch";
import type { Granularity } from "src/types";

import type { FileMap, Month } from "./types";

/**
 * Every key the visible grid can ask about, mapped to its note or null.
 *
 * Total on purpose: the map used to omit keys for disabled granularities, so
 * a lookup carried two facts at once — absent meant "granularity off",
 * present-and-null meant "on, no note yet". Month and year read the first
 * through `has`, which is what overloaded it. They take explicit props now,
 * the way day always has, so this means exactly one thing: is there a note
 * for this period.
 */
export function computeFileMap(
  month: Month,
  getFile: (date: Moment, granularity: Granularity) => TFile | null,
): FileMap {
  const map: FileMap = new Map();
  const displayedMonth = month[1].days[0];

  for (const week of month) {
    for (const day of week.days) {
      map.set(canonicalKey("day", day), getFile(day, "day"));
    }
    const weekStart = week.days[0];
    map.set(canonicalKey("week", weekStart), getFile(weekStart, "week"));
  }

  map.set(
    canonicalKey("month", displayedMonth),
    getFile(displayedMonth, "month"),
  );
  map.set(
    canonicalKey("year", displayedMonth),
    getFile(displayedMonth, "year"),
  );

  return map;
}
