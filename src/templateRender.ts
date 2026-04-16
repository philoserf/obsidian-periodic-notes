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
        periodStart.add(parseInt(timeDelta, 10), unit);
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
  let contents = rawTemplateContents
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
      return date.weekday(day).format(momentFormat.trim());
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
