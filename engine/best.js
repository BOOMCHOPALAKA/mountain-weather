// page/engine/best.js
// One Best for the whole app (Scott, 2026-11-05 and 11-06). Scores 8 AM to 5 PM. Dry beats snowing, sun breaks ties,
// rain at the point never gets Best. The page and the TLDR digest both call this file; nothing else decides Best.
import { slr } from "../engine.js";
import { SHORT, MEDIUM, HRRR, GFS } from "./models.js";
import { headline, nowIndex } from "./forecast.js";
import { span } from "./hours.js";

export const BEST = { fromH: 8, toH: 17, dryIn: 0.05, rainShareMax: 0.2, powderIn: 6, bluebirdClear: 0.6, bluebirdFreshIn: 2,
  earlyOffset: 4, earlyWaterIn: 0.25, earlyWaterTop: 0.15, earlySnowIn: 4, earlyShare: 0.4 };
const fin = (x) => typeof x === "number" && Number.isFinite(x);
const full = (arr, idx) => !!arr && idx.length > 0 && idx.every((i) => fin(arr[i]));
export const V = (h) => h?.value ?? 0;

// The models that speak for a stretch of hours (hour-start indices idx). Best, the day card and the window all use it.
// SHORT when the stretch ends within 48 h of now, else MEDIUM, keeping models with precipitation and temperature for every
// hour (hour-ending, i + 1). Under minModels, every model with full data. GFS copies HRRR where HRRR has data, so GFS drops
// out whenever HRRR covers any of these hours.
export function modelSet(loc, idx, nowMs, minModels = 2) {
  if (!idx.length) return [];
  const n = nowIndex(loc, nowMs);
  const full = (m) => idx.every((i) => fin(loc.series.precipitation?.[m]?.[i + 1]) && fin(loc.series.temperature_2m?.[m]?.[i + 1]));
  const dedupe = (ms) => (idx.some((i) => fin(loc.series.precipitation?.[HRRR]?.[i + 1])) ? ms.filter((m) => m !== GFS) : ms);
  const end = idx[idx.length - 1] + 1;
  const first = dedupe((n >= 0 && end - n <= 48 ? SHORT : MEDIUM).filter(full));
  if (first.length >= minModels) return first;
  return dedupe([...new Set([...SHORT, ...MEDIUM])].filter(full));
}

// The numbers for a stretch of hours (hour-start indices sky, in order), per model, then each field's headline.
// Water and gusts are the preceding hour's sum and maximum (index + 1); sky and temperature are instant (index).
// fresh: the indices whose precipitation counts as fresh snow (each read as it stands). null when no model covers sky.
export function metricsOver(loc, sky, nowMs, fresh = []) {
  if (!sky.length) return null;
  const acc = sky.map((i) => i + 1);
  const out = { water: {}, rain: {}, snowW: {}, snowIn: {}, fresh: {}, clear: {}, gust: {}, hi: {}, lo: {} };
  for (const m of modelSet(loc, sky, nowMs)) {
    const T = loc.series.temperature_2m?.[m], P = loc.series.precipitation?.[m];
    const C = loc.series.weather_code?.[m], G = loc.series.wind_gusts_10m?.[m];
    if (!full(T, sky) || !full(T, acc) || !full(P, acc)) continue;
    let w = 0, r = 0, sw = 0, s = 0;
    for (const i of acc) {
      const k = slr(T[i]);
      w += P[i];
      if (k == null) r += P[i]; else { sw += P[i]; s += P[i] * k; }
    }
    out.water[m] = w; out.rain[m] = r; out.snowW[m] = sw; out.snowIn[m] = s;
    out.hi[m] = Math.max(...sky.map((i) => T[i]));
    out.lo[m] = Math.min(...sky.map((i) => T[i]));
    if (full(C, sky)) out.clear[m] = sky.filter((i) => C[i] <= 2).length / sky.length;
    if (full(G, acc)) out.gust[m] = Math.max(...acc.map((i) => G[i]));
    if (fresh.length && full(T, fresh) && full(P, fresh)) {
      out.fresh[m] = fresh.reduce((a, i) => { const k = slr(T[i]); return a + (k == null ? 0 : P[i] * k); }, 0);
    }
  }
  if (!Object.keys(out.water).length) return null;
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, headline(v)]));
}

// Hours from a span that are still ahead: the ones starting after the current hour, as the window counts them.
const ahead = (loc, idx, nowMs) => { const n = nowIndex(loc, nowMs); return idx.filter((i) => i > n); };

