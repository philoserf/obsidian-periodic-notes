import type { Moment } from "moment";

export class DisplayedMonth {
  current = $state<Moment>(window.moment());
}
