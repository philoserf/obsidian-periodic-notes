import type { Moment } from "moment";
import type { TFile } from "obsidian";
import { canonicalKey } from "src/cacheSearch";
import type { Granularity } from "src/types";

import type { FileMap, Month } from "./types";

export function computeFileMap(
  month: Month,
  getFile: (date: Moment, granularity: Granularity) => TFile | null,
  enabledGranularities: Granularity[],
): FileMap {
  const map: FileMap = new Map();
  const displayedMonth = month[1].days[0];

  for (const week of month) {
    for (const day of week.days) {
      map.set(canonicalKey("day", day), getFile(day, "day"));
    }
    if (enabledGranularities.includes("week")) {
      const weekStart = week.days[0];
      map.set(canonicalKey("week", weekStart), getFile(weekStart, "week"));
    }
  }

  if (enabledGranularities.includes("month")) {
    map.set(
      canonicalKey("month", displayedMonth),
      getFile(displayedMonth, "month"),
    );
  }
  if (enabledGranularities.includes("year")) {
    map.set(
      canonicalKey("year", displayedMonth),
      getFile(displayedMonth, "year"),
    );
  }

  return map;
}
