import { describe, expect, mock, test } from "bun:test";
import { resolveFile } from "./cacheResolve";
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

function mdFile(path: string) {
  const basename = path.split("/").pop()?.replace(/\.md$/, "") ?? "";
  return { path, basename, extension: "md" };
}

function fileWithExtension(path: string, extension: string) {
  const basename =
    path
      .split("/")
      .pop()
      ?.replace(/\.[^.]+$/, "") ?? "";
  return { path, basename, extension };
}

// Stands in for obsidian's parseFrontMatterEntry over a plain object.
const reader =
  (frontmatter: Record<string, unknown>) => (granularity: Granularity) =>
    frontmatter[granularity];

// The common case in these tests: a file with no frontmatter at all.
const noFrontmatter = () => undefined;

// console.warn is the diagnostic some of these assert on, so silence it per
// test and hand back the calls.
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

describe("resolveFile", () => {
  test("returns null when no granularity is enabled", () => {
    const settings = makeSettings({});
    expect(
      resolveFile(mdFile("daily/2026-06-12.md"), settings, noFrontmatter),
    ).toBe(null);
  });

  test("resolves a filename match for an enabled granularity", () => {
    const settings = makeSettings({ day: { enabled: true, folder: "daily" } });
    const entry = resolveFile(
      mdFile("daily/2026-06-12.md"),
      settings,
      noFrontmatter,
    );
    expect(entry).not.toBeNull();
    expect(entry?.granularity).toBe("day");
    expect(entry?.match).toBe("filename");
    expect(entry?.date.format("YYYY-MM-DD")).toBe("2026-06-12");
  });

  test("ignores files outside the configured folder", () => {
    const settings = makeSettings({ day: { enabled: true, folder: "daily" } });
    expect(
      resolveFile(mdFile("other/2026-06-12.md"), settings, noFrontmatter),
    ).toBe(null);
  });

  test("treats empty folder as vault root", () => {
    const settings = makeSettings({ day: { enabled: true } });
    const entry = resolveFile(
      mdFile("anywhere/2026-06-12.md"),
      settings,
      noFrontmatter,
    );
    expect(entry?.granularity).toBe("day");
  });

  test("does not match a sibling folder sharing a prefix", () => {
    const settings = makeSettings({ day: { enabled: true, folder: "daily" } });
    expect(
      resolveFile(
        mdFile("daily-archive/2026-06-12.md"),
        settings,
        noFrontmatter,
      ),
    ).toBe(null);
  });

  test("returns null for a filename that does not parse", () => {
    const settings = makeSettings({ day: { enabled: true } });
    expect(resolveFile(mdFile("daily/notes.md"), settings, noFrontmatter)).toBe(
      null,
    );
  });

  test("frontmatter wins when the filename would also parse", () => {
    // The precedence rule. It used to be a refusal inside the resolver, fed by
    // whatever the index already held; now it is the order of the two calls.
    const settings = makeSettings({ day: { enabled: true } });
    const entry = resolveFile(
      mdFile("daily/2026-06-12.md"),
      settings,
      reader({ day: "2026-01-01" }),
    );
    expect(entry?.match).toBe("frontmatter");
    expect(entry?.date.format("YYYY-MM-DD")).toBe("2026-01-01");
  });

  test("falls back to the filename when frontmatter says nothing", () => {
    // The metadataCache handler runs this on every save of a filename-matched
    // note, so the fallback has to keep working with no property present.
    const settings = makeSettings({ day: { enabled: true } });
    const entry = resolveFile(
      mdFile("daily/2026-06-12.md"),
      settings,
      noFrontmatter,
    );
    expect(entry?.match).toBe("filename");
    expect(entry?.date.format("YYYY-MM-DD")).toBe("2026-06-12");
  });

  test("iterates granularities until one parses", () => {
    const settings = makeSettings({
      day: { enabled: true },
      month: { enabled: true },
    });
    const entry = resolveFile(
      mdFile("monthly/2026-06.md"),
      settings,
      noFrontmatter,
    );
    expect(entry?.granularity).toBe("month");
  });

  test("first matching granularity wins for ambiguous names", () => {
    const settings = makeSettings({
      day: { enabled: true },
      year: { enabled: true },
    });
    const entry = resolveFile(mdFile("notes/2026.md"), settings, noFrontmatter);
    expect(entry?.granularity).toBe("year");
  });
});

