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
 * system gets `en-us`). Left as it behaves: the first day of the week is the
 * week start setting's job now (#365, Monday by default), so this decides
 * only the rest of the locale — month names, date formats.
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
 * first day, `doy` encodes which January day anchors week 1 (7 + dow - doy).
 * Every week moves by the same few days, the short way round, and the anchor
 * moves with them, so `ww` numbers stay put for all but the days that change
 * rows. Keeping the anchor fixed instead renumbers a whole year whenever it
 * falls on a moved day: 2023 under `en`, whose 1 January is a Sunday.
 * Null when nothing would change.
 */
export function weekRule(
  locale: { dow: number; doy: number },
  weekStart: WeekStart,
): { dow: number; doy: number } | null {
  if (weekStart === "locale") return null;
  const dow = DAY_OF_WEEK[weekStart];
  if (dow === locale.dow) return null;
  // The shift in -3..3; the anchor moves by it, so doy moves by what dow
  // moved beyond it — nothing, unless the short way wraps the week.
  const shift = ((dow - locale.dow + 10) % 7) - 3;
  return { dow, doy: locale.doy + (dow - locale.dow - shift) };
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
    // Defined once, then updated: defineLocale on an existing name is
    // deprecated, and updating re-asserts the rule in case anything else
    // has rewritten the child since.
    if (moment.locales().includes(child)) {
      moment.updateLocale(child, { week: rule });
    } else {
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
