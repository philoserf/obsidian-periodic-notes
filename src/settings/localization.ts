import type { WeekSpec } from "moment";
import type { App } from "obsidian";

declare global {
  interface Window {
    _bundledLocaleWeekSpec: WeekSpec;
    _hasConfiguredLocale: boolean;
  }
}

type LocaleOverride = "system-default" | string;

export type WeekStartOption =
  | "sunday"
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "locale";

const langToMomentLocale: Record<string, string> = {
  en: "en-gb",
  zh: "zh-cn",
  "zh-TW": "zh-tw",
  ru: "ru",
  ko: "ko",
  it: "it",
  id: "id",
  ro: "ro",
  "pt-BR": "pt-br",
  cz: "cs",
  da: "da",
  de: "de",
  es: "es",
  fr: "fr",
  no: "nn",
  pl: "pl",
  pt: "pt",
  tr: "tr",
  hi: "hi",
  nl: "nl",
  ar: "ar",
  ja: "ja",
};

const weekdays = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

export interface LocalizationSettings {
  localeOverride: LocaleOverride;
  weekStart: WeekStartOption;
}

function overrideGlobalMomentWeekStart(weekStart: WeekStartOption): void {
  const { moment } = window;
  const currentLocale = moment.locale();

  // Save the initial locale weekspec so that we can restore
  // it when toggling between the different options in settings.
  if (!window._bundledLocaleWeekSpec) {
    const localeData = moment.localeData();
    window._bundledLocaleWeekSpec = {
      dow: localeData.firstDayOfWeek(),
      doy: localeData.firstDayOfYear(),
    };
  }

  if (weekStart === "locale") {
    moment.updateLocale(currentLocale, {
      week: window._bundledLocaleWeekSpec,
    });
  } else {
    moment.updateLocale(currentLocale, {
      week: {
        dow: Math.max(0, weekdays.indexOf(weekStart)),
      },
    });
  }
}

/**
 * Sets the locale used by the calendar. This allows the calendar to
 * default to the user's locale (e.g. Start Week on Sunday/Monday/Friday)
 *
 * @param localeOverride locale string (e.g. "en-US")
 */
export function configureGlobalMomentLocale(
  localeOverride: LocaleOverride = "system-default",
  weekStart: WeekStartOption = "locale",
): string {
  const obsidianLang = localStorage.getItem("language") || "en";
  const systemLang = navigator.language?.toLowerCase();

  let momentLocale = langToMomentLocale[obsidianLang];

  if (localeOverride !== "system-default") {
    momentLocale = localeOverride;
  } else if (systemLang.startsWith(obsidianLang)) {
    // If the system locale is more specific (en-gb vs en), use the system locale.
    momentLocale = systemLang;
  }

  const currentLocale = window.moment.locale(momentLocale);
  console.debug(
    `[Periodic Notes] Trying to switch Moment.js global locale to ${momentLocale}, got ${currentLocale}`,
  );

  overrideGlobalMomentWeekStart(weekStart);

  return currentLocale;
}

export function initializeLocaleConfigOnce(app: App) {
  if (window._hasConfiguredLocale) {
    return;
  }

  const localization = getLocalizationSettings(app);
  const { localeOverride, weekStart } = localization;

  configureGlobalMomentLocale(localeOverride, weekStart);

  window._hasConfiguredLocale = true;
}

export function getLocalizationSettings(app: App): LocalizationSettings {
  try {
    // private API: vault.getConfig is undocumented
    const localeOverride =
      app.vault.getConfig("localeOverride") ?? "system-default";
    const weekStart = app.vault.getConfig("weekStart") ?? "locale";
    return { localeOverride, weekStart };
  } catch (e) {
    console.debug(
      "[Periodic Notes] vault.getConfig() unavailable, using defaults",
      e,
    );
    return { localeOverride: "system-default", weekStart: "locale" };
  }
}
