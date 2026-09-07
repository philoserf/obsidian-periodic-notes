import type { Moment } from "moment";

import { WEEKDAYS } from "./constants";
import type { Granularity } from "./types";

const DATE_TIME_TOKEN =
  /{{\s*(date|time)\s*(([-+]\d+)([ymwdhs]))?\s*(:.+?)?}}/gi;
const MONTH_TOKEN = /{{\s*(month)\s*(([-+]\d+)([ymwdhs]))?\s*(:.+?)?}}/gi;
const YEAR_TOKEN = /{{\s*(year)\s*(([-+]\d+)([ymwdhs]))?\s*(:.+?)?}}/gi;
const WEEKDAY_TOKEN = new RegExp(
  `{{\\s*(${WEEKDAYS.join("|")})\\s*:(.*?)}}`,
  "gi",
);

function getDaysOfWeek(): string[] {
  const { moment } = window;
  let weekStart = moment.localeData().firstDayOfWeek();
  const daysOfWeek = [...WEEKDAYS];
  while (weekStart) {
    const day = daysOfWeek.shift();
    if (day) daysOfWeek.push(day);
    weekStart--;
  }
  return daysOfWeek;
}

function getDayOfWeekNumericalValue(dayOfWeekName: string): number {
  const index = getDaysOfWeek().indexOf(dayOfWeekName.toLowerCase());
  return Math.max(0, index);
}

function replaceGranularityTokens(
  contents: string,
  date: Moment,
  pattern: RegExp,
  format: string,
  startOfUnit?: Granularity,
): string {
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
        // Moment's unit aliases are case-sensitive exactly where it hurts:
        // "M" is month, "m" is minute. The token patterns are case-insensitive
        // so that {{Month}} works, which means a lowercase "m" arrives
        // indistinguishable from an uppercase one. A month or year token has
        // no meaningful minute delta, so read it as months there; a date/time
        // token keeps moment's own reading, where {{date-30m}} really does
        // mean thirty minutes.
        const resolvedUnit = startOfUnit && unit === "m" ? "M" : unit;
        periodStart.add(parseInt(timeDelta, 10), resolvedUnit);
      }
      if (momentFormat) {
        return periodStart.format(momentFormat.substring(1).trim());
      }
      return periodStart.format(format);
    },
  );
}

export function applyTemplate(
  filename: string,
  granularity: Granularity,
  date: Moment,
  format: string,
  rawTemplateContents: string,
): string {
  // Replacer functions, not strings: a string replacement reads "$&", "$`",
  // "$\'", "$1"-"$9" and "$$" as patterns, and `filename` comes from the user's
  // date format, which may legitimately contain "$".
  let contents = rawTemplateContents
    .replace(/{{\s*date\s*}}/gi, () => filename)
    .replace(/{{\s*time\s*}}/gi, () => window.moment().format("HH:mm"))
    .replace(/{{\s*title\s*}}/gi, () => filename);

  if (granularity === "day") {
    contents = contents
      .replace(/{{\s*yesterday\s*}}/gi, () =>
        date.clone().subtract(1, "day").format(format),
      )
      .replace(/{{\s*tomorrow\s*}}/gi, () =>
        date.clone().add(1, "d").format(format),
      );
    contents = replaceGranularityTokens(
      contents,
      date,
      DATE_TIME_TOKEN,
      format,
    );
  }

  if (granularity === "week") {
    contents = contents.replace(WEEKDAY_TOKEN, (_, dayOfWeek, momentFormat) => {
      const day = getDayOfWeekNumericalValue(dayOfWeek);
      // .weekday() mutates and returns the same instance. `date` may be the
      // Moment held by a CacheEntry, whose canonical key would then no longer
      // match the key it is indexed under.
      return date.clone().weekday(day).format(momentFormat.trim());
    });
  }

  if (granularity === "month") {
    contents = replaceGranularityTokens(
      contents,
      date,
      MONTH_TOKEN,
      format,
      "month",
    );
  }

  if (granularity === "year") {
    contents = replaceGranularityTokens(
      contents,
      date,
      YEAR_TOKEN,
      format,
      "year",
    );
  }

  return contents;
}
