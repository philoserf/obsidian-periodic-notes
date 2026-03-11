import { describe, expect, test } from "bun:test";
import moment from "moment";

import { type Granularity, granularities } from "./types";

// Re-implement cache data types and pure logic

type MatchType = "filename" | "frontmatter" | "date-prefixed";

interface PeriodicNoteMatchData {
  matchType: MatchType;
  exact: boolean;
}

interface PeriodicNoteCachedMetadata {
  filePath: string;
  date: moment.Moment;
  granularity: Granularity;
  canonicalDateStr: string;
  matchData: PeriodicNoteMatchData;
}

function compareGranularity(a: Granularity, b: Granularity) {
  const idxA = granularities.indexOf(a);
  const idxB = granularities.indexOf(b);
  if (idxA === idxB) return 0;
  if (idxA < idxB) return -1;
  return 1;
}

function getCanonicalDateString(
  _granularity: Granularity,
  date: moment.Moment,
): string {
  return date.toISOString();
}

// Simulate cache operations using a plain Map

function isPeriodic(
  cachedFiles: Map<string, PeriodicNoteCachedMetadata>,
  targetPath: string,
  granularity?: Granularity,
): boolean {
  const metadata = cachedFiles.get(targetPath);
  if (!metadata) return false;
  if (!granularity) return true;
  return granularity === metadata.granularity;
}

function find(
  cachedFiles: Map<string, PeriodicNoteCachedMetadata>,
  filePath: string | undefined,
): PeriodicNoteCachedMetadata | null {
  if (!filePath) return null;
  return cachedFiles.get(filePath) ?? null;
}

function findAdjacent(
  cachedFiles: Map<string, PeriodicNoteCachedMetadata>,
  filePath: string,
  direction: "forwards" | "backwards",
): PeriodicNoteCachedMetadata | null {
  const currMetadata = find(cachedFiles, filePath);
  if (!currMetadata) return null;

  const granularity = currMetadata.granularity;
  const sortedCache = Array.from(cachedFiles.values())
    .filter((m) => m.granularity === granularity)
    .sort((a, b) => a.canonicalDateStr.localeCompare(b.canonicalDateStr));
  const activeNoteIndex = sortedCache.findIndex((m) => m.filePath === filePath);

  const offset = direction === "forwards" ? 1 : -1;
  return sortedCache[activeNoteIndex + offset] ?? null;
}

function getPeriodicNotes(
  cachedFiles: Map<string, PeriodicNoteCachedMetadata>,
  granularity: Granularity,
  targetDate: moment.Moment,
  includeFinerGranularities = false,
): PeriodicNoteCachedMetadata[] {
  const matches: PeriodicNoteCachedMetadata[] = [];
  for (const [, cacheData] of cachedFiles) {
    if (
      (granularity === cacheData.granularity ||
        (includeFinerGranularities &&
          compareGranularity(cacheData.granularity, granularity) <= 0)) &&
      cacheData.date.isSame(targetDate, granularity)
    ) {
      matches.push(cacheData);
    }
  }
  return matches;
}

// Helper to build cache entries
function makeEntry(
  filePath: string,
  dateStr: string,
  granularity: Granularity,
  matchType: MatchType = "filename",
  exact = true,
): PeriodicNoteCachedMetadata {
  const date = moment(dateStr);
  return {
    filePath,
    date,
    granularity,
    canonicalDateStr: getCanonicalDateString(granularity, date),
    matchData: { matchType, exact },
  };
}

function buildCache(
  ...entries: PeriodicNoteCachedMetadata[]
): Map<string, PeriodicNoteCachedMetadata> {
  const map = new Map<string, PeriodicNoteCachedMetadata>();
  for (const entry of entries) {
    map.set(entry.filePath, entry);
  }
  return map;
}

describe("compareGranularity", () => {
  test("returns 0 for equal granularities", () => {
    expect(compareGranularity("day", "day")).toBe(0);
    expect(compareGranularity("year", "year")).toBe(0);
  });

  test("returns -1 when first is finer", () => {
    expect(compareGranularity("day", "week")).toBe(-1);
    expect(compareGranularity("day", "year")).toBe(-1);
    expect(compareGranularity("month", "year")).toBe(-1);
  });

  test("returns 1 when first is coarser", () => {
    expect(compareGranularity("year", "day")).toBe(1);
    expect(compareGranularity("month", "day")).toBe(1);
    expect(compareGranularity("quarter", "week")).toBe(1);
  });
});

describe("getCanonicalDateString", () => {
  test("returns ISO string regardless of granularity", () => {
    const date = moment("2026-03-15");
    const result = getCanonicalDateString("day", date);
    expect(result).toContain("2026-03-15");
  });
});

describe("isPeriodic", () => {
  const cache = buildCache(
    makeEntry("daily/2026-03-15.md", "2026-03-15", "day"),
    makeEntry("weekly/2026-W12.md", "2026-03-16", "week"),
  );

  test("returns true for cached file without granularity filter", () => {
    expect(isPeriodic(cache, "daily/2026-03-15.md")).toBe(true);
  });

  test("returns true for matching granularity", () => {
    expect(isPeriodic(cache, "daily/2026-03-15.md", "day")).toBe(true);
  });

  test("returns false for non-matching granularity", () => {
    expect(isPeriodic(cache, "daily/2026-03-15.md", "week")).toBe(false);
  });

  test("returns false for uncached file", () => {
    expect(isPeriodic(cache, "unknown.md")).toBe(false);
  });

  test("returns false for uncached file with granularity", () => {
    expect(isPeriodic(cache, "unknown.md", "day")).toBe(false);
  });
});

