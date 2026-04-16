import { describe, expect, it } from "bun:test";
import moment from "moment";

import { canonicalKey } from "../cacheSearch";
import { computeFileMap } from "./store";
import { getMonth } from "./utils";

describe("computeFileMap", () => {
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

  it("calls getFile with correct granularity and date for each key", () => {
    const month = getMonth(moment("2024-03-01"));
    const calls: Array<{ granularity: string; date: string }> = [];
    const getFile = (date: moment.Moment, granularity: string) => {
      calls.push({ granularity, date: date.format() });
      return null;
    };
    computeFileMap(month, getFile, ["week", "month", "year"]);
    // 42 days + 6 weeks + 1 month + 1 year = 50 calls
    expect(calls).toHaveLength(50);
  });
});
