// page/vm.js
// View-model: places.json + engine outputs -> the data objects the approved mock's render code reads.
// Pure functions. No fetch, no DOM; time comes in as nowMs.
import { NBM, HRRR, HRDPS, GFS, ECMWF, SHORT, LABEL, LEVELS, FREEZE_SHORT, CLOUD_SHORT } from "./engine/models.js";
import { localHourString, nowIndex, headline, windowIdx, windowTotals, daySummary, miniBars, next24, addDays, condition, median } from "./engine/forecast.js";
import { cloudVerdict, snowLevel, modelColumn, verdictFor, feetFactor } from "./engine/clouds.js";
import { modelNow, stationNow, nowReading } from "./engine/now.js";
import { regionNext24, topThree } from "./engine/regions.js";
import { parseMapLayer, parseProduct } from "./engine/avalanche.js";
import { storms, latestHourly } from "./engine/snotel.js";
import { slr, wetness } from "./engine.js";

/* ---------- formatting ---------- */
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const fin = (x) => typeof x === "number" && Number.isFinite(x);
const int = (x) => (fin(x) ? Math.round(x) : null);
const round1 = (x) => (fin(x) ? Math.round(x * 10) / 10 : null);
export const fmtNum = (n) => (fin(n) ? Math.round(n).toLocaleString("en-US") : "–");
export const fmtFt = (n) => (fin(n) ? `${fmtNum(n)} ft` : "–");
export function fmtIn(x) {
  if (!fin(x)) return "–";
  return x > 0 && x < 1 ? "<1" : String(Math.round(x));
}
// Each end follows fmtIn, so 0.6 reads "<1" here and in the row. Both ends under 1 read as the high end alone.
export function rangeText(lo, hi) {
  if (!fin(lo) || !fin(hi)) return "–";
  if (hi < 1) return fmtIn(hi);
  const a = fmtIn(lo), b = fmtIn(hi);
  return a === b ? b : `${a}–${b}`;
}
// One wording for a forecast that failed to load, shared by vm and render.
export const UNAVAILABLE = "Forecast unavailable";
// The line above the cards when the forecast isn't live. glances: the view's glance entries. clock: ms to a display time.
export function forecastNotice(glances, clock) {
  const gs = glances.filter(Boolean);
  if (!gs.length || gs.length < glances.length || gs.some((g) => g.status === "loading")) return null;
  const saved = gs.filter((g) => g.saved), failed = gs.filter((g) => g.status === "error");
  const limit = [...saved, ...failed].find((g) => g.limit)?.limit;
  const hit = `Open-Meteo's free ${limit} limit was reached on this connection`;
  if (saved.length) {
    const from = `Showing the saved forecast from ${clock(Math.min(...saved.map((g) => g.at)))}.`;
    return limit ? `${from} ${hit}, so it can't update yet.` : `${from} The forecast service didn't answer. Tap Refresh to try again.`;
  }
  if (!failed.length) return null;
  if (limit) return `${hit}. Forecasts return when it resets, and Refresh won't help until then.`;
  return failed.length === gs.length ? "Forecasts didn't load. Tap Refresh to try again." : "Some forecasts didn't load. Tap Refresh to try again.";
}
export const fmtWater = (x) => (fin(x) ? x.toFixed(2) : "–");
export const dow = (ymd) => DOW[new Date(`${ymd}T12:00:00Z`).getUTCDay()];
// Display inches for the trio: a number, or "<1" (the mock's render dims 0 and "<1").
const dispIn = (x) => (!fin(x) ? "–" : x > 0 && x < 1 ? "<1" : Math.round(x));
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/* ---------- cloud words (program rule 1) ---------- */
// Verdict pairs use the mock's CSS word; low_below -> "below" (.vd.below). Hike day cells use rule 1's display word.
const WORD = { above: "above", low_below: "below", in: "in", between: "between", under: "under", clear: "clear" };
const DAY_WORD = { above: "above", low_below: "low", in: "in", between: "between", under: "under", clear: "clear" };
const SPLIT_TEXT = { above: "above", low_below: "low cloud below", in: "in cloud", between: "between layers", under: "under cloud", clear: "clear" };
const PHRASE = { above: "Above the clouds", low_below: "Low cloud below", in: "In cloud", between: "Between cloud layers", under: "Under cloud", clear: "Clear" };
const AGREE_TEXT = { above: "above the clouds", low_below: "low cloud below you", in: "in cloud", between: "between cloud layers", under: "cloud above you", clear: "clear" };

export function wordFor(v, labels = {}) {
  if (!v) return ["none", "no cloud data"];
  if (v.split) {
    // The engine also splits when models agree on the word but not the height. Same word: show it, say heights differ.
    if (v.parts.every((p) => p.key === v.parts[0].key)) {
      const w = WORD[v.parts[0].key] || "none";
      // The engine also splits when only the " · high cloud" suffix differs. Name that reason, not height.
      const bases = v.parts.map((p) => String(p.text || "").replace(/ · high cloud$/, ""));
      if (bases.every((b) => b === bases[0])) return [w, `${bases[0]} (models differ on high cloud)`];
      return [w, `${AGREE_TEXT[v.parts[0].key]} (models differ on height)`];
    }
    return ["split", v.parts.map((p) => `${labels[p.model] || p.model}: ${SPLIT_TEXT[p.key] || p.key}`).join(" · ")];
  }
  return [WORD[v.key] || "none", v.text];
}
export const dayWord = (v) => (!v ? "" : v.split ? "split" : DAY_WORD[v.key] || "");

