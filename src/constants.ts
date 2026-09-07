import type { Granularity, NoteConfig, Settings } from "./types";

export const DEFAULT_FORMAT: Record<Granularity, string> = {
  day: "YYYY-MM-DD",
  week: "gggg-[W]ww",
  month: "YYYY-MM",
  year: "YYYY",
};

export const DEFAULT_CONFIG: NoteConfig = {
  enabled: false,
  format: "",
  folder: "",
  templatePath: undefined,
};

export const DEFAULT_SETTINGS: Settings = {
  granularities: {
    day: { ...DEFAULT_CONFIG },
    week: { ...DEFAULT_CONFIG },
    month: { ...DEFAULT_CONFIG },
    year: { ...DEFAULT_CONFIG },
  },
};

export const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

export type WeekdayName = (typeof WEEKDAYS)[number];

// How a period reads in a hover label, as opposed to how its filename is
// formatted. Day is absent deliberately: the hover for a day is an ISO date.
export const HUMANIZE_FORMAT: Partial<Record<Granularity, string>> = {
  week: "gggg-[W]ww",
  month: "MMMM YYYY",
  year: "YYYY",
};

export const VIEW_TYPE_CALENDAR = "calendar";

export const DISPLAYED_MONTH = Symbol("displayedMonth");
