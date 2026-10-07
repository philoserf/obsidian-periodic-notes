import type { Moment } from "moment";
import type { Month, Week } from "./types";

export function isWeekend(date: Moment): boolean {
  return date.isoWeekday() === 6 || date.isoWeekday() === 7;
}

/**
 * Whether a week format numbers weeks the ISO way (`G`/`W`, Monday-first,
 * week 1 holds the first Thursday) rather than by the locale (`g`/`w`).
 * Bracketed text is literal to moment, so it is dropped before looking.
 */
export function usesIsoWeek(format: string): boolean {
  return /[GW]/.test(format.replace(/\[[^\]]*\]/g, ""));
}

/**
 * The date a calendar row stands for when it is clicked, hovered or looked up.
 * Not days[0]: under a Sunday-first locale that is a Sunday, which an ISO
 * format files under the week before the row (#325). days[3] is inside the
 * row's week whichever day the row starts on — Wednesday or Thursday, and
 * Thursday is the day that decides ISO week membership.
 */
export function weekDate(days: Moment[]): Moment {
  return days[3];
}

export function getMonth(displayedMonth: Moment, weekFormat: string): Month {
  const isoWeek = usesIsoWeek(weekFormat);

  const month: Month = [];
  let week!: Week;

  const startOfMonth = displayedMonth.clone().date(1);
  const startOffset = startOfMonth.weekday();
  let date: Moment = startOfMonth.clone().subtract(startOffset, "days");

  for (let _day = 0; _day < 42; _day++) {
    if (_day % 7 === 0) {
      week = { days: [], weekNum: 0 };
      month.push(week);
    }

    week.days.push(date);
    date = date.clone().add(1, "days");
  }

  // Labelled in the format's own week system, from the same date a click
  // uses, so the number shown is the number the note gets. Around New Year
  // the two systems disagree even when the rows start on the same day.
  for (const w of month) {
    const anchor = weekDate(w.days);
    w.weekNum = isoWeek ? anchor.isoWeek() : anchor.week();
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