/* ---------- places, points and locations ---------- */
const ROLE_BC = { Base: "Low", Mid: "Mid", Top: "High" };
const pointOf = (place, role) => place?.points?.find((p) => p.role === role) || null;
const roleLabel = (place, role) => (place.mode === "backcountry" ? ROLE_BC[role] || role : role);
const isLoc = (x) => !!x && Array.isArray(x.time) && !!x.series;
// Locations by role: { Mid: loc, ... } or an array aligned with place.points.
export function pick(locs, place, role) {
  if (!locs) return null;
  const l = Array.isArray(locs) ? locs[place.points.findIndex((p) => p.role === role)] : locs[role];
  return isLoc(l) ? l : null;
}
const anyLoc = (locs) => (Array.isArray(locs) ? locs : Object.values(locs || {})).find(isLoc) || null;
export const elevLine = (place) => `${place.points.map((p) => `${roleLabel(place, p.role)} ${fmtNum(p.elev_ft)}`).join(" · ")} ft`;
const lowestFt = (place) => Math.min(...place.points.map((p) => p.elev_ft));
const highest = (place) => place.points.reduce((a, b) => (b.elev_ft > a.elev_ft ? b : a));

function localNow(loc, nowMs) {
  const s = localHourString(nowMs, loc.utcOffset);
  return { ymd: s.slice(0, 10), hour: +s.slice(11, 13), idx: loc.time.indexOf(s) };
}

// Rule 8: the clouds profile carries no precipitation. Align by time, never mutate the input.
export function withPrecip(cloudLoc, srcLoc) {
  if (!isLoc(cloudLoc)) return null;
  const P = srcLoc?.series?.precipitation;
  if (!P) return cloudLoc;
  const off = srcLoc.time.indexOf(cloudLoc.time[0]);
  if (off < 0) return cloudLoc;
  const precipitation = {};
  for (const m of Object.keys(P)) precipitation[m] = cloudLoc.time.map((_, i) => P[m][i + off] ?? null);
  return { ...cloudLoc, series: { ...cloudLoc.series, precipitation } };
}

/* ---------- small numeric helpers ---------- */
const full = (arr, idx) => !!arr && idx.length > 0 && idx.every((i) => arr[i] != null);
function byModelOver(loc, v, idx, models, fn) {
  const out = {};
  for (const m of models) { const a = loc.series[v]?.[m]; if (full(a, idx)) out[m] = fn(idx.map((i) => a[i])); }
  return out;
}
const maxOf = (xs) => Math.max(...xs), minOf = (xs) => Math.min(...xs), sumOf = (xs) => xs.reduce((a, b) => a + b, 0);
const mean = (xs) => sumOf(xs) / xs.length;

export function miles(aLat, aLon, bLat, bLon) {
  const r = 3958.8, p = Math.PI / 180;
  const h = Math.sin(((bLat - aLat) * p) / 2) ** 2 + Math.cos(aLat * p) * Math.cos(bLat * p) * Math.sin(((bLon - aLon) * p) / 2) ** 2;
  return Math.round(2 * r * Math.asin(Math.sqrt(h)) * 10) / 10;
}

/* ---------- snow level and cloud verdicts ---------- */
export function snowLevelText(sl) {
  if (!sl) return null;
  if (sl.kind === "valley") return "to valley floor";
  if (sl.kind === "single") return `~${fmtNum(sl.ft)} ft`;
  return `uncertain, ~${fmtNum(sl.lo)} to ${fmtNum(sl.hi)} ft`;
}
const slMid = (sl) => (!sl ? null : sl.kind === "single" ? sl.ft : sl.kind === "range" ? (sl.lo + sl.hi) / 2 : null);
function snowLevel24(cloudLoc, nowMs, minFt) {
  if (!cloudLoc) return null;
  const idx = windowIdx(cloudLoc, nowIndex(cloudLoc, nowMs), 24);
  return idx.length ? snowLevel(cloudLoc, idx, FREEZE_SHORT, minFt) : null;
}
// Rule 3: once local time passes 17:00 the face's AM/PM verdicts are tomorrow's.
function faceDay(loc, nowMs) {
  const t = localNow(loc, nowMs);
  return t.hour >= 17 ? { ymd: addDays(t.ymd, 1), off: 1, label: "tomorrow" } : { ymd: t.ymd, off: 0, label: "today" };
}
function amPm(cloudLoc, ymd, off, summitFt) {
  if (!cloudLoc) return [wordFor(null), wordFor(null)];
  return ["AM", "PM"].map((h) => wordFor(cloudVerdict(cloudLoc, ymd, h, summitFt, off)));
}
export function tomorrowVerdict(cloudLoc, summitFt, nowMs) {
  if (!isLoc(cloudLoc)) return null;
  const ymd = addDays(localNow(cloudLoc, nowMs).ymd, 1);
  return wordFor(cloudVerdict(cloudLoc, ymd, "AM", summitFt, 1));
}

/* ---------- models line and forecast rows (rule 2) ---------- */
const ORDER = [NBM, HRRR, HRDPS, "ncep_nam_conus", ECMWF, GFS, "icon_seamless"];
export function modelsLine(byModel, digits = 2) {
  const ms = Object.keys(byModel || {}).filter((m) => fin(byModel[m]));
  const keep = ms.includes(HRRR) ? ms.filter((m) => m !== GFS) : ms;   // GFS is HRRR early on; never both
  keep.sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
  return keep.map((m) => `${LABEL[m] || m} ${byModel[m].toFixed(digits)}`).join(" · ");
}
const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
function windDir(loc, idx, speedBy) {
  const m = speedBy[NBM] != null ? NBM : SHORT.find((x) => speedBy[x] != null && full(loc.series.wind_direction_10m?.[x], idx));
  const D = m && loc.series.wind_direction_10m?.[m], S = m && loc.series.wind_speed_10m?.[m];
  if (!full(D, idx) || !full(S, idx)) return null;
  let x = 0, y = 0;
  for (const i of idx) { x += S[i] * Math.sin((D[i] * Math.PI) / 180); y += S[i] * Math.cos((D[i] * Math.PI) / 180); }
  if (!x && !y) return null;
  const deg = ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360;
  return COMPASS[Math.round(deg / 45) % 8];
}
function fcRow(loc, nIdx, hours) {
  const idx = windowIdx(loc, nIdx, hours);
  if (!idx.length) return null;
  const hi = headline(byModelOver(loc, "temperature_2m", idx, SHORT, maxOf));
  const lo = headline(byModelOver(loc, "temperature_2m", idx, SHORT, minOf));
  const water = windowTotals(loc, nIdx, hours).water;
  const gustH = headline(byModelOver(loc, "wind_gusts_10m", idx, SHORT, maxOf));
  const speedBy = byModelOver(loc, "wind_speed_10m", idx, SHORT, maxOf);
  const speed = headline(speedBy), dir = windDir(loc, idx, speedBy);
  const parts = [];
  if (hi && lo) parts.push(`${int(hi.value)}° / ${int(lo.value)}°F`);
  if (water) parts.push(`${fmtWater(water.value)}″ water`);
  if (speed && dir && gustH) parts.push(`${dir} ${int(speed.value)} gusting ${int(gustH.value)} mph`);
  else if (gustH) parts.push(`gusts ${int(gustH.value)} mph`);
  const vals = water ? Object.values(water.byModel) : [];
  return { k: `${hours} h`, text: parts.join(", ") || "no data", models: water ? modelsLine(water.byModel) : "",
    split: vals.length > 1 && wetness(vals).startsWith("SPLIT") };
}
export function fcRowsZ(loc, nowMs) {
  if (!isLoc(loc)) return [];
  const n = nowIndex(loc, nowMs);
  return [24, 48].map((h) => fcRow(loc, n, h)).filter(Boolean);
}

