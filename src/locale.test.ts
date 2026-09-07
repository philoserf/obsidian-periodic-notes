import { describe, expect, test } from "bun:test";

import { resolveMomentLocale } from "./locale";

describe("resolveMomentLocale", () => {
  test("maps an Obsidian language to its moment locale", () => {
    expect(resolveMomentLocale("zh", undefined)).toBe("zh-cn");
    expect(resolveMomentLocale("cz", undefined)).toBe("cs");
    expect(resolveMomentLocale("no", undefined)).toBe("nn");
  });

  test("passes an unmapped language through unchanged", () => {
    expect(resolveMomentLocale("sv", undefined)).toBe("sv");
  });

  test("the system locale wins when it shares the language prefix", () => {
    expect(resolveMomentLocale("pt", "pt-br")).toBe("pt-br");
    expect(resolveMomentLocale("de", "de-at")).toBe("de-at");
  });

  test("a system locale for another language does not win", () => {
    expect(resolveMomentLocale("fr", "en-us")).toBe("fr");
  });

  test("the en -> en-gb entry is unreachable on an English system", () => {
    // #197 recorded this asymmetry rather than fixing it. The table says an
    // "en" Obsidian should use en-gb, but the prefix rule above overrides it
    // for exactly those users. Reviving the entry would move the calendar's
    // first column from Sunday to Monday, so the behaviour stands and this
    // test is here to make it visible next time someone reads the table.
    expect(resolveMomentLocale("en", "en-us")).toBe("en-us");
    expect(resolveMomentLocale("en", "en-gb")).toBe("en-gb");
    // It is reachable only from a non-English system.
    expect(resolveMomentLocale("en", "fr-fr")).toBe("en-gb");
  });
});
