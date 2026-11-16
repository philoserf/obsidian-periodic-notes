import type { WeekStart } from "./types";

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

/**
 * Which moment locale Obsidian's language and the system locale imply. Pure, so
 * the mapping is testable — the effect below is what is not.
 *
 * Note the asymmetry: the system locale wins whenever it shares a prefix with
 * Obsidian's language, which makes the explicit `en -> en-gb` entry unreachable
 * for exactly the users it was written for (an `en` Obsidian on an `en-US`
 * system gets `en-us`). Left as it behaves, deliberately: reviving the entry
 * would move the calendar's first column from Sunday to Monday for everyone in
 * that position. A user who wants Monday sets the week start instead (#365).
 */
export function resolveMomentLocale(
  obsidianLang: string,
  systemLang: string | undefined,
): string {
  if (systemLang?.startsWith(obsidianLang)) return systemLang;
  return langToMomentLocale[obsidianLang] ?? obsidianLang;
}

const DAY_OF_WEEK: Record<Exclude<WeekStart, "locale">, number> = {
  sunday: 0,
  monday: 1,
};

/**
 * The week rule for a chosen week start, given the locale's own: `dow` is the
 * first day, `doy` encodes which January day always falls in week 1
 * (7 + dow - doy). Only the first day moves; that January day is kept, so
 * week 1 is still the week holding the same date and `ww` numbers stay put
 * for all but the day that changes rows. Null when nothing would change.
 */
export function weekRule(
  locale: { dow: number; doy: number },
  weekStart: WeekStart,
): { dow: number; doy: number } | null {
  if (weekStart === "locale") return null;
  const dow = DAY_OF_WEEK[weekStart];
  if (dow === locale.dow) return null;
  return { dow, doy: locale.doy + dow - locale.dow };
}

/**
 * Applies the locale for Obsidian's language — getLanguage(), passed in so this
 * module stays importable in tests — with the chosen week start, and returns a
 * function that puts back what was there.
 * `moment.locale(x)` is a global setter on the single moment instance Obsidian
 * hands every plugin, so leaving it set outlives the plugin's own lifetime and
 * silently reconfigures date formatting for the whole app.
 */
export function configureLocale(
  obsidianLang: string,
  weekStart: WeekStart,
): () => void {
  const { moment } = window;
  const previous = moment.locale();
  const momentLocale = resolveMomentLocale(
    obsidianLang,
    navigator.language?.toLowerCase(),
  );
  let actual = moment.locale(momentLocale);

  // A week start other than the locale's is a child locale, not
  // updateLocale on the parent: updating would rewrite the parent for every
  // later user of it, and restoring below could not undo that.
  const data = moment.localeData();
  const rule = weekRule(
    { dow: data.firstDayOfWeek(), doy: data.firstDayOfYear() },
    weekStart,
  );
  if (rule) {
    const child = `${actual}-periodic-notes-${weekStart}`;
    if (!moment.locales().includes(child)) {
      moment.defineLocale(child, { parentLocale: actual, week: rule });
    }
    actual = moment.locale(child);
  }

  console.debug(
    `[Periodic Notes] Configured locale: requested ${momentLocale}, week start ${weekStart}, got ${actual}`,
  );
  return () => {
    window.moment.locale(previous);
  };
}