/* ---------- cloud chart ---------- */
const CHART_LEVELS = [600, 650, 700, 750, 800, 850];
function chartPanel(loc, m, at) {
  const rows = [...CHART_LEVELS.map((p) => `cloud_cover_${p}hPa`), "cloud_cover_low"];
  const grid = rows.map((v) => at.map((i) => (fin(loc.series[v]?.[m]?.[i]) ? Math.round(loc.series[v][m][i]) : null)));
  let last = -1;
  at.forEach((_, c) => { if (grid.some((r) => r[c] != null)) last = c; });
  return { label: LABEL[m], grid, endCol: last === at.length - 1 ? null : last + 1 };
}
function chartHeights(loc, m, at) {
  const f = feetFactor(loc, "geopotential_height_850hPa");
  const h = CHART_LEVELS.map((p) => {
    const vs = at.map((i) => loc.series[`geopotential_height_${p}hPa`]?.[m]?.[i]).filter(fin);
    return f != null && vs.length ? Math.round((median(vs) * f) / 100) * 100 : null;
  });
  return [...h, null];
}
export function cloudChartZ(cloudLoc, summitFt, nowMs, cols = 16) {
  if (!isLoc(cloudLoc)) return null;
  const n = nowIndex(cloudLoc, nowMs);
  if (n < 0) return null;
  const at = Array.from({ length: cols }, (_, c) => n + 1 + 3 * c);
  const first = cloudLoc.series.cloud_cover_low?.[HRRR]?.[at[0]] != null ? HRRR : GFS;
  const models = [first, HRDPS].map((m) => chartPanel(cloudLoc, m, at)).filter((p) => p.endCol !== 0);
  if (!models.length) return null;
  const xlab = [];
  at.forEach((i, c) => {
    const ymd = (cloudLoc.time[i] || "").slice(0, 10);
    if (ymd && (!xlab.length || xlab[xlab.length - 1].ymd !== ymd)) xlab.push({ col: c, ymd, label: dow(ymd) });
  });
  return { summit: summitFt, cols, start: cloudLoc.time[at[0]] || null, models, xlab, rowsFt: chartHeights(cloudLoc, first, at) };
}

/* ---------- avalanche ---------- */
const CENTER = {
  NWAC: { c: "NWAC", name: "Northwest Avalanche Center", url: "https://nwac.us/avalanche-forecast/" },
  COAA: { c: "COAA", name: "Central Oregon Avalanche Center", url: "https://www.coavalanche.org/" },
  IPAC: { c: "IPAC", name: "Idaho Panhandle Avalanche Center", url: "https://www.idahopanhandleavalanche.org/" },
};
// Offset of an IANA zone from UTC at an instant, in ms (wall clock minus instant). Throws on an unknown zone.
function tzOffsetMs(tz, ms) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(ms));
  const g = (t) => +parts.find((p) => p.type === t).value;
  const wall = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour") % 24, g("minute"), g("second"));
  return wall - Math.floor(ms / 1000) * 1000;
}
// A map-layer end_date ("2026-11-21T02:30:00", wall time in `timezone`) as epoch ms. NaN when unparseable.
// A missing or unknown timezone reads the time as UTC: for Pacific Northwest zones that expires earlier, the safe side.
export function endDateMs(end, tz) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/.exec(String(end ?? "").trim());
  if (!m) return NaN;
  if (m[8]) return Date.parse(String(end).trim().replace(" ", "T"));   // carries its own offset
  const asUtc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  if (!Number.isFinite(asUtc) || typeof tz !== "string" || !tz) return asUtc;
  try {
    const first = asUtc - tzOffsetMs(tz, asUtc);
    return asUtc - tzOffsetMs(tz, first);   // re-read the offset at the answer, for DST changeovers
  } catch { return asUtc; }
}
// No end_date: nothing to check. An end_date that can't be read can't vouch for the rating: expired.
export function zoneExpired(z, nowMs) {
  if (!z || z.end_date == null || z.end_date === "" || !fin(nowMs)) return false;
  const end = endDateMs(z.end_date, z.timezone);
  return !Number.isFinite(end) || end <= nowMs;
}
// Raw map-layer JSONs (array or one) or already-parsed zones -> { zoneId: zone }.
export function zonesFrom(mapLayers) {
  const merged = {};
  for (const m of Array.isArray(mapLayers) ? mapLayers : [mapLayers]) {
    if (m) Object.assign(merged, m.features ? parseMapLayer(m) : m);
  }
  return merged;
}
// States: rated, off-season, no rating, unavailable (feed didn't load), expired (the layer's end_date has passed).
export function avalFor(place, mapLayers, nowMs = Date.now()) {
  const a = place?.avalanche;
  if (!a) return null;
  if (a.center === "AVCAN") return { c: "AvCan", l: null, url: a.link || "https://avalanche.ca/forecasts", state: "link" };
  const base = CENTER[a.center] || { c: a.center, name: a.center, url: null };
  const z = zonesFrom(mapLayers)[a.zone];
  if (!z) return { c: base.c, name: base.name, l: -1, url: a.link || base.url, state: "unavailable" };
  const url = a.link || z.link || base.url;
  if (zoneExpired(z, nowMs)) return { c: base.c, name: base.name, l: -1, url, zone: z.name, state: "expired" };
  const rated = !z.off_season && Number.isInteger(z.level) && z.level >= 1 && z.level <= 5;
  return { c: base.c, name: base.name, l: rated ? z.level : -1, url, zone: z.name, state: z.off_season ? "off-season" : rated ? "rated" : "no rating" };
}
// Rule 7: guard missing band members; a stale product never shows.
export function avalBandsZ(product, aval, nowMs) {
  if (!product || !aval || !(aval.l >= 1)) return null;
  const exp = Date.parse(product.expires_time || "");
  if (!Number.isFinite(exp) || exp < nowMs) return null;   // no or unparseable expiry = stale; the pill and link stay
  const { bands } = parseProduct(product);
  const ok = (x) => Number.isInteger(x) && x >= 1 && x <= 5;
  if (!bands || ![bands.above, bands.near, bands.below].every(ok)) return null;
  return [["Above treeline", bands.above], ["Near treeline", bands.near], ["Below treeline", bands.below]];
}

