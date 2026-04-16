import type { Moment } from "moment";

export class DisplayedMonth {
  current = $state.raw<Moment>(window.moment());
}
