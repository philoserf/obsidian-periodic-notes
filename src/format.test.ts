import { describe, expect, test } from "bun:test";
import { DEFAULT_SETTINGS } from "./constants";
import {
  extractDateStringFromPath,
  getFormat,
  getPossibleFormats,
  isFragileBasename,
  isIsoFormat,
  isValidFilename,
  removeEscapedCharacters,
  validateFormat,
} from "./format";
import type { Settings } from "./types";

function settingsWithFormat(granularity: string, format: string): Settings {
  return {
    granularities: {
      ...DEFAULT_SETTINGS.granularities,
      [granularity]: {
        ...DEFAULT_SETTINGS.granularities.day,
        format,
      },
    },
  };
}

describe("getFormat", () => {
  test("returns configured format", () => {
    const s = settingsWithFormat("day", "DD-MM-YYYY");
    expect(getFormat(s, "day")).toBe("DD-MM-YYYY");
  });

  test("returns default when empty", () => {
    expect(getFormat(DEFAULT_SETTINGS, "day")).toBe("YYYY-MM-DD");
    expect(getFormat(DEFAULT_SETTINGS, "week")).toBe("gggg-[W]ww");
  });
});

describe("getPossibleFormats", () => {
  test("returns default for unconfigured", () => {
    expect(getPossibleFormats(DEFAULT_SETTINGS, "day")).toEqual(["YYYY-MM-DD"]);
  });

  test("returns full and partial for nested format", () => {
    const s = settingsWithFormat("day", "YYYY/YYYY-MM-DD");
    expect(getPossibleFormats(s, "day")).toEqual([
      "YYYY/YYYY-MM-DD",
      "YYYY-MM-DD",
    ]);
  });
});

describe("removeEscapedCharacters", () => {
  test("removes bracket-escaped content", () => {
    expect(removeEscapedCharacters("YYYY-[W]ww")).toBe("YYYY-ww");
  });

  test("removes backslash-escaped characters", () => {
    expect(removeEscapedCharacters("YYYY\\-MM")).toBe("YYYYMM");
  });
});

describe("isValidFilename", () => {
  test("accepts normal filenames", () => {
    expect(isValidFilename("2026-03-20")).toBe(true);
  });

  test("rejects illegal characters", () => {
    expect(isValidFilename("file?name")).toBe(false);
    expect(isValidFilename("file:name")).toBe(false);
  });

  test("rejects reserved names", () => {
    expect(isValidFilename("CON")).toBe(false);
    expect(isValidFilename("nul.txt")).toBe(false);
  });
});

describe("validateFormat", () => {
  test("returns empty for valid format", () => {
    expect(validateFormat("YYYY-MM-DD", "day")).toBe("");
  });

  test("returns error for illegal characters", () => {
    expect(validateFormat("YYYY:MM:DD", "day")).toBe(
      "Format contains illegal characters",
    );
  });

  test("returns empty for empty format", () => {
    expect(validateFormat("", "day")).toBe("");
  });

  test("rejects a format whose output escapes the vault", () => {
    const escaped = "Format would place notes outside the vault";
    expect(validateFormat("[..]/YYYY-MM-DD", "day")).toBe(escaped);
    expect(validateFormat("../../outside/leak", "day")).toBe(escaped);
    // Non-day granularities skip the round trip, so they need their own check.
    expect(validateFormat("[..]/gggg-[W]ww", "week")).toBe(escaped);
  });

  test("allows dots inside a path segment", () => {
    expect(validateFormat("YYYY.MM.DD", "day")).toBe("");
    expect(validateFormat("YYYY/MM/YYYY.MM.DD", "day")).toBe("");
  });
});

describe("isFragileBasename", () => {
  test("a flat format is not fragile", () => {
    expect(isFragileBasename("YYYY-MM-DD", "day")).toBe(false);
  });

  test("a nested format whose basename lacks tokens is fragile", () => {
    expect(isFragileBasename("YYYY/DD", "day")).toBe(true);
    expect(isFragileBasename("YYYY/MM/DD", "day")).toBe(true);
  });

  test("a nested format with a complete basename is not fragile", () => {
    expect(isFragileBasename("YYYY/YYYY-MM-DD", "day")).toBe(false);
  });

  test("only daily formats can be fragile", () => {
    // Week, month and year notes are read from the basename regardless.
    expect(isFragileBasename("YYYY/DD", "week")).toBe(false);
    expect(isFragileBasename("YYYY/MM", "month")).toBe(false);
  });

  test("an escaped slash does not make a format nested", () => {
    expect(isFragileBasename("[YYYY/]DD", "day")).toBe(false);
  });
});

describe("isIsoFormat", () => {
  test("detects week tokens", () => {
    expect(isIsoFormat("gggg-[W]ww")).toBe(true);
  });

  test("rejects non-week formats", () => {
    expect(isIsoFormat("YYYY-MM-DD")).toBe(false);
  });
});

describe("extractDateStringFromPath", () => {
  const file = (path: string) => {
    const basename = path.split("/").pop()?.replace(/\.md$/, "") ?? "";
    return { path, basename, extension: "md" };
  };

  test("returns basename for a simple format", () => {
    expect(
      extractDateStringFromPath(
        file("daily/2026-06-12.md"),
        "YYYY-MM-DD",
        "day",
      ),
    ).toBe("2026-06-12");
  });

  test("returns trailing path segments for a fragile nested format", () => {
    expect(
      extractDateStringFromPath(
        file("journal/2026/06/12.md"),
        "YYYY/MM/DD",
        "day",
      ),
    ).toBe("2026/06/12");
  });

  test("ignores escaped slashes when counting nesting", () => {
    expect(
      extractDateStringFromPath(file("notes/2026/12.md"), "YYYY/[d/]DD", "day"),
    ).toBe("2026/12");
  });
});