/* ---------- cams and the sun ---------- */
export function sunElevation(lat, lon, nowMs) {
  // NOAA "General Solar Position Calculations" (fractional-year form).
  const d = new Date(nowMs), y = d.getUTCFullYear();
  const doy = Math.floor((nowMs - Date.UTC(y, 0, 1)) / 86400000) + 1;
  const hr = d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600;
  const ndays = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 366 : 365;
  const g = ((2 * Math.PI) / ndays) * (doy - 1 + (hr - 12) / 24);
  const eqt = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g)
    + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const ha = ((hr * 60 + eqt + 4 * lon) / 4 - 180) * (Math.PI / 180);
  const la = lat * (Math.PI / 180);
  const cz = Math.sin(la) * Math.sin(decl) + Math.cos(la) * Math.cos(decl) * Math.cos(ha);
  return 90 - (Math.acos(Math.max(-1, Math.min(1, cz))) * 180) / Math.PI;
}
export const sunUp = (lat, lon, nowMs) => sunElevation(lat, lon, nowMs) > -0.833;

const camList = (cams) => (Array.isArray(cams) ? cams : cams?.cams || []);
function camZ(c, nowMs) {
  const [area, rest] = c.name.includes(" - ") ? c.name.split(" - ", 2) : [c.name, ""];
  return { id: c.id, area, where: rest ? `${rest}, ${fmtFt(c.elev_ft)}` : fmtFt(c.elev_ft), url: c.url,
    alt: c.shows ? `${c.name}: ${c.shows}` : c.name, night: fin(nowMs) ? !sunUp(c.lat, c.lon, nowMs) : false };
}
export function camsFor(ids, cams, nowMs) {
  const by = Object.fromEntries(camList(cams).map((c) => [c.id, c]));
  return (ids || []).filter((id) => by[id]).map((id) => camZ(by[id], nowMs));
}
// sunNow: nowMs, or a predicate (cam) => boolean.
export function camsForPage(cams, sunNow) {
  const up = typeof sunNow === "function" ? sunNow : (c) => sunUp(c.lat, c.lon, sunNow);
  return camList(cams).filter(up).map((c) => camZ(c, typeof sunNow === "number" ? sunNow : null));
}

/* ---------- SNOTEL ---------- */
// Rule 4: the stored mi is measured from the glance point. Any other point needs the station's coordinates.
export function stationMiles(place, st, fromRole) {
  const role = fromRole || place.glance, pt = pointOf(place, role);
  if (pt && fin(st?.lat) && fin(st?.lon)) return miles(pt.lat, pt.lon, st.lat, st.lon);
  return role === place.glance && fin(st?.mi) ? st.mi : null;
}
// The role a place's station distance is measured from: the region anchor when the place anchors a region.
export function distanceRole(place, regions) {
  for (const group of Object.values(regions || {})) {
    const r = group.find((x) => x.anchor?.place === place.id);
    if (r) return r.anchor.role;
  }
  return place.glance;
}
// SNOTEL times are station standard time (PST, UTC-8) year round. Daily rows carry a date only: read as 00:00 that day.
const SNOTEL_TZ_MS = -8 * 3600000;
const snotelMs = (date) => {
  const [d, t = "00:00"] = String(date || "").split(" ");
  return Date.parse(`${d}T${t}:00Z`) - SNOTEL_TZ_MS;
};
function hourLabel(ms, utcOffset) {
  const h = new Date(ms + utcOffset * 1000).getUTCHours();
  return h === 0 ? "midnight" : h === 12 ? "noon" : `${h % 12} ${h < 12 ? "AM" : "PM"}`;
}
// Latest depth no newer than now and no older than 36 h, labeled with its age. Older readings are dropped.
export function depthReading(snotel, nowMs, utcOffset = -28800, maxAgeH = 36) {
  const rows = [...(snotel?.hourly || []), ...(snotel?.daily || [])]
    .map((r) => ({ depth: r.snwd, ms: snotelMs(r.date) }))
    .filter((r) => fin(r.depth) && Number.isFinite(r.ms) && r.ms <= nowMs && nowMs - r.ms <= maxAgeH * 3600000)
    .sort((a, b) => b.ms - a.ms);
  if (!rows.length) return null;
  const { depth, ms } = rows[0];
  const day = (x) => localHourString(x, utcOffset).slice(0, 10);
  const asOf = day(ms) === day(nowMs) ? `as of ${hourLabel(ms, utcOffset)}` : `as of ${dow(day(ms))}`;
  return { depth, ms, asOf };
}
export function snotelZ(place, snotel, nowMs, utcOffset = -28800) {
  const st = snotel?.station;
  if (!st) return { measured: null, station: null, stElev: null, through: null, snotelNote: null };
  const yday = addDays(localHourString(nowMs, utcOffset).slice(0, 10), -1);
  const days = [-2, -1, 0].map((k) => addDays(yday, k));
  const byDay = Object.fromEntries(storms(snotel.daily || []).map((r) => [String(r.date).slice(0, 10), r]));
  const measured = days.map((d) => (byDay[d] && fin(byDay[d].new) ? Math.round(byDay[d].new) : null));
  const last = measured.map((v, i) => (v != null ? i : -1)).reduce((a, b) => Math.max(a, b), -1);
  const mi = stationMiles(place, st, snotel.from);
  const dep = depthReading(snotel, nowMs, utcOffset);
  const parts = [];
  if (dep) parts.push(`${dep.depth > 0 ? `depth ${Math.round(dep.depth)}″` : "bare"} ${dep.asOf}`);
  if (last >= 0) parts.push(measured[last] > 0 ? `+${measured[last]}″ ${dow(days[last])}` : `no new snow ${dow(days[last])}`);
  let note = `${st.name} (${fmtFt(st.elev_ft)}${mi != null ? `, ${mi} mi` : ""}): ${parts.join(", ") || "no recent data"}.`;
  if (measured[2] == null) note += ` ${dow(days[2])} not posted yet.`;
  return { measured, station: st.name, stElev: fmtFt(st.elev_ft), through: last >= 0 ? dow(days[last]) : null, snotelNote: note };
}

