// page/engine/forecast.js
// Windows, day summaries and mini bars. Headline = NBM when it covers the span, else the median.
import { slr } from "../engine.js";
import { NBM, SHORT, MEDIUM } from "./models.js";

export function localHourString(nowMs, utcOffset) {
  return new Date(nowMs + utcOffset * 1000).toISOString().slice(0, 13) + ":00";
}

export function nowIndex(loc, nowMs = Date.now()) {
  return loc.time.indexOf(localHourString(nowMs, loc.utcOffset));
}

export function median(xs) {
  const a = [...xs].sort((x, y) => x - y);
  const n = a.length;
  if (!n) return null;
  return n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2;
}

export function headline(byModel) {
  const ms = Object.keys(byModel);
  if (!ms.length) return null;
  const vals = ms.map((m) => byModel[m]);
  const hasNbm = Object.prototype.hasOwnProperty.call(byModel, NBM);
  return { value: hasNbm ? byModel[NBM] : median(vals), min: Math.min(...vals), max: Math.max(...vals), n: ms.length, source: hasNbm ? "NBM" : "median", byModel: { ...byModel } };
}

function covers(arr, idx) {
  return !!arr && idx.length > 0 && idx.every((i) => arr[i] != null);
}

export function windowIdx(loc, nowIdx, hours) {
  if (nowIdx < 0) return [];
  const out = [];
  for (let i = nowIdx + 1; i <= nowIdx + hours && i < loc.time.length; i++) out.push(i);
  return out.length === hours ? out : [];
}

function snowOver(loc, m, idx) {
  const T = loc.series.temperature_2m?.[m], P = loc.series.precipitation?.[m];
  if (!covers(T, idx) || !covers(P, idx)) return null;
  let s = 0;
  for (const i of idx) {
    if (P[i] <= 0) continue;
    const r = slr(T[i]);
    if (r != null) s += P[i] * r;
  }
  return s;
}

function waterOver(loc, m, idx) {
  const P = loc.series.precipitation?.[m];
  if (!covers(P, idx)) return null;
  return idx.reduce((a, i) => a + P[i], 0);
}

export function windowTotals(loc, nowIdx, hours, models = SHORT) {
  const idx = windowIdx(loc, nowIdx, hours);
  const snow = {}, water = {};
  for (const m of models) {
    const s = snowOver(loc, m, idx), w = waterOver(loc, m, idx);
    if (s != null && w != null) { snow[m] = s; water[m] = w; }
  }
  return { hours, snow: headline(snow), water: headline(water) };
}

export function condition(water, snow, cloudyFrac) {
  if (snow >= 0.5) return "snow";
  if (water >= 0.05) return "wet";
  if (cloudyFrac != null && cloudyFrac >= 0.5) return "cloudy";
  return "dry";
}

export function addDays(ymd, n) {
  const d = new Date(ymd + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daySummary(loc, ymd, dayOffset, fromIdx = -1) {
  const all = [];
  loc.time.forEach((t, i) => { if (t.startsWith(ymd) && i > fromIdx) all.push(i); });
  if (!all.length) return null;
  const nextYmd = addDays(ymd, 1);
  // Accumulations are hour-ending: the hours that end inside the day are 01:00 through the next day's 00:00.
  const acc = [];
  loc.time.forEach((t, i) => { if (i <= fromIdx) return; if ((t.startsWith(ymd) && t.slice(11, 13) !== "00") || t === `${nextYmd}T00:00`) acc.push(i); });
  const daylight = all.filter((i) => { const h = +loc.time[i].slice(11, 13); return h >= 8 && h <= 17; });
  const models = dayOffset <= 1 ? SHORT : MEDIUM;
  const hi = {}, lo = {}, water = {}, snow = {}, dWater = {}, gust = {}, cloudy = {};
  for (const m of models) {
    const T = loc.series.temperature_2m?.[m];
    if (!covers(T, all)) continue;
    hi[m] = Math.max(...all.map((i) => T[i]));
    lo[m] = Math.min(...all.map((i) => T[i]));
    const w = acc.length ? waterOver(loc, m, acc) : null, s = acc.length ? snowOver(loc, m, acc) : null;
    if (w != null && s != null) { water[m] = w; snow[m] = s; }
    if (daylight.length) {
      const dw = waterOver(loc, m, daylight);
      if (dw != null) dWater[m] = dw;
    }
    const G = loc.series.wind_gusts_10m?.[m];
    if (covers(G, all)) gust[m] = Math.max(...all.map((i) => G[i]));
    const C = loc.series.weather_code?.[m];
    if (daylight.length && covers(C, daylight)) cloudy[m] = daylight.filter((i) => C[i] >= 3).length / daylight.length;
  }
  const H = headline(hi);
  if (!H) return null;
  const W = headline(water), S = headline(snow), CF = headline(cloudy);
  return {
    ymd, hi: H, lo: headline(lo), water: W, snow: S, daylightWater: headline(dWater), gust: headline(gust), cloudyFrac: CF,
    condition: condition(W?.value ?? 0, S?.value ?? 0, CF?.value ?? null),
  };
}

export function miniBars(loc, nowIdx, days = 7) {
  if (nowIdx < 0) return [];
  const ymd0 = loc.time[nowIdx].slice(0, 10);
  const out = [];
  for (let d = 0; d < days; d++) {
    const ymd = addDays(ymd0, d);
    const s = daySummary(loc, ymd, d, d === 0 ? nowIdx : -1);
    out.push(s && s.snow ? { ymd, snow: s.snow.value, condition: s.condition } : { ymd, snow: null, condition: null });
  }
  return out;
}

export function next24(loc, nowIdx) {
  if (nowIdx < 0) return null;
  const idx = windowIdx(loc, nowIdx, 24);
  if (!idx.length) return null;
  const hi = {}, lo = {}, gu = {};
  for (const m of SHORT) {
    const T = loc.series.temperature_2m?.[m];
    if (covers(T, idx)) {
      hi[m] = Math.max(...idx.map((i) => T[i]));
      lo[m] = Math.min(...idx.map((i) => T[i]));
    }
    const G = loc.series.wind_gusts_10m?.[m];
    if (covers(G, idx)) gu[m] = Math.max(...idx.map((i) => G[i]));
  }
  const H = headline(hi), L = headline(lo);
  if (!H) return null;
  const tot = windowTotals(loc, nowIdx, 24);
  const snow = tot.snow?.value ?? 0, water = tot.water?.value ?? 0;
  const precip = snow >= 0.5 ? { type: "snow", ...tot.snow } : water >= 0.05 ? { type: "rain", ...tot.water } : { type: "dry" };
  return { lo: L.value, hi: H.value, gust: headline(gu), precip };
}
