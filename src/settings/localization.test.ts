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

import {
  configureGlobalMomentLocale,
  getLocalizationSettings,
} from "./localization";

// Save original locale state for cleanup
const originalLocale = moment.locale();

afterEach(() => {
  // Reset moment locale to original
  moment.locale(originalLocale);
  window._bundledLocaleWeekSpec =
    undefined as unknown as import("moment").WeekSpec;
});

describe("configureGlobalMomentLocale", () => {
  test("uses system locale by default", () => {
    const result = configureGlobalMomentLocale();
    // navigator.language is "en-US", obsidianLang is "en",
    // systemLang ("en-us") starts with obsidianLang => tries "en-us",
    // moment falls back to closest match "en"
    expect(result).toBe("en");
  });

  test("uses explicit locale override", () => {
    const result = configureGlobalMomentLocale("de");
    expect(result).toBe("de");
  });

  test("applies week start override", () => {
    configureGlobalMomentLocale("system-default", "monday");
    expect(moment.localeData().firstDayOfWeek()).toBe(1);
  });

  test("sets sunday as first day of week", () => {
    configureGlobalMomentLocale("system-default", "sunday");
    expect(moment.localeData().firstDayOfWeek()).toBe(0);
  });

  test("sets saturday as first day of week", () => {
    configureGlobalMomentLocale("system-default", "saturday");
    expect(moment.localeData().firstDayOfWeek()).toBe(6);
  });

  test("restores locale default when weekStart is locale", () => {
    // First set to monday
    configureGlobalMomentLocale("system-default", "monday");
    expect(moment.localeData().firstDayOfWeek()).toBe(1);

    // Then restore to locale default
    configureGlobalMomentLocale("system-default", "locale");
    // Should restore to whatever was saved in _bundledLocaleWeekSpec
    expect(moment.localeData().firstDayOfWeek()).toBe(
      window._bundledLocaleWeekSpec.dow,
    );
  });

  test("saves bundled locale spec on first call", () => {
    window._bundledLocaleWeekSpec =
      undefined as unknown as import("moment").WeekSpec;
    configureGlobalMomentLocale("system-default", "monday");
    expect(window._bundledLocaleWeekSpec).toBeDefined();
    expect(typeof window._bundledLocaleWeekSpec.dow).toBe("number");
    expect(typeof window._bundledLocaleWeekSpec.doy).toBe("number");
  });

  test("defaults weekStart to locale when not specified", () => {
    configureGlobalMomentLocale("system-default");
    // Should restore to the saved bundled locale week start
    expect(moment.localeData().firstDayOfWeek()).toBe(
      window._bundledLocaleWeekSpec.dow,
    );
  });
});

describe("getLocalizationSettings", () => {
  // biome-ignore lint/suspicious/noExplicitAny: minimal App mocks for testing
  const mockApp = (vault: Record<string, unknown>) => ({ vault }) as any;

  test("returns values from vault.getConfig", () => {
    const app = mockApp({
      getConfig: (key: string) => {
        if (key === "localeOverride") return "fr";
        if (key === "weekStart") return "monday";
        return undefined;
      },
    });
    const result = getLocalizationSettings(app);
    expect(result.localeOverride).toBe("fr");
    expect(result.weekStart).toBe("monday");
  });

  test("returns defaults when getConfig returns undefined", () => {
    const app = mockApp({ getConfig: () => undefined });
    const result = getLocalizationSettings(app);
    expect(result.localeOverride).toBe("system-default");
    expect(result.weekStart).toBe("locale");
  });

  test("returns defaults when vault.getConfig throws", () => {
    const app = mockApp({
      getConfig: () => {
        throw new Error("private API unavailable");
      },
    });
    const result = getLocalizationSettings(app);
    expect(result.localeOverride).toBe("system-default");
    expect(result.weekStart).toBe("locale");
  });

  test("returns defaults when getConfig is missing", () => {
    const app = mockApp({});
    const result = getLocalizationSettings(app);
    expect(result.localeOverride).toBe("system-default");
    expect(result.weekStart).toBe("locale");
  });
});
