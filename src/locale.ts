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
 * that position.
 */
export function resolveMomentLocale(
  obsidianLang: string,
  systemLang: string | undefined,
): string {
  if (systemLang?.startsWith(obsidianLang)) return systemLang;
  return langToMomentLocale[obsidianLang] ?? obsidianLang;
}

/**
 * Applies the locale and returns a function that puts back what was there.
 * `moment.locale(x)` is a global setter on the single moment instance Obsidian
 * hands every plugin, so leaving it set outlives the plugin's own lifetime and
 * silently reconfigures date formatting for the whole app.
 */
export function configureLocale(): () => void {
  const previous = window.moment.locale();
  const obsidianLang = localStorage.getItem("language") || "en";
  const momentLocale = resolveMomentLocale(
    obsidianLang,
    navigator.language?.toLowerCase(),
  );
  const actual = window.moment.locale(momentLocale);
  console.debug(
    `[Periodic Notes] Configured locale: requested ${momentLocale}, got ${actual}`,
  );
  return () => {
    window.moment.locale(previous);
  };
}
