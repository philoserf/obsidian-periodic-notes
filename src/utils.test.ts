import { describe, expect, test } from "bun:test";
import moment from "moment";

import {
  DEFAULT_FORMAT,
  DEFAULT_PERIODIC_CONFIG,
  HUMANIZE_FORMAT,
} from "./constants";
import type { Granularity, PeriodicConfig } from "./types";

// Inline to avoid importing obsidian via settings/validation.ts
function removeEscapedCharacters(format: string): string {
  const withoutBrackets = format.replace(/\[[^\]]*\]/g, "");
  return withoutBrackets.replace(/\\./g, "");
}

// Provide window.moment for code that uses it
// @ts-expect-error global mock
globalThis.window = { moment };

// Re-implement pure functions to test without Obsidian imports

function join(...partSegments: string[]): string {
  let parts: string[] = [];
  for (let i = 0, l = partSegments.length; i < l; i++) {
    parts = parts.concat(partSegments[i].split("/"));
  }
  const newParts = [];
  for (let i = 0, l = parts.length; i < l; i++) {
    const part = parts[i];
    if (!part || part === ".") continue;
    else newParts.push(part);
  }
  if (parts[0] === "") newParts.unshift("");
  return newParts.join("/");
}

function isIsoFormat(format: string): boolean {
  const cleanFormat = removeEscapedCharacters(format);
  return /w{1,2}/.test(cleanFormat);
}

type Settings = Record<Granularity, PeriodicConfig | undefined>;

function getFormat(settings: Settings, granularity: Granularity): string {
  return settings[granularity]?.format || DEFAULT_FORMAT[granularity];
}

function getPossibleFormats(
  settings: Settings,
  granularity: Granularity,
): string[] {
  const format = settings[granularity]?.format;
  if (!format) return [DEFAULT_FORMAT[granularity]];

  const partialFormatExp = /[^/]*$/.exec(format);
  if (partialFormatExp) {
    const partialFormat = partialFormatExp[0];
    return [format, partialFormat];
  }
  return [format];
}

function getFolder(settings: Settings, granularity: Granularity): string {
  return settings[granularity]?.folder || "/";
}

describe("join", () => {
  test("joins simple path segments", () => {
    expect(join("foo", "bar")).toBe("foo/bar");
  });

  test("handles leading slash", () => {
    expect(join("/foo", "bar")).toBe("/foo/bar");
  });

  test("removes trailing slashes", () => {
    expect(join("foo/", "bar/")).toBe("foo/bar");
  });

  test("removes dots", () => {
    expect(join(".", "foo", ".", "bar")).toBe("foo/bar");
  });

  test("handles empty segments", () => {
    expect(join("foo", "", "bar")).toBe("foo/bar");
  });

  test("handles single segment", () => {
    expect(join("foo")).toBe("foo");
  });

  test("handles nested paths", () => {
    expect(join("a/b", "c/d")).toBe("a/b/c/d");
  });
});

describe("removeEscapedCharacters", () => {
  test("removes bracketed content", () => {
    expect(removeEscapedCharacters("YYYY-[W]ww")).toBe("YYYY-ww");
  });

  test("removes escaped characters", () => {
    expect(removeEscapedCharacters("YYYY\\-MM")).toBe("YYYYMM");
  });

  test("handles format with no escapes", () => {
    expect(removeEscapedCharacters("YYYY-MM-DD")).toBe("YYYY-MM-DD");
  });

  test("removes multiple brackets", () => {
    expect(removeEscapedCharacters("YYYY-[Q]Q-[W]ww")).toBe("YYYY-Q-ww");
  });

  test("handles empty string", () => {
    expect(removeEscapedCharacters("")).toBe("");
  });
});

describe("isIsoFormat", () => {
  test("detects ISO week format", () => {
    expect(isIsoFormat("gggg-[W]ww")).toBe(true);
  });

  test("rejects non-ISO format", () => {
    expect(isIsoFormat("YYYY-MM-DD")).toBe(false);
  });

  test("ignores escaped w characters", () => {
    expect(isIsoFormat("YYYY-[ww]")).toBe(false);
  });
});

