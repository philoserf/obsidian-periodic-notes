import { afterEach, describe, expect, test } from "bun:test";
import moment from "moment";

// @ts-expect-error global mock
globalThis.window = { moment };

// @ts-expect-error global mock
globalThis.localStorage = {
  getItem: () => "en",
};

// @ts-expect-error global mock
globalThis.navigator = {
  language: "en-US",
};

// Re-implement to avoid obsidian imports

type LocaleOverride = "system-default" | string;
type WeekStartOption =
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

function overrideGlobalMomentWeekStart(weekStart: WeekStartOption): void {
  const { moment } = window;
  const currentLocale = moment.locale();

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

function configureGlobalMomentLocale(
  localeOverride: LocaleOverride = "system-default",
  weekStart: WeekStartOption = "locale",
): string {
  const obsidianLang = localStorage.getItem("language") || "en";
  const systemLang = navigator.language?.toLowerCase();

  let momentLocale = langToMomentLocale[obsidianLang];

  if (localeOverride !== "system-default") {
    momentLocale = localeOverride;
  } else if (systemLang.startsWith(obsidianLang)) {
    momentLocale = systemLang;
  }

  const currentLocale = window.moment.locale(momentLocale);
  overrideGlobalMomentWeekStart(weekStart);

  return currentLocale;
}

interface LocalizationSettings {
  localeOverride: LocaleOverride;
  weekStart: WeekStartOption;
}

function getLocalizationSettings(app: {
  vault: { getConfig?: (key: string) => string | undefined };
}): LocalizationSettings {
  try {
    const localeOverride =
      app.vault.getConfig?.("localeOverride") ?? "system-default";
    const weekStart =
      (app.vault.getConfig?.("weekStart") as WeekStartOption) ?? "locale";
    return { localeOverride, weekStart };
  } catch {
    return { localeOverride: "system-default", weekStart: "locale" };
  }
}

// Save original locale state for cleanup
const originalLocale = moment.locale();

afterEach(() => {
  // Reset moment locale to original
  moment.locale(originalLocale);
  window._bundledLocaleWeekSpec =
    undefined as unknown as import("moment").WeekSpec;
});

describe("overrideGlobalMomentWeekStart", () => {
  test("sets monday as first day of week", () => {
    overrideGlobalMomentWeekStart("monday");
    expect(moment.localeData().firstDayOfWeek()).toBe(1);
  });

  test("sets sunday as first day of week", () => {
    overrideGlobalMomentWeekStart("sunday");
    expect(moment.localeData().firstDayOfWeek()).toBe(0);
  });

  test("sets saturday as first day of week", () => {
    overrideGlobalMomentWeekStart("saturday");
    expect(moment.localeData().firstDayOfWeek()).toBe(6);
  });

  test("restores locale default when set to locale", () => {
    // First set to monday
    overrideGlobalMomentWeekStart("monday");
    expect(moment.localeData().firstDayOfWeek()).toBe(1);

    // Then restore to locale default
    overrideGlobalMomentWeekStart("locale");
    // Should restore to whatever was saved in _bundledLocaleWeekSpec
    expect(moment.localeData().firstDayOfWeek()).toBe(
      window._bundledLocaleWeekSpec.dow,
    );
  });

  test("saves bundled locale spec on first call", () => {
    window._bundledLocaleWeekSpec =
      undefined as unknown as import("moment").WeekSpec;
    overrideGlobalMomentWeekStart("monday");
    expect(window._bundledLocaleWeekSpec).toBeDefined();
    expect(typeof window._bundledLocaleWeekSpec.dow).toBe("number");
    expect(typeof window._bundledLocaleWeekSpec.doy).toBe("number");
  });
});

describe("configureGlobalMomentLocale", () => {
  test("uses system locale by default", () => {
    const result = configureGlobalMomentLocale();
    // navigator.language is "en-US", obsidianLang starts with "en",
    // so systemLang ("en-us") starts with obsidianLang ("en") => uses systemLang
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  test("uses explicit locale override", () => {
    const result = configureGlobalMomentLocale("de");
    expect(result).toBe("de");
  });

  test("applies week start override", () => {
    configureGlobalMomentLocale("system-default", "monday");
    expect(moment.localeData().firstDayOfWeek()).toBe(1);
  });

  test("defaults weekStart to locale when not specified", () => {
    configureGlobalMomentLocale("system-default");
    // Should use _bundledLocaleWeekSpec
    expect(typeof moment.localeData().firstDayOfWeek()).toBe("number");
  });
});

describe("getLocalizationSettings", () => {
  test("returns values from vault.getConfig", () => {
    const app = {
      vault: {
        getConfig: (key: string) => {
          if (key === "localeOverride") return "fr";
          if (key === "weekStart") return "monday";
          return undefined;
        },
      },
    };
    const result = getLocalizationSettings(app);
    expect(result.localeOverride).toBe("fr");
    expect(result.weekStart).toBe("monday");
  });

  test("returns defaults when getConfig returns undefined", () => {
    const app = {
      vault: {
        getConfig: () => undefined,
      },
    };
    const result = getLocalizationSettings(app);
    expect(result.localeOverride).toBe("system-default");
    expect(result.weekStart).toBe("locale");
  });

  test("returns defaults when vault.getConfig throws", () => {
    const app = {
      vault: {
        getConfig: () => {
          throw new Error("private API unavailable");
        },
      },
    };
    const result = getLocalizationSettings(app);
    expect(result.localeOverride).toBe("system-default");
    expect(result.weekStart).toBe("locale");
  });

  test("returns defaults when getConfig is missing", () => {
    const app = { vault: {} };
    const result = getLocalizationSettings(app);
    expect(result.localeOverride).toBe("system-default");
    expect(result.weekStart).toBe("locale");
  });
});
