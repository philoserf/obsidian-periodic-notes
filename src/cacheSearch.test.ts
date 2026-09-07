import { describe, expect, it, test } from "bun:test";

import { canonicalKey, findAdjacentKey } from "./cacheSearch";

describe("findAdjacentKey", () => {
  const sorted = [
    "day:2024-03-14T00:00:00.000Z",
    "day:2024-03-15T00:00:00.000Z",
    "day:2024-03-16T00:00:00.000Z",
    "day:2024-03-17T00:00:00.000Z",
  ];

  it("returns null when sorted is empty", () => {
    expect(
      findAdjacentKey([], "day:2024-03-15T00:00:00.000Z", "forwards"),
    ).toBe(null);
    expect(
      findAdjacentKey([], "day:2024-03-15T00:00:00.000Z", "backwards"),
    ).toBe(null);
  });

  it("returns null when key is not in sorted", () => {
    expect(
      findAdjacentKey(sorted, "day:2024-03-20T00:00:00.000Z", "forwards"),
    ).toBe(null);
  });

  it("returns next key going forwards in the middle", () => {
    expect(
      findAdjacentKey(sorted, "day:2024-03-15T00:00:00.000Z", "forwards"),
    ).toBe("day:2024-03-16T00:00:00.000Z");
  });

  it("returns previous key going backwards in the middle", () => {
    expect(
      findAdjacentKey(sorted, "day:2024-03-16T00:00:00.000Z", "backwards"),
    ).toBe("day:2024-03-15T00:00:00.000Z");
  });

  it("returns null at the forward boundary", () => {
    expect(
      findAdjacentKey(sorted, "day:2024-03-17T00:00:00.000Z", "forwards"),
    ).toBe(null);
  });

  it("returns null at the backward boundary", () => {
    expect(
      findAdjacentKey(sorted, "day:2024-03-14T00:00:00.000Z", "backwards"),
    ).toBe(null);
  });

  it("returns null in both directions for a single-element array", () => {
    const single = ["day:2024-03-15T00:00:00.000Z"];
    expect(
      findAdjacentKey(single, "day:2024-03-15T00:00:00.000Z", "forwards"),
    ).toBe(null);
    expect(
      findAdjacentKey(single, "day:2024-03-15T00:00:00.000Z", "backwards"),
    ).toBe(null);
  });

  it("works correctly across a large array (binary search correctness)", () => {
    const big = Array.from(
      { length: 1000 },
      (_, i) => `day:2024-01-01T00:00:00.${String(i).padStart(3, "0")}Z`,
    );
    expect(findAdjacentKey(big, big[500], "forwards")).toBe(big[501]);
    expect(findAdjacentKey(big, big[500], "backwards")).toBe(big[499]);
    expect(findAdjacentKey(big, big[0], "backwards")).toBe(null);
    expect(findAdjacentKey(big, big[999], "forwards")).toBe(null);
  });
});

describe("canonicalKey", () => {
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

  // Load-bearing: CacheIndex.findAdjacent sorts these keys as plain strings to
  // walk to the neighbouring note, so chronological order has to survive the
  // string comparison.
  test("keys sort chronologically", () => {
    const k20 = canonicalKey("day", window.moment("2026-03-20"));
    const k21 = canonicalKey("day", window.moment("2026-03-21"));
    const k22 = canonicalKey("day", window.moment("2026-03-22"));
    const sorted = [k22, k20, k21].sort();
    expect(sorted).toEqual([k20, k21, k22]);
  });

  test("builds a key from a valid date", () => {
    expect(canonicalKey("day", window.moment("2026-03-20"))).toContain("day:");
  });

  test('refuses an invalid date rather than aliasing on "null"', () => {
    // #176: toISOString() returns null for an invalid moment, so every invalid
    // date for a granularity used to collapse to "<granularity>:null".
    expect(() =>
      canonicalKey("day", window.moment("nonsense", "YYYY", true)),
    ).toThrow();
  });
});