describe("getFormat", () => {
  const emptySettings: Settings = {
    day: undefined,
    week: undefined,
    month: undefined,
    quarter: undefined,
    year: undefined,
  };

  test("returns default format when no config", () => {
    expect(getFormat(emptySettings, "day")).toBe("YYYY-MM-DD");
  });

  test("returns default weekly format", () => {
    expect(getFormat(emptySettings, "week")).toBe("gggg-[W]ww");
  });

  test("returns custom format when set", () => {
    const settings: Settings = {
      ...emptySettings,
      day: { ...DEFAULT_PERIODIC_CONFIG, format: "DD-MM-YYYY" },
    };
    expect(getFormat(settings, "day")).toBe("DD-MM-YYYY");
  });

  test("returns default when format is empty string", () => {
    const settings: Settings = {
      ...emptySettings,
      day: { ...DEFAULT_PERIODIC_CONFIG, format: "" },
    };
    expect(getFormat(settings, "day")).toBe("YYYY-MM-DD");
  });
});

describe("getPossibleFormats", () => {
  const emptySettings: Settings = {
    day: undefined,
    week: undefined,
    month: undefined,
    quarter: undefined,
    year: undefined,
  };

  test("returns default when no config", () => {
    const result = getPossibleFormats(emptySettings, "day");
    expect(result).toEqual(["YYYY-MM-DD"]);
  });

  test("returns full and partial format for nested paths", () => {
    const settings: Settings = {
      ...emptySettings,
      day: { ...DEFAULT_PERIODIC_CONFIG, format: "YYYY/YYYY-MM-DD" },
    };
    const result = getPossibleFormats(settings, "day");
    expect(result).toEqual(["YYYY/YYYY-MM-DD", "YYYY-MM-DD"]);
  });

  test("returns full and partial (identical) format for flat paths", () => {
    const settings: Settings = {
      ...emptySettings,
      day: { ...DEFAULT_PERIODIC_CONFIG, format: "YYYY-MM-DD" },
    };
    const result = getPossibleFormats(settings, "day");
    expect(result).toEqual(["YYYY-MM-DD", "YYYY-MM-DD"]);
  });
});

describe("getFolder", () => {
  const emptySettings: Settings = {
    day: undefined,
    week: undefined,
    month: undefined,
    quarter: undefined,
    year: undefined,
  };

  test("returns root when no config", () => {
    expect(getFolder(emptySettings, "day")).toBe("/");
  });

  test("returns custom folder when set", () => {
    const settings: Settings = {
      ...emptySettings,
      day: { ...DEFAULT_PERIODIC_CONFIG, folder: "Daily" },
    };
    expect(getFolder(settings, "day")).toBe("Daily");
  });

  test("returns root when folder is empty string", () => {
    const settings: Settings = {
      ...emptySettings,
      day: { ...DEFAULT_PERIODIC_CONFIG, folder: "" },
    };
    expect(getFolder(settings, "day")).toBe("/");
  });
});

