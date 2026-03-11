import moment from "moment";

// @ts-expect-error partial window mock for test environment
globalThis.window = {
  moment,
  _bundledLocaleWeekSpec: { dow: 0, doy: 6 },
};
