import { describe, expect, test } from "bun:test";
import { DEFAULT_SETTINGS } from "./constants";
import {
  extractDateStringFromPath,
  getBasename,
  getFormat,
  isValidFilename,
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

describe("extractDateStringFromPath", () => {
  const file = (path: string) => {
    const basename = path.split("/").pop()?.replace(/\.md$/, "") ?? "";
    return { path, basename, extension: "md" };
  };

  test("returns the basename for a flat format", () => {
    expect(
      extractDateStringFromPath(file("daily/2026-06-12.md"), "YYYY-MM-DD"),
    ).toBe("2026-06-12");
  });

  test("returns as many trailing segments as the format renders", () => {
    expect(
      extractDateStringFromPath(file("journal/2026/06/12.md"), "YYYY/MM/DD"),
    ).toBe("2026/06/12");
  });

  test("walks back for a nested format even when the basename is complete", () => {
    // The old pair only walked back when the basename could not pin the date;
    // the full format then had to be matched against a bare basename, which is
    // where the year went missing. One rule, so the whole rendered path counts.
    expect(
      extractDateStringFromPath(file("2026/2026-06-12.md"), "YYYY/YYYY-MM-DD"),
    ).toBe("2026/2026-06-12");
  });

  test("counts an escaped slash, which moment renders as a real separator", () => {
    // window.moment().format("YYYY/[d/]DD") produces "2026/d/16" - three
    // segments on disk, so "notes/2026/12.md" is not a path this format writes.
    expect(
      extractDateStringFromPath(file("notes/2026/d/12.md"), "YYYY/[d/]DD"),
    ).toBe("2026/d/12");
  });

  test("does not eat a path character when the file has no extension", () => {
    expect(
      extractDateStringFromPath(
        { path: "daily/2026-06-12", basename: "2026-06-12", extension: "" },
        "YYYY-MM-DD",
      ),
    ).toBe("2026-06-12");
  });
});

describe("getBasename", () => {
  test("returns a flat name unchanged", () => {
    expect(getBasename("2026-06-12")).toBe("2026-06-12");
  });

  test("returns the last segment of a nested name", () => {
    expect(getBasename("2026/06/12")).toBe("12");
  });

  test("returns the last segment of a one-level nested name", () => {
    expect(getBasename("2026/2026-06-12")).toBe("2026-06-12");
  });
});