describe("isValidFilename", () => {
  function isValidFilename(filename: string): boolean {
    const illegalRe = /[?<>\\:*|"]/g;
    // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional
    const controlRe = /[\x00-\x1f\x80-\x9f]/g;
    const reservedRe = /^\.+$/;
    const windowsReservedRe = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

    return (
      !illegalRe.test(filename) &&
      !controlRe.test(filename) &&
      !reservedRe.test(filename) &&
      !windowsReservedRe.test(filename)
    );
  }

  test("accepts valid filenames", () => {
    expect(isValidFilename("2026-01-15")).toBe(true);
    expect(isValidFilename("my-note")).toBe(true);
  });

  test("rejects illegal characters", () => {
    expect(isValidFilename("file:name")).toBe(false);
    expect(isValidFilename("file?name")).toBe(false);
    expect(isValidFilename('file"name')).toBe(false);
  });

  test("rejects reserved names", () => {
    expect(isValidFilename("..")).toBe(false);
    expect(isValidFilename(".")).toBe(false);
  });

  test("rejects windows reserved names", () => {
    expect(isValidFilename("CON")).toBe(false);
    expect(isValidFilename("PRN.txt")).toBe(false);
    expect(isValidFilename("COM1")).toBe(false);
  });
});

// Re-implement replaceGranularityTokens + applyTemplateTransformations
// to test without Obsidian imports
function replaceGranularityTokens(
  contents: string,
  date: moment.Moment,
  tokenPattern: string,
  format: string,
  startOfUnit?: Granularity,
): string {
  const pattern = new RegExp(
    `{{\\s*(${tokenPattern})\\s*(([-+]\\d+)([yqmwdhs]))?\\s*(:.+?)?}}`,
    "gi",
  );
  const now = window.moment();
  return contents.replace(
    pattern,
    (_, _token, calc, timeDelta, unit, momentFormat) => {
      const periodStart = date.clone();
      if (startOfUnit) {
        periodStart.startOf(startOfUnit);
      }
      periodStart.set({
        hour: now.get("hour"),
        minute: now.get("minute"),
        second: now.get("second"),
      });
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

function applyTemplateTransformations(
  filename: string,
  granularity: Granularity,
  date: moment.Moment,
  format: string,
  rawTemplateContents: string,
): string {
  let templateContents = rawTemplateContents
    .replace(/{{\s*date\s*}}/gi, filename)
    .replace(/{{\s*time\s*}}/gi, window.moment().format("HH:mm"))
    .replace(/{{\s*title\s*}}/gi, filename);

  if (granularity === "day") {
    templateContents = templateContents
      .replace(
        /{{\s*yesterday\s*}}/gi,
        date.clone().subtract(1, "day").format(format),
      )
      .replace(/{{\s*tomorrow\s*}}/gi, date.clone().add(1, "d").format(format));
    templateContents = replaceGranularityTokens(
      templateContents,
      date,
      "date|time",
      format,
    );
  }

  if (granularity === "week") {
    const daysOfWeek = [
      "sunday",
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
    ];
    const weekStart = window.moment.localeData().firstDayOfWeek();
    for (let i = 0; i < weekStart; i++) {
      const day = daysOfWeek.shift();
      if (day) daysOfWeek.push(day);
    }
    templateContents = templateContents.replace(
      /{{\s*(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\s*:(.*?)}}/gi,
      (_, dayOfWeek, momentFormat) => {
        const day = daysOfWeek.indexOf(dayOfWeek.toLowerCase());
        return date.weekday(day).format(momentFormat.trim());
      },
    );
  }

  if (
    granularity === "month" ||
    granularity === "quarter" ||
    granularity === "year"
  ) {
    templateContents = replaceGranularityTokens(
      templateContents,
      date,
      granularity,
      format,
      granularity,
    );
  }

  return templateContents;
}

describe("applyTemplateTransformations", () => {
  const date = moment("2026-03-15");
  const dayFormat = "YYYY-MM-DD";
  const monthFormat = "YYYY-MM";

  test("replaces title and date tokens", () => {
    const result = applyTemplateTransformations(
      "2026-03-15",
      "day",
      date,
      dayFormat,
      "# {{title}}\nDate: {{date}}",
    );
    expect(result).toBe("# 2026-03-15\nDate: 2026-03-15");
  });

  test("replaces time token with current HH:mm", () => {
    const result = applyTemplateTransformations(
      "2026-03-15",
      "day",
      date,
      dayFormat,
      "{{time}}",
    );
    expect(result).toMatch(/^\d{2}:\d{2}$/);
  });

  test("replaces yesterday and tomorrow for day granularity", () => {
    const result = applyTemplateTransformations(
      "2026-03-15",
      "day",
      date,
      dayFormat,
      "prev: {{yesterday}} next: {{tomorrow}}",
    );
    expect(result).toBe("prev: 2026-03-14 next: 2026-03-16");
  });

  test("replaces day token with custom format", () => {
    const result = applyTemplateTransformations(
      "2026-03-15",
      "day",
      date,
      dayFormat,
      "{{date:MMMM D, YYYY}}",
    );
    expect(result).toBe("March 15, 2026");
  });

  test("replaces day token with delta", () => {
    const result = applyTemplateTransformations(
      "2026-03-15",
      "day",
      date,
      dayFormat,
      "{{date+1d:YYYY-MM-DD}}",
    );
    expect(result).toBe("2026-03-16");
  });

  test("replaces month token with default format", () => {
    const result = applyTemplateTransformations(
      "2026-03",
      "month",
      date,
      monthFormat,
      "Month: {{month}}",
    );
    expect(result).toBe("Month: 2026-03");
  });

  test("replaces month token with custom format", () => {
    const result = applyTemplateTransformations(
      "2026-03",
      "month",
      date,
      monthFormat,
      "{{month:MMMM YYYY}}",
    );
    expect(result).toBe("March 2026");
  });

  test("replaces month token with delta", () => {
    const result = applyTemplateTransformations(
      "2026-03",
      "month",
      date,
      monthFormat,
      "{{month+1M:YYYY-MM}}",
    );
    expect(result).toBe("2026-04");
  });

  test("replaces quarter token", () => {
    const result = applyTemplateTransformations(
      "2026-Q1",
      "quarter",
      date,
      "[Q]Q YYYY",
      "{{quarter:YYYY-[Q]Q}}",
    );
    expect(result).toBe("2026-Q1");
  });

  test("replaces year token", () => {
    const result = applyTemplateTransformations(
      "2026",
      "year",
      date,
      "YYYY",
      "Year: {{year}}",
    );
    expect(result).toBe("Year: 2026");
  });

  test("replaces year token with delta", () => {
    const result = applyTemplateTransformations(
      "2026",
      "year",
      date,
      "YYYY",
      "{{year-1y:YYYY}}",
    );
    expect(result).toBe("2025");
  });

  test("replaces week day-of-week tokens", () => {
    const weekDate = moment("2026-03-16"); // Monday
    const result = applyTemplateTransformations(
      "2026-W12",
      "week",
      weekDate,
      "gggg-[W]ww",
      "{{monday:YYYY-MM-DD}} to {{friday:YYYY-MM-DD}}",
    );
    expect(result).toBe("2026-03-16 to 2026-03-20");
  });

  test("does not replace month tokens for day granularity", () => {
    const result = applyTemplateTransformations(
      "2026-03-15",
      "day",
      date,
      dayFormat,
      "{{month}}",
    );
    expect(result).toBe("{{month}}");
  });
});

describe("getLooselyMatchedDate", () => {
  const FULL_DATE_PATTERN =
    /(\d{4})[-.]?(0[1-9]|1[0-2])[-.]?(0[1-9]|[12][0-9]|3[01])/;
  const MONTH_PATTERN = /(\d{4})[-.]?(0[1-9]|1[0-2])/;
  const YEAR_PATTERN = /(\d{4})/;

  test("matches full date", () => {
    expect(FULL_DATE_PATTERN.test("2026-01-15")).toBe(true);
    expect(FULL_DATE_PATTERN.test("20260115")).toBe(true);
    expect(FULL_DATE_PATTERN.test("2026.01.15")).toBe(true);
  });

  test("matches month pattern", () => {
    expect(MONTH_PATTERN.test("2026-01")).toBe(true);
    expect(MONTH_PATTERN.test("202601")).toBe(true);
  });

  test("matches year pattern", () => {
    expect(YEAR_PATTERN.test("2026")).toBe(true);
  });

  test("does not match invalid month", () => {
    const match = FULL_DATE_PATTERN.exec("2026-13-01");
    expect(match).toBeNull();
  });

  test("does not match invalid day", () => {
    const match = FULL_DATE_PATTERN.exec("2026-01-32");
    expect(match).toBeNull();
  });
});

// Re-implement additional pure functions for testing

function getRelativeDate(granularity: Granularity, date: moment.Moment) {
  if (granularity === "week") {
    const thisWeek = window.moment().startOf(granularity);
    const fromNow = window.moment(date).diff(thisWeek, "week");
    if (fromNow === 0) return "This week";
    if (fromNow === -1) return "Last week";
    if (fromNow === 1) return "Next week";
    return window.moment.duration(fromNow, granularity).humanize(true);
  }
  if (granularity === "day") {
    const today = window.moment().startOf("day");
    const fromNow = window.moment(date).from(today);
    return window.moment(date).calendar(null, {
      lastWeek: "[Last] dddd",
      lastDay: "[Yesterday]",
      sameDay: "[Today]",
      nextDay: "[Tomorrow]",
      nextWeek: "dddd",
      sameElse: () => `[${fromNow}]`,
    });
  }
  return date.format(
    HUMANIZE_FORMAT[granularity as keyof typeof HUMANIZE_FORMAT],
  );
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function getConfig(
  settings: Settings,
  granularity: Granularity,
): PeriodicConfig {
  return settings[granularity] ?? DEFAULT_PERIODIC_CONFIG;
}

describe("capitalize", () => {
  test("capitalizes first letter", () => {
    expect(capitalize("hello")).toBe("Hello");
  });

  test("handles single character", () => {
    expect(capitalize("a")).toBe("A");
  });

  test("handles empty string", () => {
    expect(capitalize("")).toBe("");
  });

  test("leaves already capitalized string unchanged", () => {
    expect(capitalize("Hello")).toBe("Hello");
  });

  test("handles all caps", () => {
    expect(capitalize("HELLO")).toBe("HELLO");
  });
});

describe("getRelativeDate", () => {
  test("returns 'Today' for current day", () => {
    const today = moment().startOf("day");
    expect(getRelativeDate("day", today)).toBe("Today");
  });

  test("returns 'Yesterday' for previous day", () => {
    const yesterday = moment().subtract(1, "day").startOf("day");
    expect(getRelativeDate("day", yesterday)).toBe("Yesterday");
  });

  test("returns 'Tomorrow' for next day", () => {
    const tomorrow = moment().add(1, "day").startOf("day");
    expect(getRelativeDate("day", tomorrow)).toBe("Tomorrow");
  });

  test("returns 'This week' for current week", () => {
    const thisWeek = moment().startOf("week");
    expect(getRelativeDate("week", thisWeek)).toBe("This week");
  });

  test("returns 'Last week' for previous week", () => {
    const lastWeek = moment().subtract(1, "week").startOf("week");
    expect(getRelativeDate("week", lastWeek)).toBe("Last week");
  });

  test("returns 'Next week' for next week", () => {
    const nextWeek = moment().add(1, "week").startOf("week");
    expect(getRelativeDate("week", nextWeek)).toBe("Next week");
  });

  test("returns formatted month for month granularity", () => {
    const date = moment("2026-03-01");
    expect(getRelativeDate("month", date)).toBe("March 2026");
  });

  test("returns formatted quarter for quarter granularity", () => {
    const date = moment("2026-01-01");
    expect(getRelativeDate("quarter", date)).toBe("2026 1Q");
  });

  test("returns formatted year for year granularity", () => {
    const date = moment("2026-01-01");
    expect(getRelativeDate("year", date)).toBe("2026");
  });
});

describe("getConfig", () => {
  const emptySettings: Settings = {
    day: undefined,
    week: undefined,
    month: undefined,
    quarter: undefined,
    year: undefined,
  };

  test("returns default config when no setting", () => {
    const config = getConfig(emptySettings, "day");
    expect(config.enabled).toBe(false);
    expect(config.format).toBe("");
  });

  test("returns custom config when set", () => {
    const settings: Settings = {
      ...emptySettings,
      day: {
        ...DEFAULT_PERIODIC_CONFIG,
        enabled: true,
        format: "DD-MM-YYYY",
      },
    };
    const config = getConfig(settings, "day");
    expect(config.enabled).toBe(true);
    expect(config.format).toBe("DD-MM-YYYY");
  });
});
