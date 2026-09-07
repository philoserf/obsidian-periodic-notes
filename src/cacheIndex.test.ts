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

function collectWarnings(run: () => void): string[] {
  const original = console.warn;
  const warnings: string[] = [];
  console.warn = (message: string) => {
    warnings.push(message);
  };
  try {
    run();
    return warnings;
  } finally {
    console.warn = original;
  }
}

// A collision is expected in these tests; keep its warning out of the output.
function silently<T>(run: () => T): T {
  const original = console.warn;
  console.warn = () => {};
  try {
    return run();
  } finally {
    console.warn = original;
  }
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

  test("key collision keeps the same winner in either insertion order", () => {
    // #191: the winner used to be whichever file was written last, i.e. vault
    // walk order. The smaller path now wins regardless.
    const a = makeEntry("a.md", "2026-03-20");
    const b = makeEntry("b.md", "2026-03-20");

    const forwards = new CacheIndex();
    silently(() => {
      forwards.set(a);
      forwards.set(b);
    });
    expect(forwards.get("b.md")).toBe(null);
    expect(forwards.get("a.md")).toBe(a);
    expect(forwards.getByKey("day", window.moment("2026-03-20"))).toBe(a);

    const backwards = new CacheIndex();
    silently(() => {
      backwards.set(b);
      backwards.set(a);
    });
    expect(backwards.get("b.md")).toBe(null);
    expect(backwards.get("a.md")).toBe(a);
  });

  test("key collision prefers a frontmatter match over a filename one", () => {
    const byName = makeEntry("a.md", "2026-03-20", "day", "filename");
    const byFrontmatter = makeEntry("z.md", "2026-03-20", "day", "frontmatter");

    const forwards = new CacheIndex();
    silently(() => {
      forwards.set(byName);
      forwards.set(byFrontmatter);
    });
    expect(forwards.get("z.md")).toBe(byFrontmatter);
    expect(forwards.get("a.md")).toBe(null);

    const backwards = new CacheIndex();
    silently(() => {
      backwards.set(byFrontmatter);
      backwards.set(byName);
    });
    expect(backwards.get("z.md")).toBe(byFrontmatter);
    expect(backwards.get("a.md")).toBe(null);
  });

  test("set returns the entry that holds the key", () => {
    const a = makeEntry("a.md", "2026-03-20");
    const b = makeEntry("b.md", "2026-03-20");
    expect(index.set(a)).toBe(a);
    expect(silently(() => index.set(b))).toBe(a);
  });

  test("a collision says which file it ignored", () => {
    const warnings = collectWarnings(() => {
      index.set(makeEntry("a.md", "2026-03-20"));
      index.set(makeEntry("b.md", "2026-03-20"));
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("a.md");
    expect(warnings[0]).toContain("b.md");
    expect(warnings[0]).toContain("day:");
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

  test("reflects newly inserted entries in sorted order", () => {
    const fresh = new CacheIndex();
    fresh.set(makeEntry("2026-03-18.md", "2026-03-18"));
    fresh.set(makeEntry("2026-03-20.md", "2026-03-20"));
    // Before insertion, forward from 18 skips straight to 20.
    expect(fresh.findAdjacent("2026-03-18.md", "forwards")?.filePath).toBe(
      "2026-03-20.md",
    );
    // Inserting 19 must invalidate the sorted cache and put 19 between.
    fresh.set(makeEntry("2026-03-19.md", "2026-03-19"));
    expect(fresh.findAdjacent("2026-03-18.md", "forwards")?.filePath).toBe(
      "2026-03-19.md",
    );
    expect(fresh.findAdjacent("2026-03-19.md", "forwards")?.filePath).toBe(
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

describe("CacheIndex collision contenders", () => {
  let index: CacheIndex;
  beforeEach(() => {
    index = new CacheIndex();
  });

  test("removing the winner promotes the loser", () => {
    const winner = makeEntry("daily/2026-03-20.md", "2026-03-20");
    const loser = makeEntry("daily/notes-2026-03-20.md", "2026-03-20");
    index.set(winner);
    silently(() => index.set(loser));
    expect(index.getByKey("day", window.moment("2026-03-20"))).toBe(winner);

    index.remove(winner.filePath);

    expect(index.getByKey("day", window.moment("2026-03-20"))).toBe(loser);
    expect(index.get(loser.filePath)).toBe(loser);
  });

  test("a promoted loser is findable by the nav commands", () => {
    const winner = makeEntry("daily/2026-03-20.md", "2026-03-20");
    const loser = makeEntry("daily/notes-2026-03-20.md", "2026-03-20");
    index.set(makeEntry("daily/2026-03-19.md", "2026-03-19"));
    index.set(winner);
    silently(() => index.set(loser));
    index.remove(winner.filePath);

    expect(index.findAdjacent("daily/2026-03-19.md", "forwards")).toBe(loser);
  });

  test("removing the loser leaves the winner alone", () => {
    const winner = makeEntry("daily/2026-03-20.md", "2026-03-20");
    const loser = makeEntry("daily/notes-2026-03-20.md", "2026-03-20");
    index.set(winner);
    silently(() => index.set(loser));

    index.remove(loser.filePath);
    index.remove(winner.filePath);

    expect(index.getByKey("day", window.moment("2026-03-20"))).toBe(null);
  });

  test("a frontmatter loser is promoted over a filename one", () => {
    const winner = makeEntry("a.md", "2026-03-20", "day", "frontmatter");
    const byName = makeEntry("b.md", "2026-03-20");
    const byFrontmatter = makeEntry("c.md", "2026-03-20", "day", "frontmatter");
    index.set(winner);
    silently(() => index.set(byName));
    silently(() => index.set(byFrontmatter));

    index.remove("a.md");

    expect(index.getByKey("day", window.moment("2026-03-20"))).toBe(
      byFrontmatter,
    );
  });

  test("re-indexing a loser at a new date drops its old contender record", () => {
    const winner = makeEntry("daily/2026-03-20.md", "2026-03-20");
    const loser = makeEntry("daily/other.md", "2026-03-20");
    index.set(winner);
    silently(() => index.set(loser));

    // The loser's frontmatter now claims a different day.
    index.set(makeEntry("daily/other.md", "2026-03-21"));
    index.remove(winner.filePath);

    expect(index.getByKey("day", window.moment("2026-03-20"))).toBe(null);
    expect(index.getByKey("day", window.moment("2026-03-21"))?.filePath).toBe(
      "daily/other.md",
    );
  });

  test("clear forgets contenders", () => {
    const winner = makeEntry("daily/2026-03-20.md", "2026-03-20");
    index.set(winner);
    silently(() => index.set(makeEntry("daily/other.md", "2026-03-20")));

    index.clear();
    index.set(winner);
    index.remove(winner.filePath);

    expect(index.getByKey("day", window.moment("2026-03-20"))).toBe(null);
  });
});

describe("CacheIndex contenders when a winner is re-dated", () => {
  test("re-dating the winner promotes the loser to the key it left", () => {
    const index = new CacheIndex();
    const winner = makeEntry("daily/a.md", "2026-03-20", "day", "frontmatter");
    const loser = makeEntry("daily/b.md", "2026-03-20");
    index.set(winner);
    silently(() => index.set(loser));

    // The winner's frontmatter now claims a different day.
    const redated = makeEntry("daily/a.md", "2026-03-25", "day", "frontmatter");
    index.set(redated);

    expect(index.getByKey("day", window.moment("2026-03-20"))).toBe(loser);
    expect(index.getByKey("day", window.moment("2026-03-25"))).toBe(redated);
    expect(index.get("daily/b.md")).toBe(loser);
  });
});
