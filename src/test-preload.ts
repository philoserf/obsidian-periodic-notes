import moment from "moment";

// @ts-expect-error partial window mock for test environment
globalThis.window = { moment };
