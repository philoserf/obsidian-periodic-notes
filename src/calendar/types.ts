import type { Moment } from "moment";
import type { TFile } from "obsidian";
import type { Granularity } from "src/types";

export interface IWeek {
  days: Moment[];
  weekNum: number;
}

export type IMonth = IWeek[];

export interface IEventHandlers {
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
    existingFile: TFile | null,
    inNewSplit: boolean,
  ) => void;
  onContextMenu: (
    granularity: Granularity,
    date: Moment,
    file: TFile | null,
    event: MouseEvent,
  ) => void;
}

export type FileMap = Map<string, TFile | null>;