// Daytime numbers for one day: the hours starting 8 AM through 4 PM, so water and gusts cover 8:00 to 17:00.
// fresh = snow in the 24 hours ending 10 AM that day. rest: only the hours still ahead (today's card, M10).
// Each field is a headline ({ value, min, max, n }) or null; null overall when no model covers the hours.
export function dayMetrics(loc, ymd, nowMs, rest = false) {
  let sky = span(loc, ymd, BEST.fromH, BEST.toH);
  if (rest) sky = ahead(loc, sky, nowMs);
  const f10 = loc.time.indexOf(`${ymd}T10:00`);
  const fresh = f10 >= 23 ? Array.from({ length: 24 }, (_, k) => f10 - 23 + k) : [];
  const m = metricsOver(loc, sky, nowMs, fresh);
  return m ? { ymd, ...m } : null;
}

// Morning and afternoon inside the daytime span, for the 7-day card's tap and a Best day past the window's days.
// Under 2 hours (what is left of a part today) gives null.
export const PARTS = { AM: [8, 12], PM: [12, 17] };
export function partMetrics(loc, ymd, part, nowMs, rest = false) {
  const [a, b] = PARTS[part];
  let sky = span(loc, ymd, a, b);
  if (rest) sky = ahead(loc, sky, nowMs);
  if (sky.length < 2) return null;
  const m = metricsOver(loc, sky, nowMs);
  return m ? { ymd, part, ...m } : null;
}

export const rainShare = (d) => (V(d?.water) > 0 ? V(d.rain) / V(d.water) : 0);
export const isDry = (d) => !!d && V(d.water) < BEST.dryIn;
export const isSnowing = (d) => !!d && !isDry(d) && rainShare(d) < BEST.rainShareMax;
// 2 dry, 1 snowing, null raining (never Best).
export const dayScore = (d) => (!d ? null : isDry(d) ? 2 : isSnowing(d) ? 1 : null);
export const score = (d) => { const s = dayScore(d); return s == null ? null : s + V(d.clear); };

// Activity profiles: the tiebreak after class and sun. Ski and Hike today; camping is next after v3 (Scott, 2026-11-06).
// A day with no gust number sorts as the windiest, never the calmest.
const gustOr = (d) => (d?.gust ? d.gust.value : Infinity);
const calmer = (a, b) => { const x = gustOr(a), y = gustOr(b); return x === y ? 0 : x < y ? -1 : 1; };
export const ACTIVITY = {
  ski: { tie: (a, b) => V(b.fresh) - V(a.fresh) || calmer(a, b) },
  hike: { tie: (a, b) => calmer(a, b) },
};
export function activity(mode) {
  const a = ACTIVITY[mode];
  if (!a) throw new Error(`unknown activity: ${mode}`);
  return a;
}

// entries: [{ id, m, offset, closed }]. Scored entries only. Dry beats snowing first, then sun, then the activity's tiebreak,
// then the sooner day. closed: the place-day's weather window never opens (window.js open: false, inside the window's
// days); it never ranks (architect ruling, 2026-11-06), so Best and "no window" never show together.
export function rank(entries, mode, k = 3) {
  const tie = activity(mode).tie;
  return entries.filter((e) => !e.closed && score(e.m) != null)
    .sort((a, b) => dayScore(b.m) - dayScore(a.m) || V(b.m.clear) - V(a.m.clear) || tie(a.m, b.m) || a.offset - b.offset)
    .slice(0, k);
}

// Day 4 and later, when the models split on water or snow. d: a dayMetrics result.
export function earlyLook(d, offset) {
  if (!d || offset < BEST.earlyOffset) return false;
  const w = d.water, s = d.snowIn;
  return (!!w && w.max - w.min >= BEST.earlyWaterIn && w.max >= BEST.earlyWaterTop) || (!!s && s.max - s.min >= BEST.earlySnowIn);
}

// Why the winner won, in the page's words. win: the winner's metrics; all: every candidate day's metrics.
export function bestWhy(win, all) {
  const scored = all.filter((m) => score(m) != null);
  if (scored.length === 1) return isDry(win) || V(win.rain) === 0 ? "The only day without rain" : "The only day with more snow than rain";
  if (isDry(win)) return scored.every((m) => V(win.water) <= V(m.water)) ? "The driest day" : "The sunniest dry day";
  return V(win.rain) === 0 ? "Snowing, no rain" : "Mostly snow";
}

// One area's Best day. days: [{ ymd, offset, m, early, closed }] in day order. Tomorrow on, early looks and closed days
// (the window never opens) skipped. { ymd, offset, why } or { none: true } when every candidate day rains.
export function areaBest(days, mode) {
  const cands = days.filter((d) => d.offset >= 1 && !d.early && !d.closed && d.m);
  const top = rank(cands.map((d) => ({ id: d.ymd, m: d.m, offset: d.offset })), mode, 1)[0];
  if (!top) return { none: true };
  return { ymd: top.id, offset: top.offset, why: bestWhy(top.m, cands.map((d) => d.m)) };
}

