import type { Moment } from "moment";

import { type Granularity, granularities, type Settings } from "./types";

export type CreateRequest =
  | { granularity: Granularity; date: Moment }
  | { error: string };

/**
 * The `periodic-notes:create` flags, checked. `granularity` defaults to day
 * and `date` to today. Strict YYYY-MM-DD, whatever the configured format: the
 * caller is a script naming a day, not a filename. A flag given bare arrives
 * as "true", which fails the same checks a bad value does.
 */
export function parseCreateRequest(
  params: Record<string, string | undefined>,
  settings: Settings,
): CreateRequest {
  const name = params.granularity ?? "day";
  const granularity = granularities.find((g) => g === name);
  if (!granularity) return { error: `unknown granularity "${name}"` };
  if (!settings.granularities[granularity].enabled) {
    return { error: `${granularity} notes are not enabled` };
  }

  if (params.date === undefined) return { granularity, date: window.moment() };
  const date = window.moment(params.date, "YYYY-MM-DD", true);
  if (!date.isValid()) {
    return { error: `date must be YYYY-MM-DD, got "${params.date}"` };
  }
  return { granularity, date };
}
