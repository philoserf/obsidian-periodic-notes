import { describe, expect, it } from "bun:test";
import moment from "moment";

import { canonicalKey } from "../cacheSearch";
import { computeFileMap } from "./store";
import { getMonth } from "./utils";

describe("computeFileMap", () => {
  // Load-bearing for #188: day cells are gated on a `dayEnabled` prop, not on
  // presence in the map. Month.svelte reads `fileMap.has(key)` as its enabled
  // signal, so dropping day keys here would leave Day.svelte unable to tell
  // "disabled" from "enabled but no note" — both would be an absent key.
  it("generates keys for all 42 days in the month grid", () => {
    const month = getMonth(moment("2024-03-01"));
    const getFile = () => null;
    const map = computeFileMap(month, getFile, []);
    const dayKeys = [...map.keys()].filter((k) => k.startsWith("day:"));
    expect(dayKeys).toHaveLength(42);
  });

  it("generates week keys for all 6 weeks when week is enabled", () => {
    const month = getMonth(moment("2024-03-01"));
    const getFile = () => null;
    const map = computeFileMap(month, getFile, ["week"]);
    const weekKeys = [...map.keys()].filter((k) => k.startsWith("week:"));
    expect(weekKeys).toHaveLength(6);
  });

  it("generates month and year keys when those granularities are enabled", () => {
    const month = getMonth(moment("2024-03-01"));
    const getFile = () => null;
    const map = computeFileMap(month, getFile, ["month", "year"]);
    expect(map.has(canonicalKey("month", moment("2024-03-01")))).toBe(true);
    expect(map.has(canonicalKey("year", moment("2024-03-01")))).toBe(true);
  });

  it("does not generate week/month/year keys when not enabled", () => {
    const month = getMonth(moment("2024-03-01"));
    const getFile = () => null;
    const map = computeFileMap(month, getFile, []);
    const nonDayKeys = [...map.keys()].filter((k) => !k.startsWith("day:"));
    expect(nonDayKeys).toHaveLength(0);
  });
});
