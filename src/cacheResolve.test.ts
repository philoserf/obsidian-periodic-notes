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

  test("does not match a sibling folder sharing a prefix", () => {
    const settings = makeSettings({ day: { enabled: true, folder: "daily" } });
    expect(
      resolveEntry(mdFile("daily-archive/2026-06-12.md"), settings, null),
    ).toBe(null);
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

// These drive resolveEntry end to end on purpose. A unit test on
// extractDateStringFromPath would still pass against a resolver that handed
// moment an array of candidates, which is the shape that caused the defect:
// the partial candidate is the format with everything before the last slash
// removed, and that is exactly where the year token lives.
describe("resolveEntry reads the year from nested formats", () => {
  test("a nested month format keeps the year in the path", () => {
    const settings = makeSettings({
      month: { enabled: true, format: "YYYY/MM", folder: "" },
    });
    const entry = resolveEntry(mdFile("2019/09.md"), settings, null);
    expect(entry?.granularity).toBe("month");
    expect(entry?.date.format("YYYY-MM")).toBe("2019-09");
  });

  test("a nested week format keeps the week-year in the path", () => {
    const settings = makeSettings({
      week: { enabled: true, format: "gggg/[W]ww", folder: "" },
    });
    const entry = resolveEntry(mdFile("2019/W37.md"), settings, null);
    expect(entry?.granularity).toBe("week");
    expect(entry?.date.format("gggg-[W]ww")).toBe("2019-W37");
  });

  test("two years under one nested format do not collapse onto one date", () => {
    const settings = makeSettings({
      month: { enabled: true, format: "YYYY/MM", folder: "" },
    });
    const a = resolveEntry(mdFile("2019/09.md"), settings, null);
    const b = resolveEntry(mdFile("2020/09.md"), settings, null);
    expect(a?.date.format("YYYY-MM")).toBe("2019-09");
    expect(b?.date.format("YYYY-MM")).toBe("2020-09");
  });

  test("a flat file under a nested format is not a periodic note", () => {
    // Intentional tightening: the format says notes live in a year folder, so
    // a file sitting outside one does not render from it.
    const settings = makeSettings({
      day: { enabled: true, format: "YYYY/YYYY-MM-DD", folder: "daily" },
    });
    expect(resolveEntry(mdFile("daily/2026-06-12.md"), settings, null)).toBe(
      null,
    );
  });

  test("a nested format still resolves a file at the depth it renders", () => {
    const settings = makeSettings({
      day: { enabled: true, format: "YYYY/YYYY-MM-DD", folder: "daily" },
    });
    const entry = resolveEntry(
      mdFile("daily/2026/2026-06-12.md"),
      settings,
      null,
    );
    expect(entry?.date.format("YYYY-MM-DD")).toBe("2026-06-12");
  });
});
