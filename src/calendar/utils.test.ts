import { describe, expect, it } from "bun:test";
import moment from "moment";

import { activateOnKey, getMonth, isWeekend } from "./utils";

describe("getMonth", () => {
  it("always returns exactly 6 weeks (42 days)", () => {
    const months = [
      moment("2024-01-01"),
      moment("2024-02-01"),
      moment("2024-03-01"),
      moment("2024-12-01"),
    ];
    for (const m of months) {
      const grid = getMonth(m);
      expect(grid).toHaveLength(6);
      let total = 0;
      for (const week of grid) {
        total += week.days.length;
      }
      expect(total).toBe(42);
    }
  });

  it("first day of first week is on or before the 1st of the month", () => {
    const displayed = moment("2024-03-01");
    const grid = getMonth(displayed);
    const firstDay = grid[0].days[0];
    expect(firstDay.isSameOrBefore(displayed.clone().startOf("month"))).toBe(
      true,
    );
  });

  it("days within grid are in chronological order", () => {
    const grid = getMonth(moment("2024-06-01"));
    const days = grid.flatMap((w) => w.days);
    for (let i = 1; i < days.length; i++) {
      expect(days[i].valueOf()).toBeGreaterThan(days[i - 1].valueOf());
    }
  });

  it("each week has exactly 7 days", () => {
    const grid = getMonth(moment("2024-02-01"));
    for (const week of grid) {
      expect(week.days).toHaveLength(7);
    }
  });

  it("weekNum matches moment week number for each row", () => {
    const grid = getMonth(moment("2024-01-01"));
    for (const week of grid) {
      expect(week.weekNum).toBe(week.days[0].week());
    }
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
