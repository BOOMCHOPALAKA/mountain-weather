// page/engine/picks.js
// What the TLDR names as the best weather. The numbers are starting points Scott approved 2026-10-30, not published thresholds.
const fin = (x) => typeof x === "number" && Number.isFinite(x);
export const PICK = { stormIn: 3, gustMph: 25, hotF: 85, baseIn: 12, baseFt: 1000, freshIn: 1, clearFrac: 0.2 };

// New-snow quality from the water-weighted snow ratio. Same bands as grade() in scripts/ski.py.
export function snowQuality(ratio) {
  if (!fin(ratio)) return null;
  return ratio >= 14 ? "light" : ratio >= 10 ? "medium" : ratio >= 7 ? "heavy" : "concrete";
}
// Too hot to call the best hiking weather. June to September only. t: { ymd, hi }.
export function tooHot(t) {
  const m = Number(String(t?.ymd ?? "").slice(5, 7));
  return m >= 6 && m <= 9 && fin(t?.hi) && t.hi > PICK.hotF;
}
// A day worth naming: dry, not mostly cloudy, gusts under the limit. s: a daySummary.
export const niceDay = (s) => !!s && s.condition === "dry" && fin(s.cloudyFrac?.value) && fin(s.gust?.value) && s.gust.value < PICK.gustMph;
// The only sky word the writer may use for a pick. s: a daySummary that passed niceDay.
export const skyWord = (s) => (s.cloudyFrac.value < PICK.clearFrac ? "clear" : "mostly clear");
// places.json has no open dates, so this is a calendar stand-in for resorts running: November 15 to April 30. Change the dates here.
export const resortSeason = (ymd) => { const md = String(ymd ?? "").slice(5, 10); return md >= "11-15" || md <= "04-30"; };
// Whether a station's depth speaks for a place. One more than baseFt above the place's lowest point says nothing about the hill; a lower one errs toward less snow.
export const stationSpeaks = (stationFt, lowestFt) => fin(stationFt) && fin(lowestFt) && stationFt - lowestFt <= PICK.baseFt;
// cands: [{ id, offset, gust, freshIn, baseIn }], already nice days. A measured base is the evidence when there is one: base plus fresh snow
// must reach baseIn. With no base, only a real storm just before the day counts. Fresh snow, then deeper base, then calm, then sooner.
export function bestSkiDay(cands) {
  const hasSnow = (c) => (fin(c.baseIn) ? c.baseIn + c.freshIn >= PICK.baseIn : c.freshIn >= PICK.stormIn);
  const depth = (c) => (fin(c.baseIn) ? c.baseIn : -Infinity);   // null sorts last; two nulls give NaN, which falls through to gust
  return cands
    .filter(hasSnow)
    .sort((a, b) => b.freshIn - a.freshIn || depth(b) - depth(a) || a.gust - b.gust || a.offset - b.offset)[0] ?? null;
}
