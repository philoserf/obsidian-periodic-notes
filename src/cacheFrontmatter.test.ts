import { describe, expect, mock, test } from "bun:test";

import { resolveFrontmatterEntry } from "./cacheFrontmatter";
import { DEFAULT_SETTINGS } from "./constants";
import type { Granularity, NoteConfig, Settings } from "./types";

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

// Stands in for obsidian's parseFrontMatterEntry over a plain object.
const reader =
  (frontmatter: Record<string, unknown>) => (granularity: Granularity) =>
    frontmatter[granularity];

// console.warn is the diagnostic these tests assert on, so silence it per test
// and hand back the calls.
function captureWarnings<T>(run: () => T): { result: T; warnings: string[] } {
  const original = console.warn;
  const warnings: string[] = [];
  console.warn = mock((message: string) => {
    warnings.push(message);
  });
  try {
    return { result: run(), warnings };
  } finally {
    console.warn = original;
  }
}

describe("resolveFrontmatterEntry", () => {
  test("returns null when no granularity is enabled", () => {
    const settings = makeSettings({});
    expect(
      resolveFrontmatterEntry(
        "Journals/note.md",
        settings,
        reader({ day: "2026-09-07" }),
      ),
    ).toBe(null);
  });

  test("matches a string value against the configured format", () => {
    const settings = makeSettings({
      day: { enabled: true, folder: "Journals" },
    });
    const entry = resolveFrontmatterEntry(
      "Journals/note.md",
      settings,
      reader({ day: "2026-09-07" }),
    );
    expect(entry?.granularity).toBe("day");
    expect(entry?.match).toBe("frontmatter");
    expect(entry?.date.format("YYYY-MM-DD")).toBe("2026-09-07");
  });

  test("ignores a file outside the configured folder", () => {
    const settings = makeSettings({
      day: { enabled: true, folder: "Journals" },
    });
    expect(
      resolveFrontmatterEntry(
        "Other/note.md",
        settings,
        reader({ day: "2026-09-07" }),
      ),
    ).toBe(null);
  });

  test("tries later granularities after one that does not parse", () => {
    // #163: the old code returned on the first *string* value, valid or not.
    const settings = makeSettings({
      day: { enabled: true },
      week: { enabled: true },
    });
    const { result, warnings } = captureWarnings(() =>
      resolveFrontmatterEntry(
        "note.md",
        settings,
        reader({ day: "junk", week: "2026-W37" }),
      ),
    );
    expect(result?.granularity).toBe("week");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("day");
    expect(warnings[0]).toContain("junk");
  });

  test("accepts an unquoted YAML number", () => {
    // #189: `year: 2026` parses as a number, not a string.
    const settings = makeSettings({ year: { enabled: true } });
    const entry = resolveFrontmatterEntry(
      "note.md",
      settings,
      reader({ year: 2026 }),
    );
    expect(entry?.granularity).toBe("year");
    expect(entry?.date.format("YYYY")).toBe("2026");
  });

  test("accepts a single-element list", () => {
    const settings = makeSettings({ day: { enabled: true } });
    const entry = resolveFrontmatterEntry(
      "note.md",
      settings,
      reader({ day: ["2026-09-07"] }),
    );
    expect(entry?.date.format("YYYY-MM-DD")).toBe("2026-09-07");
  });

  test("refuses a value with no date reading, and says so", () => {
    const settings = makeSettings({ day: { enabled: true } });
    const { result, warnings } = captureWarnings(() =>
      resolveFrontmatterEntry("note.md", settings, reader({ day: { a: 1 } })),
    );
    expect(result).toBe(null);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("is not a date value");
  });

  test("skips an absent or empty property without warning", () => {
    const settings = makeSettings({ day: { enabled: true } });
    const { result, warnings } = captureWarnings(() =>
      resolveFrontmatterEntry("note.md", settings, reader({ day: "" })),
    );
    expect(result).toBe(null);
    expect(warnings).toHaveLength(0);
  });

  test("honours a custom format", () => {
    const settings = makeSettings({
      day: { enabled: true, format: "DD/MM/YYYY" },
    });
    const entry = resolveFrontmatterEntry(
      "note.md",
      settings,
      reader({ day: "07/09/2026" }),
    );
    expect(entry?.date.format("YYYY-MM-DD")).toBe("2026-09-07");
  });
});
