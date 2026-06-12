import { describe, expect, test } from "bun:test";
import { resolveEntry } from "./cacheResolve";
import { DEFAULT_SETTINGS } from "./constants";
import type { CacheEntry, Granularity, NoteConfig, Settings } from "./types";

function makeSettings(
  overrides: Partial<Record<Granularity, Partial<NoteConfig>>>,
): Settings {
  const settings = structuredClone(DEFAULT_SETTINGS);
  for (const [granularity, config] of Object.entries(overrides)) {
    settings.granularities[granularity as Granularity] = {
      ...settings.granularities[granularity as Granularity],
      ...config,
    };
  }
  return settings;
}

function mdFile(path: string) {
  const basename = path.split("/").pop()?.replace(/\.md$/, "") ?? "";
  return { path, basename, extension: "md" };
}

describe("resolveEntry", () => {
  test("returns null when no granularity is enabled", () => {
    const settings = makeSettings({});
    expect(resolveEntry(mdFile("daily/2026-06-12.md"), settings, null)).toBe(
      null,
    );
  });

  test("resolves a filename match for an enabled granularity", () => {
    const settings = makeSettings({ day: { enabled: true, folder: "daily" } });
    const entry = resolveEntry(mdFile("daily/2026-06-12.md"), settings, null);
    expect(entry).not.toBeNull();
    expect(entry?.granularity).toBe("day");
    expect(entry?.match).toBe("filename");
    expect(entry?.date.format("YYYY-MM-DD")).toBe("2026-06-12");
  });

  test("ignores files outside the configured folder", () => {
    const settings = makeSettings({ day: { enabled: true, folder: "daily" } });
    expect(resolveEntry(mdFile("other/2026-06-12.md"), settings, null)).toBe(
      null,
    );
  });

  test("treats empty folder as vault root", () => {
    const settings = makeSettings({ day: { enabled: true } });
    const entry = resolveEntry(
      mdFile("anywhere/2026-06-12.md"),
      settings,
      null,
    );
    expect(entry?.granularity).toBe("day");
  });

  test("returns null for a filename that does not parse", () => {
    const settings = makeSettings({ day: { enabled: true } });
    expect(resolveEntry(mdFile("daily/notes.md"), settings, null)).toBe(null);
  });

  test("frontmatter match wins over filename re-resolution", () => {
    const settings = makeSettings({ day: { enabled: true } });
    const existing: CacheEntry = {
      filePath: "daily/2026-06-12.md",
      date: window.moment("2026-01-01"),
      granularity: "day",
      match: "frontmatter",
    };
    expect(
      resolveEntry(mdFile("daily/2026-06-12.md"), settings, existing),
    ).toBe(null);
  });

  test("existing filename match is re-resolved", () => {
    const settings = makeSettings({ day: { enabled: true } });
    const existing: CacheEntry = {
      filePath: "daily/2026-06-12.md",
      date: window.moment("2026-06-12"),
      granularity: "day",
      match: "filename",
    };
    const entry = resolveEntry(
      mdFile("daily/2026-06-12.md"),
      settings,
      existing,
    );
    expect(entry?.match).toBe("filename");
  });

  test("iterates granularities until one parses", () => {
    const settings = makeSettings({
      day: { enabled: true },
      month: { enabled: true },
    });
    const entry = resolveEntry(mdFile("monthly/2026-06.md"), settings, null);
    expect(entry?.granularity).toBe("month");
  });

  test("first matching granularity wins for ambiguous names", () => {
    const settings = makeSettings({
      day: { enabled: true },
      year: { enabled: true },
    });
    const entry = resolveEntry(mdFile("notes/2026.md"), settings, null);
    expect(entry?.granularity).toBe("year");
  });
});
