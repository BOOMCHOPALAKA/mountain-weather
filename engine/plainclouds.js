// page/engine/plainclouds.js
// Clouds in plain words, per half day (AM 8 to 11, PM noon to 5) for the next four halves after now, at an area's high
// point (mock round 4, 2026-11-05). HRRR for today and tomorrow (HRDPS checked for agreement), GFS after. A layer = consecutive
// pressure levels at 50% cover or more; low cloud 60% or more below the 850 hPa level counts as a layer from the valley.
// Heights rounded to 500 ft. Ported from mock/v3/snapshot.mjs (layerOf, plainClouds) and mock/v3/index.html (cloudSentence).
// Build rule (Design Direction, round 4): a spot with rain or snow in the half day is never described as in the clear.
import { HRRR, HRDPS, GFS } from "./models.js";
import { addDays, headline, nowIndex } from "./forecast.js";
import { modelColumn } from "./clouds.js";
import { modelSet } from "./best.js";

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const dow = (ymd) => DOW[new Date(`${ymd}T12:00:00Z`).getUTCDay()];
const fin = (x) => typeof x === "number" && Number.isFinite(x);
const r500dn = (x) => Math.floor(x / 500) * 500, r500up = (x) => Math.ceil(x / 500) * 500;
const fmt = (x) => Math.round(x).toLocaleString("en-US");
export const HALF = { AM: [8, 11], PM: [12, 17] };
export const WET_IN = 0.01;

export function layerOf(col) {
  const L = col.levels;
  const runs = [];
  let cur = null;
  L.forEach((lv, i) => { if (lv.cover >= 50) { if (!cur) cur = { a: i, b: i }; else cur.b = i; } else if (cur) { runs.push(cur); cur = null; } });
  if (cur) runs.push(cur);
  const lay = runs.map((r) => ({ base: L[r.a].ft, top: r.b + 1 < L.length ? (L[r.b].ft + L[r.b + 1].ft) / 2 : null }));
  if (col.low >= 60) {
    if (lay.length && runs[0].a === 0) lay[0].base = null;
    else lay.unshift({ base: null, top: L[0].ft });
  }
  return lay;
}

// Rain or snow at a point in the half day's hours: the headline water (NBM, else the median) of the models that speak
// for those hours, hour-ending like everywhere else. false when the loc has no data there.
export function wetIn(loc, ymd, half, nowMs) {
  if (!loc) return false;
  const [a, b] = HALF[half];
  const idx = loc.time.map((t, i) => [t, i]).filter(([t]) => t.startsWith(ymd) && +t.slice(11, 13) >= a && +t.slice(11, 13) <= b).map(([, i]) => i);
  const w = {};
  for (const m of modelSet(loc, idx, nowMs)) {
    const P = loc.series.precipitation?.[m];
    if (idx.every((i) => fin(P?.[i + 1]))) w[m] = idx.reduce((s, i) => s + P[i + 1], 0);
  }
  const h = headline(w);
  return !!h && h.value >= WET_IN;
}

