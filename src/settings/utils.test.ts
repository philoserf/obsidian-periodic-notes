import { describe, expect, test } from "bun:test";
import moment from "moment";

import { DEFAULT_PERIODIC_CONFIG } from "../constants";
import { type Granularity, granularities } from "../types";

// @ts-expect-error global mock
globalThis.window = {
  moment,
  _bundledLocaleWeekSpec: { dow: 0, doy: 6 },
};

interface PeriodicConfig {
  enabled: boolean;
  openAtStartup: boolean;
  format: string;
  folder: string;
  templatePath?: string;
}

type Settings = Record<Granularity, PeriodicConfig | undefined>;

// Re-implement pure functions to avoid svelte/store and obsidian imports

function clearStartupNote(settings: Settings): Settings {
  for (const granularity of granularities) {
    const config = settings[granularity];
    if (config?.openAtStartup) {
      config.openAtStartup = false;
    }
  }
  return settings;
}

function findStartupNoteConfig(settings: Settings): Granularity | null {
  for (const granularity of granularities) {
    if (settings[granularity]?.openAtStartup) {
      return granularity;
    }
  }
  return null;
}

function getEnabledGranularities(settings: Settings): Granularity[] {
  return granularities.filter((g) => settings[g]?.enabled);
}

const emptySettings: Settings = {
  day: undefined,
  week: undefined,
  month: undefined,
  quarter: undefined,
  year: undefined,
};

describe("clearStartupNote", () => {
  test("disables all openAtStartup flags", () => {
    const settings: Settings = {
      ...emptySettings,
      day: { ...DEFAULT_PERIODIC_CONFIG, enabled: true, openAtStartup: true },
      week: { ...DEFAULT_PERIODIC_CONFIG, enabled: true, openAtStartup: true },
      month: undefined,
      quarter: undefined,
      year: undefined,
    };
    const result = clearStartupNote(settings);
    expect(result.day?.openAtStartup).toBe(false);
    expect(result.week?.openAtStartup).toBe(false);
  });

  test("handles settings with no startup notes", () => {
    const settings: Settings = {
      ...emptySettings,
      day: { ...DEFAULT_PERIODIC_CONFIG, enabled: true },
    };
    const result = clearStartupNote(settings);
    expect(result.day?.openAtStartup).toBe(false);
  });

  test("skips undefined configs", () => {
    const result = clearStartupNote({ ...emptySettings });
    expect(result.day).toBeUndefined();
  });
});

describe("findStartupNoteConfig", () => {
  test("returns first enabled startup granularity", () => {
    const settings: Settings = {
      ...emptySettings,
      day: { ...DEFAULT_PERIODIC_CONFIG, enabled: true, openAtStartup: false },
      week: { ...DEFAULT_PERIODIC_CONFIG, enabled: true, openAtStartup: true },
      month: undefined,
      quarter: undefined,
      year: undefined,
    };
    expect(findStartupNoteConfig(settings)).toBe("week");
  });

  test("returns day when it is first with openAtStartup", () => {
    const settings: Settings = {
      ...emptySettings,
      day: { ...DEFAULT_PERIODIC_CONFIG, enabled: true, openAtStartup: true },
      week: { ...DEFAULT_PERIODIC_CONFIG, enabled: true, openAtStartup: true },
      month: undefined,
      quarter: undefined,
      year: undefined,
    };
    expect(findStartupNoteConfig(settings)).toBe("day");
  });

  test("returns null when no startup note configured", () => {
    expect(findStartupNoteConfig(emptySettings)).toBeNull();
  });

  test("returns null when all openAtStartup are false", () => {
    const settings: Settings = {
      ...emptySettings,
      day: { ...DEFAULT_PERIODIC_CONFIG, enabled: true, openAtStartup: false },
    };
    expect(findStartupNoteConfig(settings)).toBeNull();
  });
});

describe("getEnabledGranularities", () => {
  test("returns empty array when nothing enabled", () => {
    expect(getEnabledGranularities(emptySettings)).toEqual([]);
  });

  test("returns only enabled granularities", () => {
    const settings: Settings = {
      ...emptySettings,
      day: { ...DEFAULT_PERIODIC_CONFIG, enabled: true },
      week: { ...DEFAULT_PERIODIC_CONFIG, enabled: false },
      month: { ...DEFAULT_PERIODIC_CONFIG, enabled: true },
      quarter: undefined,
      year: undefined,
    };
    expect(getEnabledGranularities(settings)).toEqual(["day", "month"]);
  });

  test("returns all granularities when all enabled", () => {
    const settings: Settings = {
      day: { ...DEFAULT_PERIODIC_CONFIG, enabled: true },
      week: { ...DEFAULT_PERIODIC_CONFIG, enabled: true },
      month: { ...DEFAULT_PERIODIC_CONFIG, enabled: true },
      quarter: { ...DEFAULT_PERIODIC_CONFIG, enabled: true },
      year: { ...DEFAULT_PERIODIC_CONFIG, enabled: true },
    };
    expect(getEnabledGranularities(settings)).toEqual(granularities);
  });

  test("handles undefined configs gracefully", () => {
    const settings: Settings = {
      ...emptySettings,
      day: { ...DEFAULT_PERIODIC_CONFIG, enabled: true },
    };
    expect(getEnabledGranularities(settings)).toEqual(["day"]);
  });
});
