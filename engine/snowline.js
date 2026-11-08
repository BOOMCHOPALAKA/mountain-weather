// page/engine/snowline.js
// The hike snow line: an estimate from one SNOTEL station and the forecast snow level (mock round 4, 2026-11-05). Always
// "likely" and "est.", never "snow-free". Ported from mock/v3/snapshot.mjs snowLineFor and made pure: the caller passes
// the station's depth reading (vm.depthReading) and a freezing-level loc that carries precipitation (vm.withPrecip).
//   depth 1 in or more: snow on trail likely above about the station's elevation, rounded down to 500 ft.
//   depth under 1 in: likely above the higher of (station + 500 ft) and the snow level, rounded up to 500 ft.
//   drop: when the next 48 h snow level is 500 ft or more below that line, the line may drop to it.
//   not known: the station is bare, sits more than 1,500 ft below the high point, and the line lands above the high point.
import { HRRR, ICON, FREEZE_SHORT } from "./models.js";
import { nowIndex } from "./forecast.js";
import { snowLevel, feetFactor } from "./clouds.js";
import { snowOnTrail } from "./best.js";

const fin = (x) => typeof x === "number" && Number.isFinite(x);
const r500dn = (x) => Math.floor(x / 500) * 500, r500up = (x) => Math.ceil(x / 500) * 500;
const ft = (x) => Math.round(x).toLocaleString("en-US");

// station: { name, elev_ft, mi }. highFt: the area's high point. dep: { depth, asOf } or null. cl: a loc with
// freezing_level_height and precipitation, or null. null when there is no station or no high point.
export function snowLine(station, highFt, dep, cl, nowMs) {
  if (!station || !fin(highFt)) return null;
  let sl = null, from = null;
  const n = cl && Array.isArray(cl.time) ? nowIndex(cl, nowMs) : -1;
  if (n >= 0) {
    const idx = Array.from({ length: 48 }, (_, k) => n + 1 + k).filter((i) => i < cl.time.length);
    const lv = snowLevel(cl, idx, FREEZE_SHORT, 0);
    if (lv?.kind === "single") { sl = lv.ft; from = "snow level, next 48 h"; }
    else if (lv?.kind === "range") { sl = Math.round((lv.lo + lv.hi) / 2); from = `snow level, next 48 h (models ${ft(lv.lo)} to ${ft(lv.hi)} ft)`; }
    else if (lv?.kind === "valley") { sl = 0; from = "snow level, next 48 h (to the valley floor)"; }
    else {
      const f = feetFactor(cl, "freezing_level_height");
      const v = [HRRR, ICON].map((m) => cl.series.freezing_level_height?.[m]?.[n]).filter(fin);
      if (f && v.length) { sl = Math.round((v.reduce((a, b) => a + b, 0) / v.length) * f - 1000); from = "freezing level now minus 1,000 ft (no precipitation in 48 h)"; }
    }
  }
  const base = { station: station.name, stElev: station.elev_ft, mi: station.mi, snowLevel: sl, from, highFt };
  if (!dep) return { ...base, ft: null, depth: null, drop: null };
  const line = dep.depth >= 1 ? r500dn(station.elev_ft) : r500up(Math.max(station.elev_ft + 500, sl ?? 0));
  const drop = sl != null && from?.startsWith("snow level") && sl <= line - 500 ? Math.max(0, r500dn(sl)) : null;
  return { ...base, ft: line, depth: Math.round(dep.depth), asOf: dep.asOf, drop };
}

export const lineUnknown = (L) => !!L && L.ft != null && L.depth < 1 && L.highFt - L.stElev > 1500 && L.highFt < L.ft;
export const lineAbove = (L) => !!L && L.ft != null && snowOnTrail(L.ft, L.highFt);

// The Hike tag on rows, picks and the place view (Scott, 2026-11-06 Q4: "snow on trail", not "snowshoes"). fact is the
// pill; advice goes at the end of the reason line. null when neither applies.
export function snowTag(L) {
  if (lineAbove(L)) return { fact: `Snow on trail above ~${ft(L.ft)} ft, est.`, advice: "Snowshoes and winter skills." };
  if (lineUnknown(L)) return { fact: "Snow up high not known, est.", advice: "Check trip reports." };
  return null;
}
