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
