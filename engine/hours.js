// page/engine/hours.js
// Hour ranges by wall-clock label. Index ranges, not label lists, so the 23- and 25-hour DST days keep every hour.
import { addDays } from "./forecast.js";

const label = (ymd, h) => `${addDays(ymd, Math.floor(h / 24))}T${String(h % 24).padStart(2, "0")}:00`;

// Indices of the hours that start at fromH on ymd, up to but not including toH. toH may pass 24 (30 = 6 AM the next day).
// [] when either end label is missing from the response.
export function span(loc, ymd, fromH, toH) {
  const a = loc.time.indexOf(label(ymd, fromH)), b = loc.time.indexOf(label(ymd, toH));
  if (a < 0 || b <= a) return [];
  return Array.from({ length: b - a }, (_, k) => a + k);
}

// The hour an index starts at, counted from midnight on ymd (25 = 1 AM the next day).
export function hourOf(loc, ymd, i) {
  const t = loc.time[i];
  return +t.slice(11, 13) + (t.slice(0, 10) > ymd ? 24 : 0);
}