/* ---------- ski: collapsed row ---------- */
function n24Of(loc, nowMs) {
  const idx = isLoc(loc) ? nowIndex(loc, nowMs) : -1;
  if (idx < 0) return { idx, n: null, snow: null };
  const n = next24(loc, idx);
  const tot = windowTotals(loc, idx, 24).snow;
  return { idx, n, snow: n?.precip?.type === "snow" ? n.precip.value : tot ? tot.value : null };
}
export function skiRowZ(place, glanceLoc, nowMs, aval = null) {
  const pt = pointOf(place, place.glance);
  const { idx, n, snow } = n24Of(glanceLoc, nowMs);
  const mb = idx >= 0 ? miniBars(glanceLoc, idx, 7) : [];
  const bars = [], na = [], days = [];
  for (let i = 0; i < 7; i++) {
    const s = mb[i]?.snow;
    bars.push(fin(s) ? round1(s) : 0); na.push(!fin(s)); days.push(mb[i]?.ymd ? dow(mb[i].ymd) : null);
  }
  const aria = days[0] ? `Next 7 days snow, est.: ${days.map((d, i) => `${d} ${na[i] ? "no data" : `${fmtIn(bars[i])} in`}`).join(", ")}` : "Snow forecast unavailable";
  return {
    id: place.id, mode: place.mode, name: place.title, sub: place.subtitle, elev: elevLine(place), star: false, aval,
    glance: { n24: round1(snow), n24Text: fmtIn(snow), bars, barsNA: na, days, aria, unavailable: idx < 0 },
    rank: { id: place.id, name: place.title, elev_ft: pt?.elev_ft ?? null, n24: n, aval },
  };
}

