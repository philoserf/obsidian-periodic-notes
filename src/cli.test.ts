import { describe, expect, test } from "bun:test";

import { parseCreateRequest } from "./cli";
import { sanitizeSettings } from "./settingsLoad";

const settings = sanitizeSettings(
  {
    granularities: {
      day: { enabled: true, format: "YYYY-MM-DD", folder: "Journals" },
      week: { enabled: true, format: "gggg-[W]ww", folder: "Journals" },
    },
  },
  (folder) => folder,
);

describe("parseCreateRequest", () => {
  test("defaults to today's daily note", () => {
    const request = parseCreateRequest({}, settings);
    if ("error" in request) throw new Error(request.error);
    expect(request.granularity).toBe("day");
    expect(request.date.format("YYYY-MM-DD")).toBe(
      window.moment().format("YYYY-MM-DD"),
    );
  });

  test("reads a granularity and a YYYY-MM-DD date", () => {
    const request = parseCreateRequest(
      { granularity: "week", date: "2026-10-28" },
      settings,
    );
    if ("error" in request) throw new Error(request.error);
    expect(request.granularity).toBe("week");
    expect(request.date.format("YYYY-MM-DD")).toBe("2026-10-28");
  });

  test("rejects an unknown granularity", () => {
    expect(parseCreateRequest({ granularity: "decade" }, settings)).toEqual({
      error: 'unknown granularity "decade"',
    });
  });

  test("rejects a granularity that is not enabled", () => {
    expect(parseCreateRequest({ granularity: "year" }, settings)).toEqual({
      error: "year notes are not enabled",
    });
  });

  test("rejects a date that is not strict YYYY-MM-DD", () => {
    for (const date of [
      "2026-13-01",
      "10/28/2026",
      "2026-10-28T09:00",
      "true",
    ]) {
      expect(parseCreateRequest({ date }, settings)).toEqual({
        error: `date must be YYYY-MM-DD, got "${date}"`,
      });
    }
  });
});
