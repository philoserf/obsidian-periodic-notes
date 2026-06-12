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

export function configureLocale(): void {
  const obsidianLang = localStorage.getItem("language") || "en";
  const systemLang = navigator.language?.toLowerCase();
  let momentLocale = langToMomentLocale[obsidianLang] ?? obsidianLang;
  if (systemLang?.startsWith(obsidianLang)) {
    momentLocale = systemLang;
  }
  const actual = window.moment.locale(momentLocale);
  console.debug(
    `[Periodic Notes] Configured locale: requested ${momentLocale}, got ${actual}`,
  );
}