// cl: the clouds loc at the high point. pts: [{ name, ft, loc }] high point first, then the trailhead or base (optional);
// loc is that point's glance or detail loc for the wet rule. Up to four halves, or null when cl has no now.
export function plainClouds(cl, pts, nowMs) {
  if (!cl || !Array.isArray(cl.time)) return null;
  const n = nowIndex(cl, nowMs);
  if (n < 0) return null;
  const ymd0 = cl.time[n].slice(0, 10), hour = +cl.time[n].slice(11, 13);
  const halves = [];
  for (let d = 0; d < 3 && halves.length < 4; d++) for (const h of ["AM", "PM"]) {
    if (d === 0 && hour >= HALF[h][1]) continue;
    if (halves.length < 4) halves.push({ d, h, ymd: addDays(ymd0, d) });
  }
  const idxOf = (ymd, h) => cl.time.map((t, i) => [t, i]).filter(([t]) => t.startsWith(ymd) && +t.slice(11, 13) >= HALF[h][0] && +t.slice(11, 13) <= HALF[h][1]).map(([, i]) => i);
  const relOf = (ly, ft) => (!ly ? "clear" : ly.top != null && ft > ly.top ? "above" : ly.base != null && ft < ly.base ? "below" : "in");
  const high = pts[0];
  return halves.map(({ d, h, ymd }) => {
    const idx = idxOf(ymd, h);
    const models = d <= 1 ? [HRRR, HRDPS] : [GFS];
    const cols = models.map((m) => ({ m, c: modelColumn(cl, m, idx) })).filter((x) => x.c);
    if (!cols.length) return null;
    const main = cols[0], lays = layerOf(main.c);
    // the layer nearest the high point: the one it sits in, else the highest one below it, else the lowest above
    const near = (ls) => ls.find((l) => relOf(l, high.ft) === "in") || [...ls].reverse().find((l) => l.top != null && l.top < high.ft) || ls[0] || null;
    const ly = near(lays);
    const other = cols[1] ? layerOf(cols[1].c) : null;
    const oly = other ? near(other) : null;
    const out = pts.filter(Boolean).map((p) => {
      const rel = relOf(ly, p.ft);
      return { name: p.name, ft: p.ft, rel: rel === "clear" && wetIn(p.loc, ymd, h, nowMs) ? "wet" : rel };
    });
    return {
      label: `${d === 0 ? "Today" : dow(ymd)} ${h === "AM" ? "morning" : "afternoon"}`, ymd, half: h,
      model: main.m === HRRR ? "HRRR" : main.m === HRDPS ? "HRDPS" : "GFS",
      base: ly?.base == null ? null : r500dn(ly.base), top: ly?.top == null ? null : r500up(ly.top), lowDeck: !!ly && ly.base == null,
      more: lays.length > 1, high: (main.c.high ?? 0) >= 50, topLevelFt: r500dn(main.c.levels[main.c.levels.length - 1].ft),
      differ: !!other && relOf(oly, high.ft) !== relOf(ly, high.ft),
      otherModel: cols[1] ? (cols[1].m === HRDPS ? "HRDPS" : "GFS") : null, otherRel: other ? relOf(oly, high.ft) : null,
      pts: out,
    };
  }).filter(Boolean);
}

const REL = { in: "in cloud", above: "above it", below: "below it", clear: "clear", wet: "in rain or snow" };
const OTHER = { in: "in cloud", above: "above the cloud", below: "under a cloud layer", clear: "in the clear" };
// The sentence for one half day (mock cloudSentence), with the wet rule: a wet point is never "in the clear", and the
// layer never reads "clear up to" when a point in it is wet.
export function cloudSentence(c) {
  const [A, B] = c.pts;
  const anyWet = c.pts.some((p) => p.rel === "wet");
  let lay;
  if (c.base == null && c.top == null && !c.lowDeck) lay = c.high ? "high cloud only" : anyWet ? "no cloud layer the models can place" : `clear up to about ${fmt(c.topLevelFt)} ft`;
  else if (c.lowDeck) lay = c.top == null ? "cloud from the valley up past the summits" : `low cloud up to about ${fmt(c.top)} ft`;
  else lay = c.top == null ? `clouds from about ${fmt(c.base)} ft up` : `clouds from about ${fmt(c.base)} to ${fmt(c.top)} ft`;
  if (c.more) lay += ", more cloud above";
  if (c.high && (c.base != null || c.lowDeck)) lay += ", high cloud too";
  let pts;
  if (!B) pts = `${A.name} ${REL[A.rel]}`;
  else if (A.rel === B.rel) pts = A.rel === "clear" ? `${A.name} and ${B.name} in the clear` : A.rel === "in" ? `${A.name} and ${B.name} both in cloud` : `${A.name} and ${B.name} both ${REL[A.rel]}`;
  else pts = `${A.name} ${REL[A.rel]}, ${B.name} ${REL[B.rel]}`;
  const differ = c.differ ? ` Models differ: ${c.otherModel} puts ${A.name} ${OTHER[c.otherRel] || c.otherRel}.` : "";
  return `${c.label}: ${lay}. ${pts}.${differ}`;
}
