import type { Moment } from "moment";
import type { Month, Week } from "./types";

export function getWeekdayLabels(): string[] {
  return window.moment.weekdaysShort(true);
}

export function isWeekend(date: Moment): boolean {
  return date.isoWeekday() === 6 || date.isoWeekday() === 7;
}

export function getStartOfWeek(days: Moment[]): Moment {
  return days[0].clone();
}

export function getMonth(displayedMonth: Moment): Month {
  const month: Month = [];
  let week!: Week;

  const startOfMonth = displayedMonth.clone().date(1);
  const startOffset = startOfMonth.weekday();
  let date: Moment = startOfMonth.clone().subtract(startOffset, "days");

  for (let _day = 0; _day < 42; _day++) {
    if (_day % 7 === 0) {
      week = {
        days: [],
        weekNum: date.week(),
      };
      month.push(week);
    }

    week.days.push(date);
    date = date.clone().add(1, "days");
  }

  return month;
}

/**
 * Keydown handler for an element that acts as a button but is not one. Space
 * on a focused non-`<button>` scrolls its container by default, so a keyboard
 * user activating a week number would also jump the calendar out of view;
 * native buttons suppress that for free.
 *
 * Typed structurally rather than on KeyboardEvent so it stays testable without
 * a DOM.
 */
export function activateOnKey(
  activate: () => void,
): (event: Pick<KeyboardEvent, "key" | "preventDefault">) => void {
  return (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    activate();
  };
}
