import type { Moment } from "moment";

export type Granularity = "day" | "week" | "month" | "year";
export const granularities: Granularity[] = ["day", "week", "month", "year"];

export interface NoteConfig {
  enabled: boolean;
  format: string;
  folder: string;
  templatePath?: string;
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
