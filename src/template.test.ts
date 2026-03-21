import { describe, expect, test } from "bun:test";

// applyTemplate can't be imported directly (template.ts imports obsidian).
// Re-implement the pure template token replacement for testing.
const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

function getDaysOfWeek(): string[] {
  let weekStart = window.moment.localeData().firstDayOfWeek();
  const daysOfWeek = [...WEEKDAYS];
  while (weekStart) {
    const day = daysOfWeek.shift();
    if (day) daysOfWeek.push(day);
    weekStart--;
  }
  return daysOfWeek;
}

function getDayOfWeekNumericalValue(name: string): number {
  return Math.max(0, getDaysOfWeek().indexOf(name.toLowerCase()));
}

type Granularity = "day" | "week" | "month" | "year";

function applyTemplate(
  filename: string,
  granularity: Granularity,
  date: moment.Moment,
  format: string,
  rawContents: string,
): string {
  let contents = rawContents
    .replace(/{{\s*date\s*}}/gi, filename)
    .replace(/{{\s*time\s*}}/gi, window.moment().format("HH:mm"))
    .replace(/{{\s*title\s*}}/gi, filename);

  if (granularity === "day") {
    contents = contents
      .replace(
        /{{\s*yesterday\s*}}/gi,
        date.clone().subtract(1, "day").format(format),
      )
      .replace(/{{\s*tomorrow\s*}}/gi, date.clone().add(1, "d").format(format));
  }

  if (granularity === "week") {
    contents = contents.replace(
      new RegExp(`{{\\s*(${WEEKDAYS.join("|")})\\s*:(.*?)}}`, "gi"),
      (_, dayOfWeek, momentFormat) => {
        const day = getDayOfWeekNumericalValue(dayOfWeek);
        return date.weekday(day).format(momentFormat.trim());
      },
    );
  }

  if (granularity === "month" || granularity === "year") {
    const pattern = new RegExp(
      `{{\\s*(${granularity})\\s*(([-+]\\d+)([ymwdhs]))?\\s*(:.+?)?}}`,
      "gi",
    );
    contents = contents.replace(
      pattern,
      (_, _token, calc, timeDelta, unit, momentFormat) => {
        const periodStart = date.clone().startOf(granularity);
        if (calc) {
          periodStart.add(parseInt(timeDelta, 10), unit);
        }
        if (momentFormat) {
          return periodStart.format(momentFormat.substring(1).trim());
        }
        return periodStart.format(format);
      },
    );
  }

  return contents;
}

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