/* ---------- ski: expanded card ---------- */
// A point has data now when its Loc gives a headline temperature at the current hour.
function hasNow(loc, nowMs) {
  if (!isLoc(loc)) return false;
  const i = nowIndex(loc, nowMs);
  return i >= 0 && !!headline(byModelOver(loc, "temperature_2m", [i], SHORT, (xs) => xs[0]));
}
function chooseAt(place, cloudsAt, locAt, nowMs) {
  const start = pointOf(place, "Mid") || pointOf(place, place.glance);
  const cl = cloudsAt(start.role) || cloudsAt(place.glance);
  const sl = snowLevel24(cl, nowMs, lowestFt(place));
  const top = pointOf(place, "Top");
  // Move up only when the snow level is above the start point AND the Top point has data for now.
  const up = top && top !== start && fin(slMid(sl)) && slMid(sl) > start.elev_ft && hasNow(locAt(top.role), nowMs);
  return { atPt: up ? top : start, sl };
}
function fcDays(loc, nowMs) {
  const t = isLoc(loc) ? localNow(loc, nowMs) : null;
  return Array.from({ length: 7 }, (_, d) => {
    const s = t && t.idx >= 0 ? daySummary(loc, addDays(t.ymd, d), d, d === 0 ? t.idx : -1)?.snow : null;
    if (!s) return [null, null, null, null, 1];
    const ec = s.byModel[ECMWF];
    return [Math.round(s.value), Math.round(s.min), Math.round(s.max), fin(ec) ? Math.round(ec) : null, s.n < 3 ? 1 : 0];
  });
}
function trioZ(loc, nowMs) {
  const n = isLoc(loc) ? nowIndex(loc, nowMs) : -1;
  return [6, 12, 24].map((h) => {
    const s = n >= 0 ? windowTotals(loc, n, h).snow : null;
    return [`${h} h`, s ? dispIn(s.value) : "–", s ? rangeText(s.min, s.max) : "–"];
  });
}
// Water-weighted snow ratio over the snowy hours, per model, then the middle value.
function ratioZ(loc, nowMs, label) {
  const n = isLoc(loc) ? nowIndex(loc, nowMs) : -1;
  const idx = windowIdx(loc || { time: [] }, n, 24);
  if (!idx.length || !(windowTotals(loc, n, 24).snow?.value >= 0.5)) return null;
  const rs = [];
  for (const m of SHORT) {
    const T = loc.series.temperature_2m?.[m], P = loc.series.precipitation?.[m];
    if (!full(T, idx) || !full(P, idx)) continue;
    let w = 0, s = 0;
    for (const i of idx) { const r = P[i] > 0 ? slr(T[i]) : null; if (r != null) { w += P[i]; s += P[i] * r; } }
    if (w > 0) rs.push(s / w);
  }
  return rs.length ? `~${Math.round(median(rs))}:1 at ${label}, est.` : null;
}
function bandsZ(place, locAt, nowMs) {
  return [...place.points].sort((a, b) => b.elev_ft - a.elev_ft).map((p) => {
    const loc = locAt(p.role), n = loc ? nowIndex(loc, nowMs) : -1;
    const s = n >= 0 ? windowTotals(loc, n, 24).snow : null;
    return s ? [roleLabel(place, p.role), fmtFt(p.elev_ft), Math.round(s.value), Math.round(s.min), Math.round(s.max)] : null;
  }).filter(Boolean);
}
function standsFor(place, aval) {
  const lo = place.points[0], hi = highest(place);
  const span = lo === hi ? lo.name : `${lo.name} to ${hi.name}`;
  return aval?.zone && aval.zone !== place.title ? `${span}; avalanche rating from ${aval.zone}` : span;
}
export function skiCardZ(place, detailLocs, cloudLocs, glanceLocs, snotel, product, cams, nowMs, aval = null) {
  const locAt = (role) => pick(detailLocs, place, role) || pick(glanceLocs, place, role);
  const cloudsAt = (role) => withPrecip(pick(cloudLocs, place, role), locAt(role));
  const row = skiRowZ(place, pick(glanceLocs, place, place.glance) || locAt(place.glance), nowMs, aval);
  const { atPt, sl } = chooseAt(place, cloudsAt, locAt, nowMs);
  const atLoc = locAt(atPt.role);
  const sumPt = place.mode === "resort" ? highest(place) : pointOf(place, place.glance);
  const cl = cloudsAt(sumPt.role) || cloudsAt(atPt.role) || withPrecip(anyLoc(cloudLocs), atLoc);
  const fd = faceDay(cl || atLoc || { time: [], utcOffset: -28800 }, nowMs);
  const trio = trioZ(atLoc, nowMs), fc = fcDays(atLoc, nowMs);
  const raw = trio.map((t) => t[1]).concat(fc.map((f) => f[0]));
  const offset = (atLoc || cl)?.utcOffset ?? -28800;
  return {
    ...row,
    at: fmtFt(atPt.elev_ft), atRole: roleLabel(place, atPt.role), trio, fc,
    ...snotelZ(place, snotel, nowMs, offset),
    snowLevel: snowLevelText(sl), snowLevelModels: sl?.models || [],
    clouds: amPm(cl, fd.ymd, fd.off, sumPt.elev_ft), cloudsDay: fd.label,
    empty: raw.every((v) => v === 0), noData: raw.every((v) => v === "–" || v == null),
    gust: int(n24Of(atLoc, nowMs).n?.gust?.value), summit: sumPt.elev_ft, standsFor: standsFor(place, aval),
    bands: bandsZ(place, locAt, nowMs), ratio: ratioZ(atLoc, nowMs, roleLabel(place, atPt.role)),
    cams: camsFor(place.cams, cams, nowMs), avalBands: avalBandsZ(product, aval, nowMs),
    fcRows: fcRowsZ(atLoc, nowMs), cloudChart: cloudChartZ(cl, sumPt.elev_ft, nowMs),
  };
}