// Good (round 8, Scott 2026-11-06: "good better best... when showing the week"): the other days in an area's week that
// would also qualify for Best: tomorrow on, not an early look, dry or snowing (dayScore not null). [] when the week has no
// Best. Page only on an area's week, never on the landing (most days have some dry area somewhere).
// Inside the window's days (d.w set), Good also needs an open stretch of GOOD.minOpenHours or more (Scott, 2026-11-07,
// copy pass: a day open only 8 to 11 AM between heavy snow, gusts and rain is not Good). Past them, d.w is null and the
// 8 AM to 5 PM numbers decide alone.
export const GOOD = { minOpenHours: 5 };
export function longestOpen(w) {
  if (!w || !w.hours) return 0;
  let best = 0, run = 0, prev = null;
  for (const x of w.hours) {
    run = x.open ? (prev && prev.open && x.h === prev.h + 1 ? run + 1 : 1) : 0;
    if (run > best) best = run;
    prev = x;
  }
  return best;
}
export function goodDays(days, mode) {
  const b = areaBest(days, mode);
  if (b.none) return [];
  return days.filter((d) => d.offset >= 1 && !d.early && !d.closed && d.m && d.ymd !== b.ymd && dayScore(d.m) != null
    && (!d.w || longestOpen(d.w) >= GOOD.minOpenHours)).map((d) => d.ymd);
}

// Not looking good (round 10) for a day past the weather window's days, from its 8 AM to 5 PM numbers (the mock's rule):
// rain (never Best), heavy snow (9 in or more over the 9 hours, about 1 in an hour), gusts of 30 mph or more.
// Days inside the window's days use window.js dayFlags instead.
export const FLAG = { heavySnowIn: 9, gustMph: 30 };
export function metricFlags(d) {
  if (!d) return [];
  const out = [];
  if (dayScore(d) == null) out.push("rain");
  if (V(d.snowIn) >= FLAG.heavySnowIn) out.push("heavy snow");
  if (V(d.gust) >= FLAG.gustMph) out.push(`gusts to ${Math.round(V(d.gust))} mph`);
  return out;
}

// The Best day across areas. byDay: [{ ymd, offset, entries: [{ id, m, early }] }] in day order. A day is an early look when
// 40% or more of its areas are; an area that is an early look that day never ranks, the same as in areaBest.
// The day with the best class wins (mean of its top 3: dry 2, snowing 1), then the sunnier (mean clear share), then the
// sooner day. Class first, so a sunny snowing day never ties a cloudy dry one (Plan 1 re-review). null when nothing scores.
// A day is an early look when 40% or more of its entries are (each entry's early: earlyLook on its own numbers).
export const dayIsEarly = (entries) => entries.length > 0 && entries.filter((e) => e.early).length / entries.length >= BEST.earlyShare;

export function slotBest(byDay, mode) {
  let best = null;
  for (const d of byDay) {
    if (d.offset < 1 || !d.entries.length) continue;
    if (dayIsEarly(d.entries)) continue;
    const top = rank(d.entries.filter((e) => !e.early).map((e) => ({ ...e, offset: d.offset })), mode);
    if (!top.length) continue;
    const cls = top.reduce((a, e) => a + dayScore(e.m), 0) / top.length;
    const sun = top.reduce((a, e) => a + V(e.m.clear), 0) / top.length;
    if (!best || cls > best.cls || (cls === best.cls && sun > best.sun)) best = { ymd: d.ymd, offset: d.offset, top, cls, sun, v: cls + sun };
  }
  return best;
}

// Tags on any day, Best or not.
export const isPowder = (d) => !!d && V(d.fresh) >= BEST.powderIn && rainShare(d) < BEST.rainShareMax;
export const isBluebird = (d) => !!d && V(d.clear) >= BEST.bluebirdClear && isDry(d) && V(d.fresh) >= BEST.bluebirdFreshIn;
export const skiTags = (d) => [isPowder(d) && "Powder", isBluebird(d) && "Bluebird"].filter(Boolean);
// Hike: the snow line estimate sits at or below the area's high point. The page writes "Snow on trail above ~X ft, est."
export const snowOnTrail = (lineFt, highFt) => fin(lineFt) && fin(highFt) && highFt >= lineFt;

// The day's icon reads the same daytime hours as Best, so a Best day never shows evening rain (the Rainier fix, 2026-11-06).
export function skyKey(d) {
  if (!d) return null;
  const w = V(d.water);
  if (w >= BEST.dryIn) { const sh = V(d.snowW) / w; return sh >= 0.8 ? "snow" : sh <= 0.2 ? "rain" : "mixed"; }
  const c = V(d.clear);
  return c >= 0.7 ? "sun" : c >= 0.35 ? "partly" : "cloudy";
}
