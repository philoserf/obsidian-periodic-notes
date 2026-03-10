import { describe, expect, test } from "bun:test";
import moment from "moment";

import { getLooselyMatchedDate } from "./parser";

// @ts-expect-error global mock
globalThis.window = { moment };

describe("getLooselyMatchedDate", () => {
  test("matches YYYY-MM-DD format", () => {
    const result = getLooselyMatchedDate("2026-03-15");
    expect(result).not.toBeNull();
    expect(result?.granularity).toBe("day");
    expect(result?.date.format("YYYY-MM-DD")).toBe("2026-03-15");
  });

  test("matches YYYY.MM.DD format", () => {
    const result = getLooselyMatchedDate("2026.03.15");
    expect(result).not.toBeNull();
    expect(result?.granularity).toBe("day");
    expect(result?.date.format("YYYY-MM-DD")).toBe("2026-03-15");
  });

  test("matches YYYYMMDD compact format", () => {
    const result = getLooselyMatchedDate("20260315");
    expect(result).not.toBeNull();
    expect(result?.granularity).toBe("day");
    expect(result?.date.format("YYYY-MM-DD")).toBe("2026-03-15");
  });

  test("matches date embedded in longer string", () => {
    const result = getLooselyMatchedDate("my-note-2026-03-15-draft");
    expect(result).not.toBeNull();
    expect(result?.granularity).toBe("day");
    expect(result?.date.format("YYYY-MM-DD")).toBe("2026-03-15");
  });

  test("matches month-only YYYY-MM", () => {
    const result = getLooselyMatchedDate("2026-03");
    expect(result).not.toBeNull();
    expect(result?.granularity).toBe("month");
    expect(result?.date.format("YYYY-MM-DD")).toBe("2026-03-01");
  });

  test("matches month-only YYYYMM", () => {
    const result = getLooselyMatchedDate("202603");
    expect(result).not.toBeNull();
    expect(result?.granularity).toBe("month");
    expect(result?.date.format("YYYY-MM")).toBe("2026-03");
  });

  test("matches year-only", () => {
    const result = getLooselyMatchedDate("2026");
    expect(result).not.toBeNull();
    expect(result?.granularity).toBe("year");
    expect(result?.date.format("YYYY")).toBe("2026");
  });

  test("returns null for non-date strings", () => {
    expect(getLooselyMatchedDate("no-date-here")).toBeNull();
    expect(getLooselyMatchedDate("abc")).toBeNull();
    expect(getLooselyMatchedDate("")).toBeNull();
  });

  test("rejects invalid month 13", () => {
    const result = getLooselyMatchedDate("2026-13-01");
    // FULL_DATE_PATTERN won't match month 13, falls through to MONTH_PATTERN
    // MONTH_PATTERN won't match 13 either, falls to YEAR_PATTERN
    expect(result).not.toBeNull();
    expect(result?.granularity).toBe("year");
  });

  test("rejects invalid day 32", () => {
    const result = getLooselyMatchedDate("2026-01-32");
    // FULL_DATE_PATTERN won't match day 32, falls through
    expect(result).not.toBeNull();
    expect(result?.granularity).toBe("month");
    expect(result?.date.format("YYYY-MM")).toBe("2026-01");
  });

  test("matches date at boundaries (Jan 01, Dec 31)", () => {
    const jan1 = getLooselyMatchedDate("2026-01-01");
    expect(jan1?.granularity).toBe("day");
    expect(jan1?.date.format("YYYY-MM-DD")).toBe("2026-01-01");

    const dec31 = getLooselyMatchedDate("2026-12-31");
    expect(dec31?.granularity).toBe("day");
    expect(dec31?.date.format("YYYY-MM-DD")).toBe("2026-12-31");
  });
});
