import { describe, expect, it } from "bun:test";
import moment from "moment";

import { canonicalKey } from "../cacheSearch";
import { computeFileMap } from "./store";
import { getMonth } from "./utils";

describe("computeFileMap", () => {
  // The map is total: every key the visible grid can ask about is present,
  // mapped to its note or to null. It used to omit keys for disabled
  // granularities, which made one lookup carry two facts — absent meant "off",
  // present-and-null meant "on, no note". Month and year read the first
  // through `has`; they take explicit props now, so this means one thing.
  const month = getMonth(moment("2024-03-01"));
  const noFiles = () => null;

  it("generates keys for all 42 days in the month grid", () => {
    const map = computeFileMap(month, noFiles);
    const dayKeys = [...map.keys()].filter((k) => k.startsWith("day:"));
    expect(dayKeys).toHaveLength(42);
  });

  it("generates week keys for all 6 weeks", () => {
    const map = computeFileMap(month, noFiles);
    const weekKeys = [...map.keys()].filter((k) => k.startsWith("week:"));
    expect(weekKeys).toHaveLength(6);
  });

  it("generates the month and year keys for the displayed month", () => {
    const map = computeFileMap(month, noFiles);
    expect(map.has(canonicalKey("month", moment("2024-03-01")))).toBe(true);
    expect(map.has(canonicalKey("year", moment("2024-03-01")))).toBe(true);
  });

  it("maps every key regardless of which granularities are enabled", () => {
    // No settings reach this function any more, so the map's size is fixed:
    // 42 days + 6 weeks + 1 month + 1 year.
    const map = computeFileMap(month, noFiles);
    expect(map.size).toBe(50);
  });

  it("distinguishes a period with a note from one without", () => {
    const march1 = moment("2024-03-01");
    const file = { path: "Journals/2024-03.md" } as never;
    const map = computeFileMap(month, (_date, granularity) =>
      granularity === "month" ? file : null,
    );
    expect(map.get(canonicalKey("month", march1))).toBe(file);
    expect(map.get(canonicalKey("year", march1))).toBe(null);
  });
});
