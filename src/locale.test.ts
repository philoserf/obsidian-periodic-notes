import { describe, expect, test } from "bun:test";

import { configureLocale, resolveMomentLocale, weekRule } from "./locale";

describe("resolveMomentLocale", () => {
  test("maps an Obsidian language to its moment locale", () => {
    expect(resolveMomentLocale("zh", undefined)).toBe("zh-cn");
    expect(resolveMomentLocale("cz", undefined)).toBe("cs");
    expect(resolveMomentLocale("no", undefined)).toBe("nn");
  });

  test("passes an unmapped language through unchanged", () => {
    expect(resolveMomentLocale("sv", undefined)).toBe("sv");
  });

  test("the system locale wins when it shares the language prefix", () => {
    expect(resolveMomentLocale("pt", "pt-br")).toBe("pt-br");
    expect(resolveMomentLocale("de", "de-at")).toBe("de-at");
  });

  test("a system locale for another language does not win", () => {
    expect(resolveMomentLocale("fr", "en-us")).toBe("fr");
  });

  test("the en -> en-gb entry is unreachable on an English system", () => {
    // #197 recorded this asymmetry rather than fixing it. The table says an
    // "en" Obsidian should use en-gb, but the prefix rule above overrides it
    // for exactly those users. Reviving the entry would move the calendar's
    // first column from Sunday to Monday, so the behaviour stands and this
    // test is here to make it visible next time someone reads the table. The
    // week start setting is how a user picks Monday (#365).
    expect(resolveMomentLocale("en", "en-us")).toBe("en-us");
    expect(resolveMomentLocale("en", "en-gb")).toBe("en-gb");
    // It is reachable only from a non-English system.
    expect(resolveMomentLocale("en", "fr-fr")).toBe("en-gb");
  });
});

describe("configureLocale", () => {
  test("applies the language it is given, and restores the previous locale", () => {
    const previous = window.moment.locale();
    // defineLocale also makes the new locale current, so put it straight back:
    // the calendar tests depend on the global locale being left alone.
    window.moment.defineLocale("x-test", {});
    window.moment.locale(previous);

    const restore = configureLocale("x-test", "locale");
    expect(window.moment.locale()).toBe("x-test");
    restore();
    expect(window.moment.locale()).toBe(previous);
  });
});

describe("weekRule", () => {
  test("leaves the locale alone when nothing would change", () => {
    expect(weekRule({ dow: 0, doy: 6 }, "locale")).toBeNull();
    expect(weekRule({ dow: 0, doy: 6 }, "sunday")).toBeNull();
    expect(weekRule({ dow: 1, doy: 4 }, "monday")).toBeNull();
  });

  test("moves the first day and keeps the January day that is always week 1", () => {
    // en: week 1 holds Jan 1 (7 + 0 - 6). Monday-first, it still does.
    expect(weekRule({ dow: 0, doy: 6 }, "monday")).toEqual({ dow: 1, doy: 7 });
    // en-gb: week 1 holds Jan 4, the ISO rule. Sunday-first, it still does.
    expect(weekRule({ dow: 1, doy: 4 }, "sunday")).toEqual({ dow: 0, doy: 3 });
  });
});

describe("configureLocale with a week start", () => {
  // A language of its own, so the result does not hang on the test runner's
  // navigator.language: a copy of en, Sunday-first with week 1 holding Jan 1.
  // defineLocale makes it current, so put the global straight back — other
  // files depend on it, and every test below restores it too.
  const previous = window.moment.locale();
  window.moment.defineLocale("x-us", {
    parentLocale: "en",
    week: { dow: 0, doy: 6 },
  });
  window.moment.locale(previous);

  const withWeekStart = (
    weekStart: "locale" | "monday" | "sunday",
    body: () => void,
  ) => {
    const previous = window.moment.locale();
    const restore = configureLocale("x-us", weekStart);
    try {
      body();
    } finally {
      restore();
    }
    expect(window.moment.locale()).toBe(previous);
  };
  const m = (date: string) => window.moment(date, "YYYY-MM-DD");
  const LOCALE_WEEK = "gggg-[W]ww";
  const ISO_WEEK = "GGGG-[W]WW";

  test("Monday moves every week-dependent answer to Monday", () => {
    withWeekStart("monday", () => {
      expect(window.moment.localeData().firstDayOfWeek()).toBe(1);
      expect(window.moment.weekdaysShort(true)[0]).toBe("Mon");
      // Sunday 2026-11-15 now ends a week instead of starting one.
      expect(m("2026-11-15").startOf("week").format("YYYY-MM-DD")).toBe(
        "2026-11-09",
      );
      expect(m("2026-11-15").weekday()).toBe(6);
    });
  });

  test("the language default stays Sunday-first", () => {
    withWeekStart("locale", () => {
      expect(window.moment.localeData().firstDayOfWeek()).toBe(0);
      expect(window.moment.weekdaysShort(true)[0]).toBe("Sun");
    });
  });

  test("locale week numbers stay put except for the day that changes rows", () => {
    // Sunday-first, Sun 2025-12-28 to Sat 2026-01-03 is 2026-W01. Monday-first,
    // Mon 2025-12-29 to Sun 2026-01-04 is: the week holding Jan 1 is still 1.
    const days = [
      "2025-12-28",
      "2025-12-29",
      "2026-01-01",
      "2026-01-03",
      "2026-01-04",
      "2026-11-16",
      "2026-12-31",
    ];
    const sunday = days.map((d) => m(d).format(LOCALE_WEEK));
    let monday: string[] = [];
    withWeekStart("monday", () => {
      monday = days.map((d) => m(d).format(LOCALE_WEEK));
    });
    expect(sunday).toEqual([
      "2026-W01",
      "2026-W01",
      "2026-W01",
      "2026-W01",
      "2026-W02",
      "2026-W47",
      "2027-W01",
    ]);
    // Only the Sundays moved, each back into the week before.
    expect(monday).toEqual([
      "2025-W52",
      "2026-W01",
      "2026-W01",
      "2026-W01",
      "2026-W01",
      "2026-W47",
      "2027-W01",
    ]);
  });

  test("a locale weekly filename parses to its Monday", () => {
    withWeekStart("monday", () => {
      const parsed = window.moment("2026-W01", LOCALE_WEEK, true);
      expect(parsed.isValid()).toBe(true);
      expect(parsed.format("YYYY-MM-DD")).toBe("2025-12-29");
      expect(parsed.format(LOCALE_WEEK)).toBe("2026-W01");
    });
  });

  test("ISO week formats ignore the week start", () => {
    const days = ["2025-12-28", "2025-12-29", "2027-01-01", "2027-01-03"];
    const before = days.map((d) => m(d).format(ISO_WEEK));
    for (const weekStart of ["monday", "sunday"] as const) {
      withWeekStart(weekStart, () => {
        expect(days.map((d) => m(d).format(ISO_WEEK))).toEqual(before);
      });
    }
    expect(before).toEqual(["2025-W52", "2026-W01", "2026-W53", "2026-W53"]);
  });

  test("reconfiguring reuses the defined child locale", () => {
    withWeekStart("monday", () => {});
    withWeekStart("monday", () => {
      expect(window.moment.localeData().firstDayOfWeek()).toBe(1);
    });
  });
});