/* ---------- hike ---------- */
function cloudyFrac24(loc, idx) {
  return headline(byModelOver(loc, "weather_code", idx, SHORT, (cs) => cs.filter((c) => c >= 3).length / cs.length));
}
export function hikeRowZ(place, glanceLoc, nowMs) {
  const pt = pointOf(place, place.glance);
  const { idx, n } = n24Of(glanceLoc, nowMs);
  let glance = { c: null, hi: null, lo: null, sn: null, rain: null, unavailable: true };
  if (n) {
    const tot = windowTotals(glanceLoc, idx, 24), cf = cloudyFrac24(glanceLoc, windowIdx(glanceLoc, idx, 24));
    const c = condition(tot.water?.value ?? 0, tot.snow?.value ?? 0, cf?.value ?? null);
    glance = { c, hi: int(n.hi), lo: int(n.lo), sn: c === "snow" ? Math.round(tot.snow.value) : 0, rain: c === "wet" ? fmtWater(tot.water?.value) : null, unavailable: false };
  }
  let tomorrow = null;
  if (idx >= 0) {
    const s = daySummary(glanceLoc, addDays(localNow(glanceLoc, nowMs).ymd, 1), 1);
    if (s?.daylightWater) tomorrow = { water: s.daylightWater.value, gust: s.gust?.value ?? 0 };
  }
  return {
    id: place.id, mode: "hike", region: place.region, name: place.title, sub: place.subtitle, star: false, glance,
    rank: { id: place.id, name: place.title, elev_ft: pt?.elev_ft ?? null, role: pt?.role, tomorrow, verdict: null },
  };
}
function avgCols(cols) {
  const rows = [cols.map((c) => c.low)];
  for (const p of [850, 800, 750, 700, 650, 600]) rows.push(cols.map((c) => c.levels.find((l) => l.hPa === p).cover));
  return rows.map((r) => Math.round(mean(r)));
}
// One day's cloud column for the hike row: levels7 + the word, from the same daylight hours.
function dayCloud(cl, ymd, d, fromIdx, summit) {
  if (!cl) return { lv: Array(7).fill(null), word: "", src: "" };
  const idx = [];
  cl.time.forEach((t, i) => { const h = +t.slice(11, 13); if (t.startsWith(ymd) && h >= 8 && h <= 17 && i > fromIdx) idx.push(i); });
  let models = d <= 1 ? CLOUD_SHORT : [GFS];
  let cols = models.map((m) => ({ m, c: idx.length ? modelColumn(cl, m, idx) : null })).filter((x) => x.c);
  if (!cols.length && d <= 1) cols = [{ m: GFS, c: idx.length ? modelColumn(cl, GFS, idx) : null }].filter((x) => x.c);
  if (!cols.length) return { lv: Array(7).fill(null), word: "", src: "" };
  const vs = cols.map((x) => verdictFor(x.c, summit));
  const word = vs.every((v) => v.key === vs[0].key) ? DAY_WORD[vs[0].key] : "split";   // same rule as wordFor: agree on the word = no split
  const hrrrEarly = cols[0].m === GFS && d >= 2 && idx.some((i) => cl.series.cloud_cover_low?.[HRRR]?.[i] != null);
  const src = hrrrEarly ? "GFS (HRRR early)" : cols.map((x) => LABEL[x.m]).join(" · ");
  return { lv: avgCols(cols.map((x) => x.c)), word, src };
}
function hikeDays(loc, cl, summit, nowMs) {
  if (!isLoc(loc)) return null;
  const t = localNow(loc, nowMs);
  if (t.idx < 0) return null;
  const start = t.hour >= 17 ? 1 : 0;
  const light = Math.max(0, 17 - Math.max(t.hour, 7));
  const cIdx = cl ? localNow(cl, nowMs).idx : -1;
  const days = [], src = [];
  for (let k = 0; k < 5; k++) {
    const d = start + k, ymd = addDays(t.ymd, d);
    const s = daySummary(loc, ymd, d, d === 0 ? t.idx : -1);
    const label = d === 0 ? (light >= 3 ? "Rest of today" : "Late today") : dow(ymd);
    const c = dayCloud(cl, ymd, d, d === 0 ? cIdx : -1, summit);
    days.push([label, s?.condition ?? null, int(s?.hi?.value), int(s?.lo?.value), s?.snow ? Math.round(s.snow.value) : 0, c.lv, c.word]);
    src.push(c.src);
  }
  return { days, src, start };
}
// glanceLocs (optional): the header uses the same source as the collapsed row; everything falls back to it when detail is missing.
export function hikeCardZ(place, detailLocs, cloudLocs, cams, nowMs, glanceLocs = null) {
  const hi = pointOf(place, "High") || pointOf(place, place.glance), th = pointOf(place, "Trailhead");
  const locAt = (role) => pick(detailLocs, place, role) || pick(glanceLocs, place, role);
  const hiLoc = locAt(hi.role), thLoc = th ? locAt(th.role) : null;
  const cl = withPrecip(pick(cloudLocs, place, hi.role), hiLoc);
  const row = hikeRowZ(place, pick(glanceLocs, place, place.glance) || pick(detailLocs, place, place.glance) || hiLoc, nowMs);
  const hd = hikeDays(hiLoc, cl, hi.elev_ft, nowMs);
  const td = th && thLoc ? hikeDays(thLoc, null, th.elev_ft, nowMs) : null;
  let tomorrow = null;
  if (hiLoc && localNow(hiLoc, nowMs).idx >= 0) {
    const ymd = addDays(localNow(hiLoc, nowMs).ymd, 1), s = daySummary(hiLoc, ymd, 1);
    const [am, pm] = amPm(cl, ymd, 1, hi.elev_ft);
    tomorrow = { day: dow(ymd), hi: int(s?.hi?.value), lo: int(s?.lo?.value), gust: int(s?.gust?.value) ?? 0, am, pm };
  }
  const sl = snowLevel24(cl, nowMs, lowestFt(place));
  return {
    ...row,
    high: [hi.name, hi.elev_ft], th: th ? [th.name, th.elev_ft] : null, summit: hi.elev_ft,
    days: hd?.days ?? null, cloudSrc: hd?.src ?? null, day0Note: hd && hd.start === 0 ? "rest of today, from the next hour" : null,
    thDays: td ? td.days.map(([, c, h, l]) => [c, h, l]) : null,
    tomorrow, snowLevel: snowLevelText(sl), snowLevelModels: sl?.models || [], standsFor: place.subtitle,
    cams: camsFor(place.cams, cams, nowMs), fcRows: fcRowsZ(hiLoc, nowMs), cloudChart: cloudChartZ(cl, hi.elev_ft, nowMs),
  };
}