// These drive resolveFile end to end on purpose. A unit test on
// extractDateStringFromPath would still pass against a resolver that handed
// moment an array of candidates, which is the shape that caused the defect:
// the partial candidate is the format with everything before the last slash
// removed, and that is exactly where the year token lives.
describe("resolveFile reads the year from nested formats", () => {
  test("a nested month format keeps the year in the path", () => {
    const settings = makeSettings({
      month: { enabled: true, format: "YYYY/MM", folder: "" },
    });
    const entry = resolveFile(mdFile("2019/09.md"), settings, noFrontmatter);
    expect(entry?.granularity).toBe("month");
    expect(entry?.date.format("YYYY-MM")).toBe("2019-09");
  });

  test("a nested week format keeps the week-year in the path", () => {
    const settings = makeSettings({
      week: { enabled: true, format: "gggg/[W]ww", folder: "" },
    });
    const entry = resolveFile(mdFile("2019/W37.md"), settings, noFrontmatter);
    expect(entry?.granularity).toBe("week");
    expect(entry?.date.format("gggg-[W]ww")).toBe("2019-W37");
  });

  test("two years under one nested format do not collapse onto one date", () => {
    const settings = makeSettings({
      month: { enabled: true, format: "YYYY/MM", folder: "" },
    });
    const a = resolveFile(mdFile("2019/09.md"), settings, noFrontmatter);
    const b = resolveFile(mdFile("2020/09.md"), settings, noFrontmatter);
    expect(a?.date.format("YYYY-MM")).toBe("2019-09");
    expect(b?.date.format("YYYY-MM")).toBe("2020-09");
  });

  test("a flat file under a nested format is not a periodic note", () => {
    // Intentional tightening: the format says notes live in a year folder, so
    // a file sitting outside one does not render from it.
    const settings = makeSettings({
      day: { enabled: true, format: "YYYY/YYYY-MM-DD", folder: "daily" },
    });
    expect(
      resolveFile(mdFile("daily/2026-06-12.md"), settings, noFrontmatter),
    ).toBe(null);
  });

  test("a nested format still resolves a file at the depth it renders", () => {
    const settings = makeSettings({
      day: { enabled: true, format: "YYYY/YYYY-MM-DD", folder: "daily" },
    });
    const entry = resolveFile(
      mdFile("daily/2026/2026-06-12.md"),
      settings,
      noFrontmatter,
    );
    expect(entry?.date.format("YYYY-MM-DD")).toBe("2026-06-12");
  });
});

// #281: creation is Markdown-only, so recognition is too. Without the guard an
// attachment whose basename parses becomes the note for that date, and a
// ".canvas" outranks the real ".md" on CacheIndex.preferred's lexical tiebreak.
describe("resolveFile only recognizes Markdown", () => {
  const settings = () => makeSettings({ day: { enabled: true } });

  test("a .png whose basename parses is not a periodic note", () => {
    expect(
      resolveFile(
        fileWithExtension("daily/2026-06-12.png", "png"),
        settings(),
        noFrontmatter,
      ),
    ).toBe(null);
  });

  test("a .canvas whose basename parses is not a periodic note", () => {
    expect(
      resolveFile(
        fileWithExtension("daily/2026-06-12.canvas", "canvas"),
        settings(),
        noFrontmatter,
      ),
    ).toBe(null);
  });

  test("the guard applies to frontmatter matches too, not just filenames", () => {
    expect(
      resolveFile(
        fileWithExtension("daily/notes.canvas", "canvas"),
        settings(),
        reader({ day: "2026-06-12" }),
      ),
    ).toBe(null);
  });

  test("an extensionless file is not a periodic note", () => {
    expect(
      resolveFile(
        fileWithExtension("daily/2026-06-12", ""),
        settings(),
        noFrontmatter,
      ),
    ).toBe(null);
  });
});

describe("resolveFile frontmatter matching", () => {
  test("returns null when no granularity is enabled", () => {
    expect(
      resolveFile(
        mdFile("Journals/note.md"),
        makeSettings({}),
        reader({ day: "2026-09-07" }),
      ),
    ).toBe(null);
  });

  test("matches a string value against the configured format", () => {
    const settings = makeSettings({
      day: { enabled: true, folder: "Journals" },
    });
    const entry = resolveFile(
      mdFile("Journals/note.md"),
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
      resolveFile(
        mdFile("Other/note.md"),
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
      resolveFile(
        mdFile("note.md"),
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
    const entry = resolveFile(
      mdFile("note.md"),
      settings,
      reader({ year: 2026 }),
    );
    expect(entry?.granularity).toBe("year");
    expect(entry?.date.format("YYYY")).toBe("2026");
  });

  test("accepts a single-element list", () => {
    const settings = makeSettings({ day: { enabled: true } });
    const entry = resolveFile(
      mdFile("note.md"),
      settings,
      reader({ day: ["2026-09-07"] }),
    );
    expect(entry?.date.format("YYYY-MM-DD")).toBe("2026-09-07");
  });

  test("refuses a value with no date reading, and says so", () => {
    const settings = makeSettings({ day: { enabled: true } });
    const { result, warnings } = captureWarnings(() =>
      resolveFile(mdFile("note.md"), settings, reader({ day: { a: 1 } })),
    );
    expect(result).toBe(null);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("is not a date value");
  });

  test("skips an absent or empty property without warning", () => {
    const settings = makeSettings({ day: { enabled: true } });
    const { result, warnings } = captureWarnings(() =>
      resolveFile(mdFile("note.md"), settings, reader({ day: "" })),
    );
    expect(result).toBe(null);
    expect(warnings).toHaveLength(0);
  });

  test("honours a custom format", () => {
    const settings = makeSettings({
      day: { enabled: true, format: "DD/MM/YYYY" },
    });
    const entry = resolveFile(
      mdFile("note.md"),
      settings,
      reader({ day: "07/09/2026" }),
    );
    expect(entry?.date.format("YYYY-MM-DD")).toBe("2026-09-07");
  });
});
