// page/engine/daycard.js
// One 7-day card: the daytime numbers Best reads, its icon from the same hours, and a separate night line.
// Night = 5 PM to 8 AM the next morning, so every hour lands on exactly one line: the day (8 AM to 5 PM) or a night.
// It is the night after the day; snow from the night before also shows as that day's fresh snow.
import { slr } from "../engine.js";
import { headline, nowIndex } from "./forecast.js";
import { span } from "./hours.js";
import { dayMetrics, partMetrics, earlyLook, modelSet, skyKey } from "./best.js";

const fin = (x) => typeof x === "number" && Number.isFinite(x);
const full = (arr, idx) => !!arr && idx.length > 0 && idx.every((i) => fin(arr[i]));

// The night's hour-start indices, 5 PM to 8 AM the next morning. rest: only the hours still ahead (tonight after 5 PM).
// Also the place view's Night icon (page/place.js), so the icon and the night line read the same hours.
export function nightIdx(loc, ymd, nowMs, rest = false) {
  const idx = span(loc, ymd, 17, 32);
  if (!rest) return idx;
  const n = nowIndex(loc, nowMs);
  return idx.filter((i) => i > n);
}

export function nightTotals(loc, ymd, nowMs, rest = false) {
  const idx = nightIdx(loc, ymd, nowMs, rest);
  if (!idx.length) return null;
  const acc = idx.map((i) => i + 1);
  const water = {}, rain = {}, snowIn = {}, lo = {};
  for (const m of modelSet(loc, idx, nowMs)) {
    const T = loc.series.temperature_2m?.[m], P = loc.series.precipitation?.[m];
    if (!full(T, idx) || !full(T, acc) || !full(P, acc)) continue;
    let w = 0, r = 0, s = 0;
    for (const i of acc) {
      const k = slr(T[i]);
      w += P[i];
      if (k == null) r += P[i]; else s += P[i] * k;
    }
    water[m] = w; rain[m] = r; snowIn[m] = s;
    lo[m] = Math.min(...idx.map((i) => T[i]));
  }
  if (!Object.keys(water).length) return null;
  return { ymd, hours: idx.length, water: headline(water), rain: headline(rain), snowIn: headline(snowIn), lo: headline(lo) };
}

// Today's card (offset 0) reads only the hours still ahead (Plan 1 M10): after 5 PM it has no day, only tonight.
export function dayCard(loc, ymd, offset, nowMs) {
  const rest = offset === 0;
  const day = dayMetrics(loc, ymd, nowMs, rest);
  return { ymd, offset, day, night: nightTotals(loc, ymd, nowMs, rest), early: earlyLook(day, offset), key: skyKey(day),
    am: partMetrics(loc, ymd, "AM", nowMs, rest), pm: partMetrics(loc, ymd, "PM", nowMs, rest) };
}