describe("find", () => {
  const cache = buildCache(
    makeEntry("daily/2026-03-15.md", "2026-03-15", "day"),
  );

  test("returns metadata for cached file", () => {
    const result = find(cache, "daily/2026-03-15.md");
    expect(result).not.toBeNull();
    expect(result?.granularity).toBe("day");
  });

  test("returns null for uncached file", () => {
    expect(find(cache, "unknown.md")).toBeNull();
  });

  test("returns null for undefined path", () => {
    expect(find(cache, undefined)).toBeNull();
  });
});

describe("findAdjacent", () => {
  const cache = buildCache(
    makeEntry("daily/2026-03-14.md", "2026-03-14", "day"),
    makeEntry("daily/2026-03-15.md", "2026-03-15", "day"),
    makeEntry("daily/2026-03-16.md", "2026-03-16", "day"),
    makeEntry("weekly/2026-W12.md", "2026-03-16", "week"), // different granularity
  );

  test("finds next note forwards", () => {
    const result = findAdjacent(cache, "daily/2026-03-15.md", "forwards");
    expect(result?.filePath).toBe("daily/2026-03-16.md");
  });

  test("finds previous note backwards", () => {
    const result = findAdjacent(cache, "daily/2026-03-15.md", "backwards");
    expect(result?.filePath).toBe("daily/2026-03-14.md");
  });

  test("returns null at end of sequence forwards", () => {
    const result = findAdjacent(cache, "daily/2026-03-16.md", "forwards");
    expect(result).toBeNull();
  });

  test("returns null at start of sequence backwards", () => {
    const result = findAdjacent(cache, "daily/2026-03-14.md", "backwards");
    expect(result).toBeNull();
  });

  test("returns null for uncached file", () => {
    expect(findAdjacent(cache, "unknown.md", "forwards")).toBeNull();
  });

  test("only considers same granularity", () => {
    // weekly note navigates within weekly entries only, not daily
    const result = findAdjacent(cache, "weekly/2026-W12.md", "forwards");
    expect(result).toBeNull(); // only one weekly entry in cache
    const backwards = findAdjacent(cache, "weekly/2026-W12.md", "backwards");
    expect(backwards).toBeNull(); // confirms daily entries are excluded
  });

  test("sorts by canonical date string", () => {
    // Entries were added in order, but let's verify sorting works
    const unorderedCache = buildCache(
      makeEntry("daily/2026-03-16.md", "2026-03-16", "day"),
      makeEntry("daily/2026-03-14.md", "2026-03-14", "day"),
      makeEntry("daily/2026-03-15.md", "2026-03-15", "day"),
    );
    const result = findAdjacent(
      unorderedCache,
      "daily/2026-03-14.md",
      "forwards",
    );
    expect(result?.filePath).toBe("daily/2026-03-15.md");
  });
});

describe("getPeriodicNotes", () => {
  const cache = buildCache(
    makeEntry("daily/2026-03-15.md", "2026-03-15", "day"),
    makeEntry("daily/2026-03-16.md", "2026-03-16", "day"),
    makeEntry("weekly/2026-W12.md", "2026-03-16", "week"),
    makeEntry("monthly/2026-03.md", "2026-03-01", "month"),
    makeEntry("yearly/2026.md", "2026-01-01", "year"),
  );

  test("returns exact matches for granularity", () => {
    const matches = getPeriodicNotes(cache, "day", moment("2026-03-15"));
    expect(matches).toHaveLength(1);
    expect(matches[0].filePath).toBe("daily/2026-03-15.md");
  });

  test("returns empty for no matches", () => {
    const matches = getPeriodicNotes(cache, "day", moment("2026-04-01"));
    expect(matches).toHaveLength(0);
  });

  test("returns month match using isSame with month granularity", () => {
    const matches = getPeriodicNotes(cache, "month", moment("2026-03-15"));
    expect(matches).toHaveLength(1);
    expect(matches[0].filePath).toBe("monthly/2026-03.md");
  });

  test("includes finer granularities when flag set", () => {
    const matches = getPeriodicNotes(
      cache,
      "month",
      moment("2026-03-15"),
      true,
    );
    // Should include 2 day + 1 week + 1 month entries for March 2026
    expect(matches).toHaveLength(4);
    const granularitiesFound = [...new Set(matches.map((m) => m.granularity))];
    expect(granularitiesFound).toContain("day");
    expect(granularitiesFound).toContain("week");
    expect(granularitiesFound).toContain("month");
  });

  test("does not include coarser granularities with finer flag", () => {
    const matches = getPeriodicNotes(cache, "day", moment("2026-03-15"), true);
    // day is the finest, so only day matches
    expect(matches.every((m) => m.granularity === "day")).toBe(true);
  });

  test("year matches all notes in same year with includeFiner", () => {
    const matches = getPeriodicNotes(cache, "year", moment("2026-06-01"), true);
    // All entries are in 2026
    expect(matches.length).toBe(5);
  });
});
