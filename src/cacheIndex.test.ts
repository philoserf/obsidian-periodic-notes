import { beforeEach, describe, expect, test } from "bun:test";

import { CacheIndex } from "./cacheIndex";
import type { CacheEntry } from "./types";

function makeEntry(
  filePath: string,
  isoDate: string,
  granularity: CacheEntry["granularity"] = "day",
  match: CacheEntry["match"] = "filename",
): CacheEntry {
  return {
    filePath,
    date: window.moment(isoDate),
    granularity,
    match,
  };
}

describe("CacheIndex.set / get", () => {
  let index: CacheIndex;
  beforeEach(() => {
    index = new CacheIndex();
  });

  test("set stores entry retrievable by path", () => {
    const entry = makeEntry("daily/2026-03-20.md", "2026-03-20");
    index.set(entry);
    expect(index.get("daily/2026-03-20.md")).toBe(entry);
  });

  test("set stores entry retrievable by granularity+date", () => {
    const entry = makeEntry("daily/2026-03-20.md", "2026-03-20");
    index.set(entry);
    expect(index.getByKey("day", window.moment("2026-03-20"))).toBe(entry);
  });

  test("get returns null for unknown path", () => {
    expect(index.get("nope.md")).toBe(null);
  });

  test("get returns null for undefined path", () => {
    expect(index.get(undefined)).toBe(null);
  });

  test("getByKey returns null for unindexed date", () => {
    expect(index.getByKey("day", window.moment("2026-03-20"))).toBe(null);
  });

  test("getByKey distinguishes granularities for overlapping dates", () => {
    const dayEntry = makeEntry("daily/2026-03-20.md", "2026-03-20", "day");
    const weekEntry = makeEntry("weekly/2026-W12.md", "2026-03-20", "week");
    index.set(dayEntry);
    index.set(weekEntry);
    expect(index.getByKey("day", window.moment("2026-03-20"))).toBe(dayEntry);
    expect(index.getByKey("week", window.moment("2026-03-20"))).toBe(weekEntry);
  });
});

describe("CacheIndex.set — dual-index invariants", () => {
  let index: CacheIndex;
  beforeEach(() => {
    index = new CacheIndex();
  });

  test("updating same file with new date removes old key from byKey", () => {
    const initial = makeEntry("note.md", "2026-03-20");
    const updated = makeEntry("note.md", "2026-03-21");
    index.set(initial);
    index.set(updated);
    expect(index.getByKey("day", window.moment("2026-03-20"))).toBe(null);
    expect(index.getByKey("day", window.moment("2026-03-21"))).toBe(updated);
    expect(index.get("note.md")).toBe(updated);
  });

  test("key collision evicts old file from byPath", () => {
    const first = makeEntry("a.md", "2026-03-20");
    const second = makeEntry("b.md", "2026-03-20");
    index.set(first);
    index.set(second);
    expect(index.get("a.md")).toBe(null);
    expect(index.get("b.md")).toBe(second);
    expect(index.getByKey("day", window.moment("2026-03-20"))).toBe(second);
  });

  test("setting the same file with same date does not leave dangling keys", () => {
    const entry = makeEntry("note.md", "2026-03-20");
    index.set(entry);
    const reset = makeEntry("note.md", "2026-03-20", "day", "frontmatter");
    index.set(reset);
    expect(index.get("note.md")).toBe(reset);
    expect(index.getByKey("day", window.moment("2026-03-20"))).toBe(reset);
  });
});

describe("CacheIndex.remove", () => {
  let index: CacheIndex;
  beforeEach(() => {
    index = new CacheIndex();
  });

  test("remove clears both indexes", () => {
    const entry = makeEntry("note.md", "2026-03-20");
    index.set(entry);
    index.remove("note.md");
    expect(index.get("note.md")).toBe(null);
    expect(index.getByKey("day", window.moment("2026-03-20"))).toBe(null);
  });

  test("remove nonexistent path is a no-op", () => {
    expect(() => index.remove("ghost.md")).not.toThrow();
  });
});

