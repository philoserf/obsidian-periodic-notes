import { describe, expect, test } from "bun:test";

import type { Granularity } from "../types";

// Re-implement pure functions to avoid obsidian imports

function removeEscapedCharacters(format: string): string {
  const withoutBrackets = format.replace(/\[[^\]]*\]/g, "");
  return withoutBrackets.replace(/\\./g, "");
}

function pathWithoutExtension(file: {
  path: string;
  extension: string;
}): string {
  const extLen = file.extension.length + 1;
  return file.path.slice(0, -extLen);
}

function getBasename(format: string): string {
  const isTemplateNested = format.indexOf("/") !== -1;
  return isTemplateNested ? (format.split("/").pop() ?? "") : format;
}

function isValidFilename(filename: string): boolean {
  const illegalRe = /[?<>\\:*|"]/g;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional
  const controlRe = /[\x00-\x1f\x80-\x9f]/g;
  const reservedRe = /^\.+$/;
  const windowsReservedRe = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

  return (
    !illegalRe.test(filename) &&
    !controlRe.test(filename) &&
    !reservedRe.test(filename) &&
    !windowsReservedRe.test(filename)
  );
}

function validateFormat(format: string, granularity: Granularity): string {
  if (!format) return "";
  if (!isValidFilename(format)) return "Format contains illegal characters";
  if (granularity === "day") {
    const testFormattedDate = window.moment().format(format);
    const parsedDate = window.moment(testFormattedDate, format, true);
    if (!parsedDate.isValid()) return "Failed to parse format";
  }
  return "";
}

function validateFormatComplexity(
  format: string,
  granularity: Granularity,
): "valid" | "fragile-basename" | "loose-parsing" {
  const testFormattedDate = window.moment().format(format);
  const parsedDate = window.moment(testFormattedDate, format, true);
  if (!parsedDate.isValid()) return "loose-parsing";

  const strippedFormat = removeEscapedCharacters(format);
  if (strippedFormat.includes("/")) {
    if (
      granularity === "day" &&
      !["m", "d", "y"].every(
        (requiredChar) =>
          getBasename(format)
            .replace(/\[[^\]]*\]/g, "")
            .toLowerCase()
            .indexOf(requiredChar) !== -1,
      )
    ) {
      return "fragile-basename";
    }
  }

  return "valid";
}

function getDateInput(
  file: { path: string; basename: string; extension: string },
  format: string,
  granularity: Granularity,
): string {
  if (validateFormatComplexity(format, granularity) === "fragile-basename") {
    const fileName = pathWithoutExtension(file);
    const strippedFormat = removeEscapedCharacters(format);
    const nestingLvl = (strippedFormat.match(/\//g)?.length ?? 0) + 1;
    const pathParts = fileName.split("/");
    return pathParts.slice(-nestingLvl).join("/");
  }
  return file.basename;
}

describe("pathWithoutExtension", () => {
  test("removes .md extension", () => {
    expect(
      pathWithoutExtension({ path: "daily/2026-03-15.md", extension: "md" }),
    ).toBe("daily/2026-03-15");
  });

  test("handles nested paths", () => {
    expect(
      pathWithoutExtension({ path: "notes/2026/03/15.md", extension: "md" }),
    ).toBe("notes/2026/03/15");
  });
});

describe("getBasename", () => {
  test("returns format for flat path", () => {
    expect(getBasename("YYYY-MM-DD")).toBe("YYYY-MM-DD");
  });

  test("returns last segment for nested path", () => {
    expect(getBasename("YYYY/YYYY-MM-DD")).toBe("YYYY-MM-DD");
  });

  test("handles deeply nested path", () => {
    expect(getBasename("YYYY/MM/DD")).toBe("DD");
  });

  test("returns empty string for trailing slash", () => {
    expect(getBasename("YYYY/")).toBe("");
  });
});

describe("validateFormat", () => {
  test("returns empty string for empty format", () => {
    expect(validateFormat("", "day")).toBe("");
  });

  test("returns empty string for valid day format", () => {
    expect(validateFormat("YYYY-MM-DD", "day")).toBe("");
  });

  test("returns error for illegal characters", () => {
    expect(validateFormat("YYYY:MM:DD", "day")).toBe(
      "Format contains illegal characters",
    );
  });

  test("returns error for unparseable day format", () => {
    // "abc" formats to "pmbc" which doesn't parse back
    expect(validateFormat("abc", "day")).toBe("Failed to parse format");
  });

  test("skips parse validation for non-day granularities", () => {
    // Formats that would fail parse for day should pass for month
    expect(validateFormat("YYYY-MM", "month")).toBe("");
  });

  test("accepts valid weekly format", () => {
    expect(validateFormat("gggg-[W]ww", "week")).toBe("");
  });

  test("accepts quarterly format", () => {
    expect(validateFormat("YYYY-[Q]Q", "quarter")).toBe("");
  });

  test("rejects Windows reserved names", () => {
    expect(validateFormat("CON", "day")).toBe(
      "Format contains illegal characters",
    );
  });
});

describe("validateFormatComplexity", () => {
  test("returns valid for simple day format", () => {
    expect(validateFormatComplexity("YYYY-MM-DD", "day")).toBe("valid");
  });

  test("returns valid for month format", () => {
    expect(validateFormatComplexity("YYYY-MM", "month")).toBe("valid");
  });

  test("returns fragile-basename for nested day format missing components", () => {
    // YYYY/DD is nested but basename "DD" lacks m and y
    expect(validateFormatComplexity("YYYY/DD", "day")).toBe("fragile-basename");
  });

  test("returns valid for nested day format with full basename", () => {
    expect(validateFormatComplexity("YYYY/YYYY-MM-DD", "day")).toBe("valid");
  });

  test("returns loose-parsing for format that fails round-trip", () => {
    // "abc" formats to "pmbc" which doesn't parse back strictly
    expect(validateFormatComplexity("abc", "day")).toBe("loose-parsing");
  });

  test("fragile-basename only applies to day granularity", () => {
    // YYYY/MM is nested but not day granularity, so no fragile check
    expect(validateFormatComplexity("YYYY/MM", "month")).toBe("valid");
  });
});

describe("getDateInput", () => {
  test("returns basename for simple format", () => {
    const file = {
      path: "daily/2026-03-15.md",
      basename: "2026-03-15",
      extension: "md",
    };
    expect(getDateInput(file, "YYYY-MM-DD", "day")).toBe("2026-03-15");
  });

  test("returns nested path parts for fragile-basename format", () => {
    const file = {
      path: "daily/2026/03/15.md",
      basename: "15",
      extension: "md",
    };
    // YYYY/MM/DD has 2 slashes, so nestingLvl = 3
    expect(getDateInput(file, "YYYY/MM/DD", "day")).toBe("2026/03/15");
  });

  test("returns basename for non-fragile nested format", () => {
    const file = {
      path: "daily/2026/2026-03-15.md",
      basename: "2026-03-15",
      extension: "md",
    };
    // YYYY/YYYY-MM-DD has full info in basename, so "valid" not "fragile-basename"
    expect(getDateInput(file, "YYYY/YYYY-MM-DD", "day")).toBe("2026-03-15");
  });
});
