// page/engine/periods.js
// Forecast by elevation: AM, PM and night periods at one point. Open-Meteo's elevation setting moves temperature only,
// so wind above the 850 hPa height comes from pressure levels.
import { slr } from "../engine.js";
import { SHORT, MEDIUM, HRRR, GFS, ICON, FREEZE_SHORT, FREEZE_LONG, WIND_LEVELS } from "./models.js";
import { addDays, condition, headline, median, nowIndex } from "./forecast.js";
import { feetFactor } from "./clouds.js";

const SPANS = [["AM", 6, 6], ["PM", 12, 6], ["Night", 18, 12]];
const LOW_WIND_FT = 5000;   // used only when aloft data is missing: above this, 10 m wind describes the model's smoothed ground, not the point
const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const fin = (x) => typeof x === "number" && Number.isFinite(x);
const full = (arr, idx) => !!arr && idx.length > 0 && idx.every((i) => fin(arr[i]));
const compass = (deg) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
const stamp = (ymd, hour) => new Date(Date.parse(`${ymd}T00:00:00Z`) + hour * 3600e3).toISOString().slice(0, 16);

// Periods still ahead. The running one keeps its remaining hours and needs at least 2.
export function periodList(loc, nowMs, days = 5) {
  const n = nowIndex(loc, nowMs);
  if (n < 0) return [];
  const byTime = new Map(loc.time.map((t, i) => [t, i]));
  const ymd0 = loc.time[n].slice(0, 10), out = [];
  for (let d = -1; d < days; d++) {
    const ymd = addDays(ymd0, d);
    for (const [part, start, len] of SPANS) {
      const idx = [];
      for (let h = 0; h < len; h++) {
        const i = byTime.get(stamp(ymd, start + h));
        if (i != null && i > n && i + 1 < loc.time.length) idx.push(i);
      }
      if (idx.length >= 2 && (idx.length === len || idx[0] === n + 1)) out.push({ ymd, part, idx });
    }
  }
  return out;
}

export function windAtHeight(levels, ft) {
  if (levels.length < 2 || ft < levels[0].h) return null;
  const top = levels[levels.length - 1];
  if (ft >= top.h) return { s: top.s, d: top.d };
  const j = levels.findIndex((l) => l.h > ft), a = levels[j - 1], b = levels[j];
  const w = (ft - a.h) / (b.h - a.h);
  return { s: a.s + (b.s - a.s) * w, d: w < 0.5 ? a.d : b.d };
}

function levelsAt(a, m, i, f) {
  return WIND_LEVELS.map((p) => ({
    h: a.series[`geopotential_height_${p}hPa`]?.[m]?.[i] * f,
    s: a.series[`wind_speed_${p}hPa`]?.[m]?.[i],
    d: a.series[`wind_direction_${p}hPa`]?.[m]?.[i],
  })).filter((l) => fin(l.h) && fin(l.s) && fin(l.d));
}

// Three outcomes: { mph, dir, from: "aloft" } when a model covers the point, { below: true } when aloft loaded but the
// point sits under the lowest level height in some hour, and null when no aloft data is usable at all.
function aloftWind(loc, aloft, idx, ft) {
  const f = aloft ? feetFactor(aloft, "geopotential_height_850hPa") : null;
  if (f == null) return null;
  const byTime = new Map(aloft.time.map((t, i) => [t, i]));
  const best = {};
  let usable = false, below = false;
  for (const m of [HRRR, GFS, ICON]) {
    let top = null;
    for (const i of idx) {
      const j = byTime.get(loc.time[i]);
      const levels = j == null ? [] : levelsAt(aloft, m, j, f);
      if (levels.length >= 2) {
        usable = true;
        if (ft < levels[0].h) below = true;
      }
      const w = windAtHeight(levels, ft);
      if (!w) { top = null; break; }
      if (!top || w.s > top.s) top = w;
    }
    if (top) best[m] = top;
  }
  if (best[HRRR]) delete best[GFS];   // GFS is HRRR early on; never both
  const ms = Object.keys(best);
  if (!ms.length) return usable && below ? { below: true } : null;
  const H = headline(Object.fromEntries(ms.map((m) => [m, best[m].s])));
  return { mph: H.value, dir: compass(best[ms[0]].d), from: "aloft" };
}

