// page/engine/clouds.js
// Cloud verdict per half-day and snow level. Only claims what the pressure levels support.
import { LEVELS, LABEL, CLOUD_SHORT, CLOUD_LONG } from "./models.js";
import { median } from "./forecast.js";

const FT = 3.28084;
export function feetFactor(loc, v) {
  const u = loc.units?.[v];
  if (u === "ft") return 1;
  if (u === "m") return FT;
  return null;   // unknown unit: refuse rather than guess
}
const r100 = (x) => Math.round(x / 100) * 100;
const fmt = (x) => r100(x).toLocaleString("en-US");

export function halfDayIdx(loc, ymd, half) {
  const out = [];
  loc.time.forEach((t, i) => {
    if (!t.startsWith(ymd)) return;
    const h = +t.slice(11, 13);
    if (half === "AM" ? h >= 8 && h <= 11 : h >= 12 && h <= 17) out.push(i);
  });
  return out;
}

function avg(arr, idx) {
  if (!arr || !idx.length || !idx.every((i) => arr[i] != null)) return null;
  return idx.reduce((a, i) => a + arr[i], 0) / idx.length;
}

export function modelColumn(loc, model, idx) {
  const low = avg(loc.series.cloud_cover_low?.[model], idx);
  const high = avg(loc.series.cloud_cover_high?.[model], idx);
  const levels = [];
  for (const p of LEVELS) {
    const f = feetFactor(loc, `geopotential_height_${p}hPa`);
    if (f == null) return null;
    const c = avg(loc.series[`cloud_cover_${p}hPa`]?.[model], idx);
    const z = avg(loc.series[`geopotential_height_${p}hPa`]?.[model], idx);
    if (c != null && z != null) levels.push({ hPa: p, ft: z * f, cover: c });
  }
  levels.sort((a, b) => a.ft - b.ft);
  if (low == null || levels.length !== LEVELS.length) return null;
  return { low, high, levels };
}

function layersOf(L) {
  const out = [];
  let cur = null;
  L.forEach((lv, i) => {
    if (lv.cover >= 50) { if (!cur) cur = { from: i, to: i }; else cur.to = i; }
    else if (cur) { out.push(cur); cur = null; }
  });
  if (cur) out.push(cur);
  return out.map((ly) => {
    const top = L[ly.to], next = L[ly.to + 1];
    return {
      ...ly,
      baseFt: L[ly.from].ft,
      topFt: next ? top.ft + (next.ft - top.ft) / 2 : Infinity,
      baseText: ly.from === 0 ? `at or below ${fmt(L[0].ft)} ft` : `between ${fmt(L[ly.from - 1].ft)} and ${fmt(L[ly.from].ft)} ft`,
      topText: next ? `between ${fmt(top.ft)} and ${fmt(next.ft)} ft` : `above ${fmt(top.ft)} ft`,
    };
  });
}

export function verdictFor(col, summitFt) {
  const L = col.levels;
  const layers = layersOf(L);
  const highCloud = col.high != null && col.high >= 50;
  const hc = (t) => (highCloud ? `${t} · high cloud` : t);
  const describe = (ly) => (ly ? { baseText: ly.baseText, topText: ly.topText } : null);
  if (summitFt < L[0].ft) {
    if (col.low >= 60) return { key: "in", text: "in low cloud", highCloud, layer: null };
    if (layers.length) return { key: "under", text: `cloud above you, base ${layers[0].baseText}`, highCloud, layer: describe(layers[0]) };
    return { key: "clear", text: hc("clear"), highCloud, layer: null };
  }
  const inside = layers.find((ly) => summitFt >= ly.baseFt && summitFt <= ly.topFt);
  if (inside) return { key: "in", text: `in cloud, tops ${inside.topText}`, highCloud, layer: describe(inside) };
  const below = layers.filter((ly) => ly.topFt < summitFt);
  const above = layers.filter((ly) => ly.baseFt > summitFt);
  if (!above.length && below.length) {
    const ly = below[below.length - 1];
    return { key: "above", text: hc(`above the clouds, tops ${ly.topText}`), highCloud, layer: describe(ly) };
  }
  if (!layers.length && col.low >= 60) return { key: "low_below", text: hc("low cloud below you"), highCloud, layer: null };
  if (above.length && !below.length) return { key: "under", text: `cloud above you, base ${above[0].baseText}`, highCloud, layer: describe(above[0]) };
  if (above.length && below.length) return { key: "between", text: "between cloud layers", highCloud, layer: describe(above[0]) };
  return { key: "clear", text: hc("clear"), highCloud, layer: null };
}

export function cloudVerdict(loc, ymd, half, summitFt, dayOffset) {
  const idx = halfDayIdx(loc, ymd, half);
  if (!idx.length) return null;
  const order = dayOffset <= 1 ? CLOUD_SHORT : CLOUD_LONG;
  let cols = order.map((m) => ({ m, c: modelColumn(loc, m, idx) })).filter((x) => x.c);
  if (!cols.length && dayOffset <= 1) cols = CLOUD_LONG.map((m) => ({ m, c: modelColumn(loc, m, idx) })).filter((x) => x.c);
  if (!cols.length) return null;
  const parts = cols.map(({ m, c }) => ({ model: LABEL[m], ...verdictFor(c, summitFt) }));
  if (parts.every((p) => p.key === parts[0].key && p.text === parts[0].text)) {
    return { split: false, key: parts[0].key, text: parts[0].text, models: parts.map((p) => p.model) };
  }
  return { split: true, parts: parts.map(({ model, key, text }) => ({ model, key, text })) };
}

export function snowLevel(loc, idx, models, minPointFt) {
  const f = feetFactor(loc, "freezing_level_height");
  if (f == null) return null;
  const vals = [], used = [];
  for (const m of models) {
    const F = loc.series.freezing_level_height?.[m], P = loc.series.precipitation?.[m];
    if (!F || !P) continue;
    const wet = idx.filter((i) => P[i] != null && P[i] >= 0.01 && F[i] != null);
    if (!wet.length) continue;
    vals.push(median(wet.map((i) => F[i] * f)) - 1000);
    used.push(LABEL[m]);
  }
  if (!vals.length) return null;
  const lo = Math.min(...vals), hi = Math.max(...vals);
  if (hi < minPointFt) return { kind: "valley", models: used };
  if (hi - lo <= 500) return { kind: "single", ft: r100((lo + hi) / 2), models: used };
  return { kind: "range", lo: r100(lo), hi: r100(hi), models: used };
}
