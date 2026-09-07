import { describe, expect, test } from "bun:test";

import { applyTemplate } from "./templateRender";

describe("applyTemplate", () => {
  test("replaces date token", () => {
    const result = applyTemplate(
      "2026-03-20",
      "day",
      window.moment("2026-03-20"),
      "YYYY-MM-DD",
      "Today is {{date}}",
    );
    expect(result).toBe("Today is 2026-03-20");
  });

  test("replaces title token", () => {
    const result = applyTemplate(
      "2026-03-20",
      "day",
      window.moment("2026-03-20"),
      "YYYY-MM-DD",
      "# {{title}}",
    );
    expect(result).toBe("# 2026-03-20");
  });

  test("replaces yesterday and tomorrow for day granularity", () => {
    const date = window.moment("2026-03-20");
    const result = applyTemplate(
      "2026-03-20",
      "day",
      date,
      "YYYY-MM-DD",
      "{{yesterday}} / {{tomorrow}}",
    );
    expect(result).toBe("2026-03-19 / 2026-03-21");
  });

  test("replaces weekday tokens for week granularity", () => {
    const date = window.moment("2026-03-16");
    const result = applyTemplate(
      "2026-W12",
      "week",
      date,
      "gggg-[W]ww",
      "Mon: {{monday:YYYY-MM-DD}}",
    );
    expect(result).toMatch(/^\w+: \d{4}-\d{2}-\d{2}$/);
  });

  test("leaves the caller's date untouched", () => {
    // #162: .weekday() mutates in place, and the date handed in is the Moment
    // held by a CacheEntry — shifting it desynchronizes the entry from the
    // canonical key it is indexed under, breaking adjacent-note navigation.
    const date = window.moment("2026-03-16");
    const before = date.toISOString();
    applyTemplate(
      "2026-W12",
      "week",
      date,
      "gggg-[W]ww",
      "Mon: {{monday:YYYY-MM-DD}} Fri: {{friday:YYYY-MM-DD}}",
    );
    expect(date.toISOString()).toBe(before);
  });

  test("does not replace yesterday/tomorrow for non-day granularity", () => {
    const date = window.moment("2026-03-01");
    const result = applyTemplate(
      "2026-03",
      "month",
      date,
      "YYYY-MM",
      "{{yesterday}}",
    );
    expect(result).toBe("{{yesterday}}");
  });

  test("replaces month granularity tokens with delta", () => {
    const date = window.moment("2026-03-01");
    const result = applyTemplate(
      "2026-03",
      "month",
      date,
      "YYYY-MM",
      "Prev: {{month-1M:YYYY-MM}} Next: {{month+1M:YYYY-MM}}",
    );
    expect(result).toBe("Prev: 2026-02 Next: 2026-04");
  });

  test("reads a lowercase month delta as months, not minutes", () => {
    // #169: the token patterns are case-insensitive, but moment reads "m" as
    // minute and "M" as month, so a lowercase delta silently did nothing
    // visible on a YYYY-MM format.
    const date = window.moment("2026-03-01");
    const result = applyTemplate(
      "2026-03",
      "month",
      date,
      "YYYY-MM",
      "Prev: {{month-1m:YYYY-MM}} Next: {{month+1m:YYYY-MM}}",
    );
    expect(result).toBe("Prev: 2026-02 Next: 2026-04");
  });

  test("still reads a lowercase date delta as minutes", () => {
    const result = applyTemplate(
      "2026-03-01",
      "day",
      window.moment("2026-03-01"),
      "YYYY-MM-DD",
      "{{date-90m:YYYY-MM-DD}}",
    );
    // Ninety minutes back from the current time of day on 2026-03-01 lands on
    // that day or the one before it — never on 2026-02-01, which is what
    // reading "m" as a month would give.
    expect(["2026-02-28", "2026-03-01"]).toContain(result);
  });

  test("replaces year granularity tokens", () => {
    const date = window.moment("2026-01-01");
    const result = applyTemplate(
      "2026",
      "year",
      date,
      "YYYY",
      "Year: {{year:YYYY}}",
    );
    expect(result).toBe("Year: 2026");
  });

  test("replaces year granularity tokens with delta", () => {
    const date = window.moment("2026-01-01");
    const result = applyTemplate(
      "2026",
      "year",
      date,
      "YYYY",
      "Last: {{year-1y:YYYY}}",
    );
    expect(result).toBe("Last: 2025");
  });
});

describe("applyTemplate replacement patterns", () => {
  test("treats $ in a filename as literal text", () => {
    // #194: a string replacement reads "$$" as an escaped dollar and "$&" as
    // the matched text. The filename comes from the user's date format.
    const result = applyTemplate(
      "$$ 2026-03-20",
      "day",
      window.moment("2026-03-20"),
      "[$$] YYYY-MM-DD",
      "# {{title}} / {{date}}",
    );
    expect(result).toBe("# $$ 2026-03-20 / $$ 2026-03-20");
  });

  test("does not splice the matched token back in", () => {
    const result = applyTemplate(
      "$& $` $'",
      "day",
      window.moment("2026-03-20"),
      "YYYY-MM-DD",
      "{{title}}",
    );
    expect(result).toBe("$& $` $'");
  });
});
