import type { Moment } from "moment";
import type { TFile } from "obsidian";
import { DEFAULT_FORMAT } from "src/constants";
import type { Granularity } from "src/types";

import type { FileMap, Month } from "./types";

export function fileMapKey(granularity: Granularity, date: Moment): string {
  return `${granularity}:${date.format(DEFAULT_FORMAT[granularity])}`;
}

export function computeFileMap(
  month: Month,
  getFile: (date: Moment, granularity: Granularity) => TFile | null,
  enabledGranularities: Granularity[],
): FileMap {
  const map: FileMap = new Map();
  const displayedMonth = month[1].days[0];

  for (const week of month) {
    for (const day of week.days) {
      map.set(fileMapKey("day", day), getFile(day, "day"));
    }
    if (enabledGranularities.includes("week")) {
      const weekStart = week.days[0];
      map.set(fileMapKey("week", weekStart), getFile(weekStart, "week"));
    }
  }

  if (enabledGranularities.includes("month")) {
    map.set(
      fileMapKey("month", displayedMonth),
      getFile(displayedMonth, "month"),
    );
  }
  if (enabledGranularities.includes("year")) {
    map.set(
      fileMapKey("year", displayedMonth),
      getFile(displayedMonth, "year"),
    );
  }

  return map;
}