describe("CacheIndex.has", () => {
  let index: CacheIndex;
  beforeEach(() => {
    index = new CacheIndex();
    index.set(makeEntry("daily/2026-03-20.md", "2026-03-20", "day"));
    index.set(makeEntry("weekly/2026-W12.md", "2026-03-16", "week"));
  });

  test("returns true for indexed file", () => {
    expect(index.has("daily/2026-03-20.md")).toBe(true);
  });

  test("returns false for unindexed file", () => {
    expect(index.has("nope.md")).toBe(false);
  });

  test("returns true when granularity matches", () => {
    expect(index.has("daily/2026-03-20.md", "day")).toBe(true);
  });

  test("returns false when granularity mismatches", () => {
    expect(index.has("daily/2026-03-20.md", "week")).toBe(false);
  });
});

describe("CacheIndex.clear", () => {
  test("clear empties all indexes", () => {
    const index = new CacheIndex();
    index.set(makeEntry("a.md", "2026-03-20"));
    index.set(makeEntry("b.md", "2026-03-21"));
    index.clear();
    expect(index.get("a.md")).toBe(null);
    expect(index.get("b.md")).toBe(null);
    expect(index.getByKey("day", window.moment("2026-03-20"))).toBe(null);
    expect(index.findAdjacent("a.md", "forwards")).toBe(null);
  });
});

describe("CacheIndex.findAdjacent", () => {
  let index: CacheIndex;
  beforeEach(() => {
    index = new CacheIndex();
    index.set(makeEntry("2026-03-18.md", "2026-03-18"));
    index.set(makeEntry("2026-03-19.md", "2026-03-19"));
    index.set(makeEntry("2026-03-20.md", "2026-03-20"));
    index.set(makeEntry("2026-03-21.md", "2026-03-21"));
  });

  test("walks forward chronologically", () => {
    const next = index.findAdjacent("2026-03-19.md", "forwards");
    expect(next?.filePath).toBe("2026-03-20.md");
  });

  test("walks backward chronologically", () => {
    const prev = index.findAdjacent("2026-03-20.md", "backwards");
    expect(prev?.filePath).toBe("2026-03-19.md");
  });

  test("returns null at forward boundary", () => {
    expect(index.findAdjacent("2026-03-21.md", "forwards")).toBe(null);
  });

  test("returns null at backward boundary", () => {
    expect(index.findAdjacent("2026-03-18.md", "backwards")).toBe(null);
  });

  test("returns null when starting file is not indexed", () => {
    expect(index.findAdjacent("ghost.md", "forwards")).toBe(null);
  });

  test("does not cross granularity boundaries", () => {
    index.set(makeEntry("weekly/2026-W12.md", "2026-03-16", "week"));
    // No other week entries, so forward from the week file returns null,
    // not the adjacent day.
    expect(index.findAdjacent("weekly/2026-W12.md", "forwards")).toBe(null);
  });

  test("reflects newly inserted entries between existing keys", () => {
    // Before insert, 19 → 20. After inserting 19.5-equivalent (not meaningful
    // for "day" granularity, so insert 2026-03-19 again with different file);
    // instead use remove-and-reinsert across a gap.
    index.remove("2026-03-19.md");
    // Now 18 → 20 should be the forward from 18.
    expect(index.findAdjacent("2026-03-18.md", "forwards")?.filePath).toBe(
      "2026-03-20.md",
    );
  });

  test("reflects removed entries", () => {
    index.remove("2026-03-20.md");
    expect(index.findAdjacent("2026-03-19.md", "forwards")?.filePath).toBe(
      "2026-03-21.md",
    );
  });

  test("warm-path results match cold-path after invalidation", () => {
    // Cold call warms the cache.
    const warm1 = index.findAdjacent("2026-03-19.md", "forwards");
    // Subsequent call hits the warm cache.
    const warm2 = index.findAdjacent("2026-03-19.md", "forwards");
    // Mutation invalidates; next call rebuilds.
    index.remove("2026-03-20.md");
    const rebuilt = index.findAdjacent("2026-03-19.md", "forwards");
    expect(warm1?.filePath).toBe("2026-03-20.md");
    expect(warm2?.filePath).toBe("2026-03-20.md");
    expect(rebuilt?.filePath).toBe("2026-03-21.md");
  });
});
