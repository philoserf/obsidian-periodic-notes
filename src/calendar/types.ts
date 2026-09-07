import type { Moment } from "moment";
import type { TFile } from "obsidian";
import type { Granularity } from "src/types";

export interface Week {
  days: Moment[];
  weekNum: number;
}

export type Month = Week[];

export interface EventHandlers {
  onHover: (
    granularity: Granularity,
    date: Moment,
    file: TFile | null,
    targetEl: EventTarget,
    isMetaPressed: boolean,
  ) => void;
  onClick: (
    granularity: Granularity,
    date: Moment,
    inNewSplit: boolean,
  ) => void;
  onContextMenu: (file: TFile | null, event: MouseEvent) => void;
}

export type FileMap = Map<string, TFile | null>;
