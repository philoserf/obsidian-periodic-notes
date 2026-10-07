import type { Moment } from "moment";

export type Granularity = "day" | "week" | "month" | "year";
export const granularities: Granularity[] = ["day", "week", "month", "year"];

/**
 * Lives here rather than in format.ts because it reads no format: it is a
 * filter over the granularity list and the enabled flag, both declared in this
 * file. Three modules imported format.ts for this and nothing else.
 */
export function getEnabledGranularities(settings: Settings): Granularity[] {
  return granularities.filter((g) => settings.granularities[g].enabled);
}

export interface NoteConfig {
  enabled: boolean;
  format: string;
  folder: string;
  // `| undefined` on purpose: "no template" is written as undefined, which
  // JSON drops, so absent and undefined are one state on disk and in memory.
  templatePath?: string | undefined;
}

export interface Settings {
  granularities: Record<Granularity, NoteConfig>;
}

export interface CacheEntry {
  filePath: string;
  date: Moment;
  granularity: Granularity;
  match: "filename" | "frontmatter";
}