/* ---------- regions ---------- */
const ICON_C = { sun: "dry", cloud: "cloudy", fog: "cloudy", rain: "wet", snow: "snow", storm: "wet" };
function regionNow(place, role, loc, anchorStation, nowMs) {
  const pt = pointOf(place, role);
  const idx = isLoc(loc) ? nowIndex(loc, nowMs) : -1;
  const model = idx >= 0 ? modelNow(loc, idx) : null;
  const st = anchorStation?.station;
  const latest = anchorStation?.latest || latestHourly(anchorStation?.hourly || []);
  const sr = st && latest && pt ? stationNow({ ...st, mi: stationMiles(place, st, role), latest }, pt.elev_ft, nowMs) : null;
  const r = nowReading(sr, model);
  if (!r) return null;
  const out = { c: ICON_C[r.icon] || "cloudy", w: r.word, t: Math.round(r.tempF), source: r.source };
  if (r.source === "station") Object.assign(out, { station: r.station, ageMin: r.ageMin });
  return out;
}
function nextText(rn, noun) {
  if (!rn) return null;
  const n = rn.total, pl = `${noun}s`;
  const of = (k) => (k === n ? (n === 1 ? `the ${noun}` : n === 2 ? `both ${pl}` : `all ${n} ${pl}`) : `${k} of ${n} ${pl}`);
  let p;
  if (rn.snowCount) {
    p = `snow at ${of(rn.snowCount)}, <span class="nw">${rangeText(rn.snowMin, rn.snowMax).replace("<", "&lt;")}″</span>`;   // p is HTML
    if (rn.rainCount) p += ` · rain at ${rn.rainCount}`;
  } else if (rn.rainCount) p = `rain at ${of(rn.rainCount)}`;
  else p = `dry at ${of(n)}`;
  return { lo: int(rn.lo), hi: int(rn.hi), p };
}
function regionLine(areas, anchorClouds, anchorFt, nowMs) {
  const ref = areas.find((a) => a.loc)?.loc;
  if (!ref) return null;
  const t = localNow(ref, nowMs);
  const start = t.hour >= 17 ? 1 : 0;
  let snowDay = null, dryDay = null;
  for (let d = start; d < 7 && !(snowDay && dryDay); d++) {
    const ymd = addDays(t.ymd, d);
    const sums = areas.map((a) => (a.loc ? daySummary(a.loc, ymd, d, d === 0 ? nowIndex(a.loc, nowMs) : -1) : null));
    const name = d === 0 ? "today" : dow(ymd);
    const snowy = areas.filter((a, i) => sums[i]?.condition === "snow");
    // Nearest 100 ft (spec: no invented precision; this overrides the plan's floor-to-500).
    if (!snowDay && snowy.length) snowDay = `snow ${name} above ~${fmtNum(Math.round(Math.min(...snowy.map((a) => a.elev_ft)) / 100) * 100)} ft`;
    if (!dryDay && sums.every((s) => s && fin(s.water?.value) && s.water.value < 0.05)) dryDay = `dry ${name}`;
  }
  const phrases = [snowDay, dryDay].filter(Boolean);
  if (!phrases.length && anchorClouds) {
    const ymd = addDays(localNow(anchorClouds, nowMs).ymd, 1);
    const v = cloudVerdict(anchorClouds, ymd, "AM", anchorFt, 1);
    if (v) phrases.push(`${v.split ? "Clouds split" : PHRASE[v.key]} ${dow(ymd)} AM`);
  }
  return phrases.length ? phrases.map((p, i) => (i ? p : cap(p))).join(" · ") : null;
}
function regionPill(zs) {
  const av = zs.map((z) => z.aval).filter((a) => a && Number.isInteger(a.l) && a.l >= 1);
  if (av.length < 2) return null;
  const c = av[0].c, same = av.filter((a) => a.c === c), ls = same.map((a) => a.l);
  const lo = Math.min(...ls), hi = Math.max(...ls);
  return lo === hi ? null : { c, lo, hi, url: same[0].url, text: `${c} ${lo}–${hi}` };
}
// anchorLoc: { glance, clouds } at the anchor point (rule 5), or a bare glance Loc.
export function regionZ(region, places, zsCollapsed, glanceByPlace, anchorLoc, anchorStation, nowMs, noun) {
  const mine = places.filter((p) => p.region === region.id);
  const anchor = places.find((p) => p.id === region.anchor.place);
  const aPt = pointOf(anchor, region.anchor.role);
  const aGlance = isLoc(anchorLoc) ? anchorLoc : anchorLoc?.glance;
  const aClouds = isLoc(anchorLoc) ? null : withPrecip(anchorLoc?.clouds, aGlance);
  const areas = mine.map((p) => {
    const loc = isLoc(glanceByPlace?.[p.id]) ? glanceByPlace[p.id] : null;
    const i = loc ? nowIndex(loc, nowMs) : -1;
    return { loc, elev_ft: pointOf(p, p.glance).elev_ft, n24: i >= 0 ? next24(loc, i) : null };
  });
  return {
    id: region.id, name: region.title, noun,
    spot: anchor.mode === "resort" ? anchor.title : aPt.name.replace(/ \(.*\)$/, ""),
    now: regionNow(anchor, region.anchor.role, aGlance, anchorStation, nowMs),
    next: nextText(regionNext24(areas), noun),
    line: regionLine(areas, aClouds, aPt.elev_ft, nowMs),
    zs: zsCollapsed, count: `${zsCollapsed.length} ${noun}${zsCollapsed.length === 1 ? "" : "s"}`,
    pill: noun === "area" ? null : regionPill(zsCollapsed),
  };
}

/* ---------- top three ---------- */
const FOOT = {
  ski: "Ranked by forecast snow at each place's middle point, next 24 h (NBM where it covers), est. Pill: the avalanche center's rating today. Gusts flagged at 35 mph and up.",
  hike: "Areas with a high point at 4,000 ft and up, ranked by forecast water in daylight hours. Clouds are a model read.",
};
// A place counts as loaded when its row has a forecast. "No snow" and "nothing dry" may only be said when every place loaded.
// counts (optional): { loaded, total } from the caller; otherwise read from the rows (glance.unavailable = didn't load).
export function top3Z(mode, items, counts = null) {
  const hike = mode === "hike";
  const settled = items.filter((z) => z.status !== "loading");
  const total = counts?.total ?? settled.length;
  const loaded = counts?.loaded ?? settled.filter((z) => !z.glance?.unavailable).length;
  const failed = Math.max(0, total - loaded);
  const title = hike ? "Driest tomorrow" : "Most snow, next 24 h";
  if (total > 0 && loaded === 0) return { title, rows: [], foot: hike ? FOOT.hike : FOOT.ski, empty: UNAVAILABLE, partial: null, loaded, failed, total };
  const partial = failed ? `Ranked from ${loaded} of ${total} places; ${failed} didn't load.` : null;
  const byId = Object.fromEntries(items.map((z) => [z.id, z]));
  const ranked = topThree(items.map((z) => z.rank).filter(Boolean), hike ? "hike" : "ski");
  const rows = ranked.map((r) => {
    const z = byId[r.id];
    if (hike) {
      return { id: r.id, name: r.name, at: `${r.role || "High"} · ${fmtFt(r.elev_ft)}`, num: `${fmtWater(r.tomorrow.water)}″`,
        small: "water, 8 AM to 5 PM", verdict: r.verdict || null, gust: int(r.tomorrow.gust) ?? 0 };
    }
    const p = r.n24.precip;
    return { id: r.id, name: r.name, at: `at ${fmtFt(r.elev_ft)}`, num: `${fmtIn(p.value)}″`, small: `${rangeText(p.min, p.max)} est.`,
      aval: z?.aval || null, gust: int(r.n24.gust?.value) ?? 0 };
  });
  const allEmpty = hike ? "No area at 4,000 ft and up has a forecast yet." : "No snow forecast in the next 24 h.";
  const partEmpty = hike ? `None of the ${loaded} areas that loaded is at 4,000 ft and up with a forecast.` : `No snow forecast in the next 24 h at the ${loaded} places that loaded.`;
  return { title, rows, foot: hike ? FOOT.hike : FOOT.ski, empty: rows.length ? null : failed ? partEmpty : allEmpty, partial, loaded, failed, total };
}
