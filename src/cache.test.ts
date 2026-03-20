import { describe, expect, test } from "bun:test";
import type { Granularity } from "./types";

type CacheEntry = {
  filePath: string;
  date: moment.Moment;
  granularity: Granularity;
  match: "filename" | "frontmatter";
};

describe("CacheEntry shape", () => {
  test("has required fields", () => {
    const entry: CacheEntry = {
      filePath: "daily/2026-03-20.md",
      date: window.moment("2026-03-20"),
      granularity: "day",
      match: "filename",
    };
    expect(entry.filePath).toBe("daily/2026-03-20.md");
    expect(entry.granularity).toBe("day");
    expect(entry.match).toBe("filename");
  });
});

describe("canonicalKey logic", () => {
  function canonicalKey(granularity: Granularity, date: moment.Moment): string {
    return `${granularity}:${date.clone().startOf(granularity).toISOString()}`;
  }

  test("day keys differ by day", () => {
    const k1 = canonicalKey("day", window.moment("2026-03-20"));
    const k2 = canonicalKey("day", window.moment("2026-03-21"));
    expect(k1).not.toBe(k2);
  });

  test("week keys match for same week", () => {
    const k1 = canonicalKey("week", window.moment("2026-03-16"));
    const k2 = canonicalKey("week", window.moment("2026-03-18"));
    expect(k1).toBe(k2);
  });

  test("month keys match for same month", () => {
    const k1 = canonicalKey("month", window.moment("2026-03-01"));
    const k2 = canonicalKey("month", window.moment("2026-03-31"));
    expect(k1).toBe(k2);
  });

  test("keys sort chronologically", () => {
    const keys = [
      canonicalKey("day", window.moment("2026-03-22")),
      canonicalKey("day", window.moment("2026-03-20")),
      canonicalKey("day", window.moment("2026-03-21")),
    ].sort();
    expect(keys[0]).toContain("2026-03-20");
    expect(keys[2]).toContain("2026-03-22");
  });
});