function surfaceWind(loc, idx, models) {
  const by = {};
  let dir = null;
  for (const m of models) {
    const S = loc.series.wind_speed_10m?.[m], D = loc.series.wind_direction_10m?.[m];
    if (!full(S, idx)) continue;
    by[m] = Math.max(...idx.map((i) => S[i]));
    if (dir == null && full(D, idx)) dir = D[idx.reduce((b, i) => (S[i] > S[b] ? i : b), idx[0])];
  }
  const H = headline(by);
  return H && dir != null ? { mph: H.value, dir: compass(dir), from: "surface" } : null;
}

function freezeOver(loc, cl, idx, models) {
  const f = cl ? feetFactor(cl, "freezing_level_height") : null;
  if (f == null) return null;
  const byTime = new Map(cl.time.map((t, i) => [t, i]));
  const vals = [];
  for (const m of models) {
    const F = cl.series.freezing_level_height?.[m];
    const hrs = idx.map((i) => F?.[byTime.get(loc.time[i])]).filter(fin);
    if (hrs.length === idx.length) vals.push(median(hrs) * f);
  }
  return vals.length ? Math.round(median(vals) / 100) * 100 : null;
}

export function periodRows(loc, cloudLoc, aloftLoc, ft, nowMs, days = 5) {
  const n = nowIndex(loc, nowMs);
  return periodList(loc, nowMs, days).map(({ ymd, part, idx }) => {
    const near = idx[idx.length - 1] - n <= 48;
    const models = near ? SHORT : MEDIUM;
    const acc = idx.map((i) => i + 1);   // accumulations are hour-ending
    const hi = {}, lo = {}, snow = {}, rain = {}, water = {}, gust = {}, cloudy = {};
    for (const m of models) {
      const T = loc.series.temperature_2m?.[m], P = loc.series.precipitation?.[m];
      if (!full(T, idx)) continue;
      hi[m] = Math.max(...idx.map((i) => T[i]));
      lo[m] = Math.min(...idx.map((i) => T[i]));
      if (full(T, acc) && full(P, acc)) {
        let s = 0, r = 0, w = 0;
        for (const i of acc) {
          const ratio = slr(T[i]);
          w += P[i];
          if (ratio == null) r += P[i]; else s += P[i] * ratio;
        }
        snow[m] = s; rain[m] = r; water[m] = w;
      }
      const G = loc.series.wind_gusts_10m?.[m];
      if (full(G, idx)) gust[m] = Math.max(...idx.map((i) => G[i]));
      const C = loc.series.weather_code?.[m];
      if (full(C, idx)) cloudy[m] = idx.filter((i) => C[i] >= 3).length / idx.length;
    }
    const H = headline(hi), W = headline(water), S = headline(snow), R = headline(rain), CF = headline(cloudy);
    const a = aloftWind(loc, aloftLoc, idx, ft);
    const wind = a?.from ? a : (a?.below || ft < LOW_WIND_FT) ? surfaceWind(loc, idx, models) : null;
    return {
      ymd, part, cond: H ? condition(W?.value ?? 0, S?.value ?? 0, CF?.value ?? null) : null,
      hi: H?.value ?? null, lo: headline(lo)?.value ?? null, snow: S?.value ?? null, rain: R?.value ?? null,
      gust: wind?.from === "surface" ? (headline(gust)?.value ?? null) : null, wind, freezeFt: freezeOver(loc, cloudLoc, idx, near ? FREEZE_SHORT : FREEZE_LONG),
    };
  });
}
