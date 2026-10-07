import { describe, expect, it } from "bun:test";
import moment from "moment";

import {
  activateOnKey,
  getMonth,
  isWeekend,
  usesIsoWeek,
  weekDate,
} from "./utils";

const LOCALE_WEEK = "gggg-[W]ww";
const ISO_WEEK = "GGGG-[W]WW";

describe("getMonth", () => {
  it("always returns exactly 6 weeks (42 days)", () => {
    const months = [
      moment("2024-01-01"),
      moment("2024-02-01"),
      moment("2024-03-01"),
      moment("2024-12-01"),
    ];
    for (const m of months) {
      const grid = getMonth(m, LOCALE_WEEK);
      expect(grid).toHaveLength(6);
      let total = 0;
      for (const week of grid) {
        expect(week.days).toHaveLength(7);
        total += week.days.length;
      }
      expect(total).toBe(42);
    }
  });

  it("first day of first week is on or before the 1st of the month", () => {
    const displayed = moment("2024-03-01");
    const grid = getMonth(displayed, LOCALE_WEEK);
    const firstDay = grid[0].days[0];
    expect(firstDay.isSameOrBefore(displayed.clone().startOf("month"))).toBe(
      true,
    );
  });

  it("days within grid are in chronological order", () => {
    const grid = getMonth(moment("2024-06-01"), LOCALE_WEEK);
    const days = grid.flatMap((w) => w.days);
    for (let i = 1; i < days.length; i++) {
      expect(days[i].valueOf()).toBeGreaterThan(days[i - 1].valueOf());
    }
  });
});

// The test preload's moment runs the "en" locale: Sunday-first, locale week
// numbering — the setting #325 was reported under.
describe("week rows under a Sunday-first locale", () => {
  const rows = (displayed: string, format: string) =>
    getMonth(moment(displayed), format).map((w) => ({
      label: w.weekNum,
      file: weekDate(w.days).format(format),
    }));

  const pad = (n: number) => String(n).padStart(2, "0");

  it("starts each row on Sunday, which is the case #325 needs", () => {
    expect(getMonth(moment("2026-10-01"), ISO_WEEK)[0].days[0].day()).toBe(0);
  });

  it("opens the ISO week a row is labelled with", () => {
    // #325: clicking 42 opened 2026-W41; clicking 45 created 2026-W44.
    for (const { label, file } of rows("2026-10-01", ISO_WEEK)) {
      expect(file.endsWith(`-W${pad(label)}`)).toBe(true);
    }
    // The row Sun 2026-10-11 to Sat 2026-10-17 is the one reported: its
    // Monday-to-Saturday is ISO week 42, so it is labelled and opens 42.
    const reported = getMonth(moment("2026-10-01"), ISO_WEEK).find((w) =>
      w.days[0].isSame("2026-10-11", "day"),
    );
    expect(reported?.weekNum).toBe(42);
    expect(reported && weekDate(reported.days).format(ISO_WEEK)).toBe(
      "2026-W42",
    );
  });

  it("labels and opens the right ISO week across a year boundary", () => {
    // The row Sun 2026-12-27 to Sat 2027-01-02 is locale week 1 but ISO
    // 2026-W53, so the label has to follow the format, not the locale.
    const boundary = rows("2027-01-01", ISO_WEEK)[0];
    expect(boundary).toEqual({ label: 53, file: "2026-W53" });
    for (const display of ["2026-12-01", "2027-01-01", "2021-01-01"]) {
      for (const { label, file } of rows(display, ISO_WEEK)) {
        expect(file.endsWith(`-W${pad(label)}`)).toBe(true);
      }
    }
  });

  it("keeps locale numbering for a locale format", () => {
    const boundary = rows("2027-01-01", LOCALE_WEEK)[0];
    expect(boundary).toEqual({ label: 1, file: "2027-W01" });
    for (const { label, file } of rows("2026-10-01", LOCALE_WEEK)) {
      expect(file.endsWith(`-W${pad(label)}`)).toBe(true);
    }
  });
});

describe("usesIsoWeek", () => {
  it("reads the format's own week tokens", () => {
    expect(usesIsoWeek("GGGG-[W]WW")).toBe(true);
    expect(usesIsoWeek("gggg-[W]ww")).toBe(false);
  });

  it("ignores bracketed literals", () => {
    // The [W] in the default format is a literal W, not an ISO token.
    expect(usesIsoWeek("gggg-[W]ww")).toBe(false);
    expect(usesIsoWeek("[GW]gggg-ww")).toBe(false);
  });
});

describe("isWeekend", () => {
  it("returns true for Saturday (isoWeekday 6)", () => {
    expect(isWeekend(moment("2024-02-24"))).toBe(true);
  });

  it("returns true for Sunday (isoWeekday 7)", () => {
    expect(isWeekend(moment("2024-02-25"))).toBe(true);
  });

  it("returns false for a weekday", () => {
    expect(isWeekend(moment("2024-02-26"))).toBe(false);
    expect(isWeekend(moment("2024-02-22"))).toBe(false);
  });
});

describe("activateOnKey", () => {
  const press = (key: string) => {
    let prevented = false;
    let activated = false;
    activateOnKey(() => {
      activated = true;
    })({ key, preventDefault: () => (prevented = true) });
    return { prevented, activated };
  };

  it("activates on Enter and suppresses the default", () => {
    expect(press("Enter")).toEqual({ prevented: true, activated: true });
  });

  it("activates on Space and suppresses the default", () => {
    // #195: Space on a focused non-<button> scrolls its container, so a
    // keyboard user opening a weekly note also jumped the calendar out of view.
    expect(press(" ")).toEqual({ prevented: true, activated: true });
  });

  it("ignores any other key without suppressing it", () => {
    expect(press("a")).toEqual({ prevented: false, activated: false });
    expect(press("Tab")).toEqual({ prevented: false, activated: false });
  });
});
