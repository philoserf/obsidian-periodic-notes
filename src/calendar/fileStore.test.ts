import { describe, expect, it } from "bun:test";
import moment from "moment";

import { computeFileMap, fileMapKey } from "./fileStore";
import { getMonth } from "./utils";

describe("fileMapKey", () => {
  it("formats day keys as day:YYYY-MM-DD", () => {
    expect(fileMapKey("day", moment("2024-03-15"))).toBe("day:2024-03-15");
  });

  it("formats week keys using locale-aware week numbering", () => {
    expect(fileMapKey("week", moment("2024-03-11"))).toBe("week:2024-W11");
  });

  it("formats month keys as month:YYYY-MM", () => {
    expect(fileMapKey("month", moment("2024-03-01"))).toBe("month:2024-03");
  });

  it("formats year keys as year:YYYY", () => {
    expect(fileMapKey("year", moment("2024-03-01"))).toBe("year:2024");
  });
});

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
    expect(map.has(fileMapKey("month", moment("2024-03-01")))).toBe(true);
    expect(map.has(fileMapKey("year", moment("2024-03-01")))).toBe(true);
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
