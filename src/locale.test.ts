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
    // for exactly those users. The first day of the week is the week start
    // setting's now (#365), so this only picks the rest of the locale; the
    // test keeps the asymmetry visible next time someone reads the table.
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

  test("moves the first day and the week-1 anchor together", () => {
    // en: week 1 is anchored on Jan 1; Monday-first, every week moves a day
    // later, and the anchor with them, to Jan 2.
    expect(weekRule({ dow: 0, doy: 6 }, "monday")).toEqual({ dow: 1, doy: 6 });
    // en-gb: anchored on Jan 4; Sunday-first, a day earlier, to Jan 3.
    expect(weekRule({ dow: 1, doy: 4 }, "sunday")).toEqual({ dow: 0, doy: 4 });
    // Saturday-first to Monday is two days later, not five earlier.
    expect(weekRule({ dow: 6, doy: 12 }, "monday")).toEqual({ dow: 1, doy: 5 });
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

describe("weekRule keeps locale week numbers", () => {
  // Every day the move does not carry into another week keeps its `ww`
  // number, in every year — the claim the changelog makes. A Sunday 1 January
  // (2023, 2034) is where shifting doy with dow broke it.
  const previous = window.moment.locale();
  const parents = {
    "x-wk-sun": { dow: 0, doy: 6 }, // en: week 1 holds 1 January
    "x-wk-mon": { dow: 1, doy: 4 }, // en-gb: week 1 holds 4 January
    "x-wk-sat": { dow: 6, doy: 12 }, // ar: Saturday-first
  };
  for (const [name, week] of Object.entries(parents)) {
    window.moment.defineLocale(name, { parentLocale: "en", week });
  }
  window.moment.locale(previous);

  const numbers = (locale: string, days: string[]) =>
    days.map((d) => window.moment.utc(d).locale(locale).format("gggg-[W]ww"));
  const days: string[] = [];
  for (
    const d = window.moment.utc("2019-12-01");
    d.isBefore("2046-01-31");
    d.add(1, "day")
  ) {
    days.push(d.format("YYYY-MM-DD"));
  }

  for (const [parent, week] of Object.entries(parents)) {
    for (const weekStart of ["monday", "sunday"] as const) {
      const rule = weekRule(week, weekStart);
      if (!rule) continue;
      test(`${parent} to ${weekStart}`, () => {
        const child = `${parent}-${weekStart}`;
        window.moment.defineLocale(child, { parentLocale: parent, week: rule });
        window.moment.locale(previous);
        const before = numbers(parent, days);
        const after = numbers(child, days);
        // The days that change rows: from the old first day up to the new
        // one, going the short way round.
        const shift = ((rule.dow - week.dow + 10) % 7) - 3;
        const moved = new Set(
          Array.from({ length: Math.abs(shift) }, (_, i) =>
            shift > 0 ? (week.dow + i) % 7 : (week.dow - 1 - i + 7) % 7,
          ),
        );
        const changed = days.filter(
          (d, i) =>
            before[i] !== after[i] && !moved.has(window.moment.utc(d).day()),
        );
        expect(changed).toEqual([]);
      });
    }
  }
});
