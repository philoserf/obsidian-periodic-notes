import { describe, expect, it } from "bun:test";

import { findAdjacentKey } from "./cacheSearch";

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
