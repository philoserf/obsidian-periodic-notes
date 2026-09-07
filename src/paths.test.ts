import { describe, expect, test } from "bun:test";

import {
  buildNotePath,
  canonicalFolder,
  hasDotDotSegment,
  isInFolder,
  literalizeFormat,
} from "./paths";

describe("hasDotDotSegment", () => {
  test("detects a dot-dot segment", () => {
    expect(hasDotDotSegment("../outside")).toBe(true);
    expect(hasDotDotSegment("daily/../../outside")).toBe(true);
    expect(hasDotDotSegment("..")).toBe(true);
  });

  test("allows dots inside a segment", () => {
    expect(hasDotDotSegment("2026.03.20")).toBe(false);
    expect(hasDotDotSegment("daily/..hidden")).toBe(false);
    expect(hasDotDotSegment("daily/2026-03-20.md")).toBe(false);
  });
});

describe("literalizeFormat", () => {
  test("renders bracket escapes", () => {
    expect(literalizeFormat("[..]/YYYY")).toBe("../YYYY");
  });

  test("renders backslash escapes", () => {
    expect(literalizeFormat("\\.\\./YYYY")).toBe("../YYYY");
  });

  test("leaves an ordinary format alone", () => {
    expect(literalizeFormat("YYYY-MM-DD")).toBe("YYYY-MM-DD");
    expect(literalizeFormat("gggg-[W]ww")).toBe("gggg-Www");
  });
});

describe("canonicalFolder", () => {
  test("spells the vault root as an empty string", () => {
    expect(canonicalFolder("/")).toBe("");
  });

  test("leaves a real folder alone", () => {
    expect(canonicalFolder("daily")).toBe("daily");
    expect(canonicalFolder("journal/daily")).toBe("journal/daily");
  });
});

describe("isInFolder", () => {
  test("an empty folder is the vault root", () => {
    expect(isInFolder("2026-03-20.md", "")).toBe(true);
    expect(isInFolder("daily/2026-03-20.md", "")).toBe(true);
  });

  test("tolerates a slash spelling of the root", () => {
    expect(isInFolder("daily/2026-03-20.md", "/")).toBe(true);
  });

  test("matches on a path prefix", () => {
    expect(isInFolder("daily/2026-03-20.md", "daily")).toBe(true);
    expect(isInFolder("daily/nested/2026-03-20.md", "daily")).toBe(true);
  });

  test("rejects a sibling folder with a shared prefix", () => {
    expect(isInFolder("daily-archive/2026-03-20.md", "daily")).toBe(false);
    expect(isInFolder("weekly/2026-W12.md", "daily")).toBe(false);
  });
});

describe("buildNotePath", () => {
  test("joins folder and filename", () => {
    expect(buildNotePath("daily", "2026-03-20.md")).toBe("daily/2026-03-20.md");
  });

  test("treats an empty folder as the vault root", () => {
    expect(buildNotePath("", "2026-03-20.md")).toBe("2026-03-20.md");
  });

  test("drops empty and dot segments", () => {
    expect(buildNotePath("daily/", "./2026-03-20.md")).toBe(
      "daily/2026-03-20.md",
    );
    expect(buildNotePath("/daily", "2026-03-20.md")).toBe(
      "daily/2026-03-20.md",
    );
  });

  test("keeps a nested filename", () => {
    expect(buildNotePath("journal", "2026/03/20.md")).toBe(
      "journal/2026/03/20.md",
    );
  });

  test("throws rather than escaping the vault", () => {
    expect(() => buildNotePath("../outside", "2026-03-20.md")).toThrow();
    expect(() => buildNotePath("daily", "../../outside/leak.md")).toThrow();
  });
});
