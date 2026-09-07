import { describe, expect, test } from "bun:test";

import { DEFAULT_FORMAT } from "./constants";
import { canonicalFolder } from "./paths";
import { sanitizeSettings } from "./settingsLoad";

// Stands in for Obsidian's normalizePath, which is not importable in tests.
const normalizePath = (path: string) => {
  const trimmed = path
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/^\/|\/$/g, "");
  return trimmed === "" ? "/" : trimmed;
};

const normalizeFolder = (folder: string) =>
  canonicalFolder(normalizePath(folder));

const sanitize = (saved: unknown) => sanitizeSettings(saved, normalizeFolder);

describe("sanitizeSettings", () => {
  test("returns defaults for missing or malformed data", () => {
    for (const saved of [
      null,
      undefined,
      42,
      "nope",
      {},
      { granularities: 1 },
    ]) {
      expect(sanitize(saved).granularities.day).toEqual({
        enabled: false,
        format: "",
        folder: "",
        templatePath: undefined,
      });
    }
  });

  test("keeps well-typed saved values", () => {
    const settings = sanitize({
      granularities: {
        day: {
          enabled: true,
          format: "YYYY-MM-DD",
          folder: "daily",
          templatePath: "templates/daily.md",
        },
      },
    });
    expect(settings.granularities.day).toEqual({
      enabled: true,
      format: "YYYY-MM-DD",
      folder: "daily",
      templatePath: "templates/daily.md",
    });
  });

  test("falls back per field, not per granularity", () => {
    const settings = sanitize({
      granularities: {
        day: { enabled: true, format: 42, folder: null, templatePath: {} },
      },
    });
    expect(settings.granularities.day).toEqual({
      enabled: true,
      format: "",
      folder: "",
      templatePath: undefined,
    });
  });

  test("normalizes a persisted folder", () => {
    const settings = sanitize({
      granularities: { day: { folder: "daily/" }, week: { folder: "/weekly" } },
    });
    expect(settings.granularities.day.folder).toBe("daily");
    expect(settings.granularities.week.folder).toBe("weekly");
  });

  test("refuses a persisted folder that escapes the vault", () => {
    const settings = sanitize({
      granularities: { day: { enabled: true, folder: "../outside" } },
    });
    expect(settings.granularities.day.folder).toBe("");
    expect(settings.granularities.day.enabled).toBe(true);
  });

  test("refuses a persisted format that escapes the vault", () => {
    const settings = sanitize({
      granularities: {
        day: { format: "[..]/YYYY-MM-DD" },
        week: { format: "../../outside" },
      },
    });
    expect(settings.granularities.day.format).toBe("");
    expect(settings.granularities.week.format).toBe("");
  });

  test("keeps a nested format with dots in a segment", () => {
    const settings = sanitize({
      granularities: { day: { format: "YYYY/MM/YYYY.MM.DD" } },
    });
    expect(settings.granularities.day.format).toBe("YYYY/MM/YYYY.MM.DD");
  });

  test("leaves untouched granularities at their defaults", () => {
    const settings = sanitize({
      granularities: { day: { enabled: true, folder: "daily" } },
    });
    expect(settings.granularities.year).toEqual({
      enabled: false,
      format: "",
      folder: "",
      templatePath: undefined,
    });
    expect(DEFAULT_FORMAT.year).toBe("YYYY");
  });
});
