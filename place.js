// page/place.js
// The v3 place view-model (the dialog an area row or pick opens), ported from mock/v3/index.html (renderPV, sevenDay,
// glanceCards, tabBody, resortsSec, windLine, snowLine24, backcountrySec, areaBestLine, precip, dayKey) and
// mock/v3/snapshot.mjs (daysAt, spotsFor, skiZ, hikeZ, resortZ, plainClouds) onto the engine and vm.js.
// Pure: no DOM, no fetch, no storage, no clock. Locs come in through the input's getters.
// Program R1: Best, Good, the window and the weather reasons come from engine/best.js and engine/window.js only. The
// week reads engine/week.js weekEntries, as the area's row does, so the row and its place view name the same Best day.
import { V, BEST, FLAG, metricsOver, areaBest, goodDays, dayScore, skiTags, skyKey } from "./engine/best.js";
import { nightIdx } from "./engine/daycard.js";
import { weatherWindow, windowWords, profile, clock } from "./engine/window.js";
import { nowIndex, addDays } from "./engine/forecast.js";
import { periodRows } from "./engine/periods.js";
import { rankPoint, skiPlace, hikePlace, placeFor, placePoints } from "./engine/areas.js";
import { snowLine, snowTag } from "./engine/snowline.js";
import { plainClouds, cloudSentence } from "./engine/plainclouds.js";
import { weekEntries } from "./engine/week.js";
import { areaSub, resortRow, n24Spoken, WX_LABEL, SKY } from "./guide.js";
import { skiCardZ, hikeCardZ, avalFor, camsFor, spotLabel, fmtFt, fmtNum, fmtIn, fmtWater, dow, sunUp, withPrecip, NA } from "./vm.js";

const fin = (x) => typeof x === "number" && Number.isFinite(x);
const isLoc = (l) => !!l && Array.isArray(l.time) && !!l.series;
const live = (l) => (isLoc(l) ? l : null);
// Missing values stay null for the renderer; this file writes no dash placeholder (Global constraints, Question 7).
const round = (h) => (h && fin(h.value) ? Math.round(h.value) : null);
const dateOf = (ymd) => new Date(`${ymd}T12:00:00Z`).toLocaleString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
const weekday = (ymd) => new Date(`${ymd}T12:00:00Z`).toLocaleString("en-US", { timeZone: "UTC", weekday: "long" });

// mock TABS (round 11): Overview first; Snow in Ski only.
export const TABS = {
  ski: [["forecast", "Overview"], ["elevation", "Elevation"], ["clouds", "Clouds"], ["snow", "Snow"], ["cams", "Cams"]],
  hike: [["forecast", "Overview"], ["elevation", "Elevation"], ["clouds", "Clouds"], ["cams", "Cams"]],
};
// After a Ski | Hike switch: keep the tab when the other mode has it, else Overview (round 12).
export const tabFor = (mode, tab) => (TABS[mode].some(([k]) => k === tab) ? tab : "forecast");

// Copy table strings.
export const BEST_DEF = "Best = the driest day, then the sunniest, 8 AM to 5 PM. Snow beats rain. A rainy day never gets Best. Good = another day that also qualifies: dry, or snowing with no rain, and a good weather window of 5 hours or more in a row.";
export const WINDOW_DEF = "Window = the first stretch of 3 hours or more, 6 AM to 10 PM, with no rain, heavy snow or strong wind. Rain and snow end it when the first model calls for them.";
export const WINDOW_TIP = "Source: Open-Meteo hourly models. Rain and snow close the window at the earliest model; wind uses HRRR when it covers the day, else NBM (10 m gusts, est.). Rain 0.02 in or more in an hour, snow 1 in or more in an hour, any snow with gusts 25 mph or more, or gusts 30 mph or more.";
// Overview order (plan Task 8, Question 2): the hour strips sit right under the week.
export const OVERVIEW = { ski: ["glance", "week", "window", "resorts", "backcountry"], hike: ["snowLine", "glance", "week", "window", "high"] };

/* ---------- the week ---------- */
// mock precip: Ski shows snow (rain when it rains instead); Hike shows rain (snow when it is mostly snow).
// Numbers through vm.js fmtIn and fmtWater (the mock's inches and water), always on finite input here.
const inches = fmtIn, waterIn = fmtWater;
function precip(mode, x) {
  if (!x) return { value: null, unit: "", cls: "no" };
  const snow = x.snow ?? 0, rain = x.rain ?? 0, w = x.water ?? 0;
  if (mode === "ski") {
    if (snow >= 0.5) return { value: `${inches(snow)}″`, unit: rain >= 0.1 ? `snow, ${waterIn(rain)}″ rain` : "snow", cls: "sn" };
    if (rain >= 0.05) return { value: `${waterIn(rain)}″`, unit: "rain", cls: "rn" };
    return { value: "0″", unit: "snow", cls: "no" };
  }
  if (w < 0.05) return { value: "Dry", unit: "", cls: "no" };
  if (rain >= 0.05 || snow < 0.5) return { value: `${waterIn(rain)}″`, unit: snow >= 0.5 ? `rain, ${inches(snow)}″ snow` : "rain", cls: "rn" };
  return { value: `${inches(snow)}″`, unit: "snow", cls: "sn" };
}
const amounts = (m) => (m ? { snow: V(m.snowIn), rain: V(m.rain), water: V(m.water) } : null);
const amountText = (a) => (a.value === "Dry" || a.value === "0″" ? "dry" : `${a.value}${a.unit ? ` ${a.unit}` : ""}`);
// Copy "7-day night line": "Night 31°, 0.41″ rain".
const nightLine = (mode, nt) => (nt?.lo ? `Night ${Math.round(V(nt.lo))}°, ${amountText(precip(mode, amounts(nt)))}` : null);

// The night's icon (the tap's Night cell, and Tonight's card): wet by its snow share, else clear (moon) or cloudy from the
// same hours' weather codes, as the mock's wxKey does at night. The hours are daycard.js nightIdx, as the night line's.
function nightKey(loc, ymd, nowMs, rest) {
  const m = metricsOver(loc, nightIdx(loc, ymd, nowMs, rest), nowMs);
  if (!m) return null;
  return V(m.water) >= BEST.dryIn ? skyKey(m) : V(m.clear) >= 0.6 ? "moon" : "cloudy";
}

function weekOf(loc, pt, nowMs, mode) {
  const at = pt ? (() => { const s = spotLabel({ mode: "x" }, pt) || fmtFt(pt.elev_ft); return /ft$/.test(s) ? s : `${s}, ${fmtNum(pt.elev_ft)} ft`; })() : null;
  const days = weekEntries(loc, nowMs, mode);
  if (!days.length) return { at, def: BEST_DEF, bestLine: null, days: [] };
  const b = areaBest(days, mode), good = new Set(goodDays(days, mode));
  const out = days.map((d) => {
    const c = d.card, m = d.m, isBest = !b.none && d.ymd === b.ymd, isGood = good.has(d.ymd);
    // Today turns Tonight once no daytime hour is ahead (from 4 PM, when the last one starts; architect, fix round 1).
    // Then the card's icon is the night's, and its name drops the day clause.
    const tonight = d.offset === 0 && !m;
    const label = d.offset === 0 ? (tonight ? "Tonight" : "Today") : dow(d.ymd);
    const nk = c.night ? nightKey(loc, d.ymd, nowMs, d.offset === 0) : null;
    // Tonight's right side: the night line's low and amount (final review M1), so the card is never blank there.
    const date = dateOf(d.ymd), key = tonight ? nk : c.key, amount = precip(mode, amounts(tonight ? c.night : m));
    const tags = mode === "ski" && d.offset >= 1 ? skiTags(m) : [];
    const gust = m?.gust && V(m.gust) >= FLAG.gustMph ? Math.round(V(m.gust)) : null;
    const night = nightLine(mode, c.night);
    const parts = [
      c.am && { part: "AM", key: skyKey(c.am), t: round(c.am.hi), amount: precip(mode, amounts(c.am)) },
      c.pm && { part: "PM", key: skyKey(c.pm), t: round(c.pm.hi), amount: precip(mode, amounts(c.pm)) },
      c.night && { part: "Night", key: nk, t: round(c.night.lo), amount: precip(mode, amounts(c.night)) },
    ].filter(Boolean).map((p) => ({ ...p, label: p.key ? WX_LABEL[p.key] : null }));
    const hi = round(m?.hi), lo = round(tonight ? c.night?.lo : m?.lo);
    // mock sevenDay aria, plus the night line (it sits in the hidden visual part); the renderer adds "Show" or "Hide".
    const nightA = night ? ` ${night.replace(/(<1|\d+(?:\.\d+)?)″/g, (_, t) => n24Spoken(t))}.` : "";
    const ariaLabel = tonight ? `${label}, ${date}.${nightA || " No data."}` : `${label}, ${date}${isBest ? ", best day" : isGood ? ", good day" : ""}${tags.length ? `, ${tags.join(", ")}` : ""}: ${WX_LABEL[key] || "no data"}, high ${hi ?? "unknown"}, low ${lo ?? "unknown"}${amount.value ? `, ${amount.value} ${amount.unit}`.trimEnd() : ""}`
      + `${gust ? `, gusts ${gust} mph` : ""}${c.early ? ", early look, the models disagree" : ""}.${nightA}`;
    return { ymd: d.ymd, offset: d.offset, label, date, key, keyLabel: key ? WX_LABEL[key] : null, hi, lo, amount, night, tags, gust,
      isBest, isGood, early: c.early, parts, ariaLabel };
  });
  return { at, def: BEST_DEF, bestLine: days.some((d) => d.offset >= 1 && d.m) ? bestLineOf(days, b, mode) : null, days: out };
}

// Copy "Place view Best line" (Scott, 2026-11-06 Q1: no reason, the window's words inside its days). { head, text }: the
// renderer bolds head. None: the mock's line; its "Rain likely every day." only when every candidate day rains, since a
// day can also leave Best for heavy snow or gusts.
function bestLineOf(days, b, mode) {
  if (b.none) {
    const cands = days.filter((d) => d.offset >= 1 && !d.early && d.m);
    const allRain = cands.length > 0 && cands.every((d) => dayScore(d.m) == null);
    return { head: "No good day here this week.", text: allRain ? "Rain likely every day." : "" };
  }
  const d = days.find((x) => x.ymd === b.ymd);
  const head = `Best day: ${b.offset === 1 ? "Tomorrow" : weekday(b.ymd)}.`;
  if (d.w) return { head, text: windowWords(d.w, mode) };
  const am = SKY[skyKey(d.card.am)], pm = SKY[skyKey(d.card.pm)];
  const sky = [am && `morning ${am}`, pm && `afternoon ${pm}`].filter(Boolean).join(", ");
  // The Copy's " Early look." cannot occur: areaBest never picks an early-look day (best.js).
  return { head, text: sky ? `${sky[0].toUpperCase()}${sky.slice(1)}.` : "" };
}

/* ---------- the hour strip ---------- */
// One day's window as cells 6 AM to 9 PM (the profile's hours). past: the hour already started (not in the window's
// hours). dark: the sun is down at the half hour at pt. runs: consecutive shown cells with the same state and reason.
// null when the day has no window (past the window's days, no hour ahead, or no data).
export function hourStrip(loc, ymd, nowMs, mode, pt, label) {
  if (!isLoc(loc)) return null;
  const w = weatherWindow(loc, ymd, nowMs, mode);
  if (!w) return null;
  const p = profile(mode), byH = new Map(w.hours.map((x) => [x.h, x]));
  // One offset per response; no DST change falls in the next 3 days until 2027-03-14 (R6).
  const msAt = (x) => Date.parse(`${ymd}T00:00:00Z`) + x * 3600e3 - loc.utcOffset * 1000;
  const cells = [];
  for (let h = p.fromH; h < p.toH; h++) {
    const x = byH.get(h);
    cells.push({ h, open: x ? x.open : null, why: x ? x.why : null, dark: !!pt && fin(pt.lat) && fin(pt.lon) && !sunUp(pt.lat, pt.lon, msAt(h + 0.5)), past: !x });
  }
  const shown = cells.filter((c) => !c.past), runs = [];
  for (const c of shown) {
    const r = runs[runs.length - 1];
    if (r && r.to === c.h && r.open === c.open && r.why === c.why) r.to = c.h + 1;
    else runs.push({ from: c.h, to: c.h + 1, open: c.open, why: c.why });
  }
  const said = runs.map((r) => (r.open ? `Good weather ${clock(r.from)} to ${clock(r.to)}.` : `Closed ${clock(r.from)} to ${clock(r.to)}${r.why ? `: ${r.why}` : ""}.`));
  const dark = [];
  for (const c of shown) {
    const r = dark[dark.length - 1];
    if (!c.dark) continue;
    if (r && r.to === c.h) r.to = c.h + 1; else dark.push({ from: c.h, to: c.h + 1 });
  }
  if (dark.length && shown.length) {
    const first = shown[0].h, end = shown[shown.length - 1].h + 1;
    const words = dark.map((r) => (r.to === end ? `from ${clock(r.from)}` : r.from === first ? `until ${clock(r.to)}` : `${clock(r.from)} to ${clock(r.to)}`));
    said.push(`Dark ${words.join(" and ")}.`);
  }
  return { ymd, label, words: windowWords(w, mode), cells, runs, text: said.join(" ") };
}

/* ---------- places and points ---------- */
const byRole = (place, get) => Object.fromEntries((place?.points || []).map((p) => [p.role, live(get?.(p.key))]));
const role = (place, r) => place?.points.find((p) => p.role === r) || null;
// The backcountry place for the Snow and Backcountry parts: the zone or the hike stand-in, never a resort (mock bcOf).
const bcPlace = (area, places) => { const p = skiPlace(area, places); return p && p.mode !== "resort" ? p : null; };

// Elevation tab spots (mock spotsFor): the Ski place's and the Hike place's points (the points placePoints loads), high to
// low, one per name, each with periodRows on its detail, clouds and aloft.
function spotsOf(area, places, card, nowMs) {
  const seen = new Map();
  for (const pl of [skiPlace(area, places), hikePlace(area, places)].filter(Boolean)) {
    for (const p of pl.points) {
      const name = spotLabel(pl, p), k = (name || String(p.elev_ft)).toLowerCase();
      if (seen.has(k)) continue;
      const det = live(card.detail?.(p.key));
      if (!det) continue;
      const periods = periodRows(det, live(card.clouds?.(p.key)), live(card.aloft?.(p.key)), p.elev_ft, nowMs).map((x) => ({ ...x, day: dow(x.ymd) }));
      if (periods.length) seen.set(k, { role: k.replace(/[^a-z0-9]+/g, "_"), name, ft: fmtFt(p.elev_ft), elev_ft: p.elev_ft, periods });
    }
  }
  return [...seen.values()].sort((x, y) => y.elev_ft - x.elev_ft);
}

// Clouds in plain words for the mode: Ski at the backcountry place's Top (else its ranking point) and Base; Hike at the
// High point and the Trailhead. A far area with no zone reads its resort's Top and Base.
function cloudsOf(area, mode, places, input) {
  const pl = mode === "ski" ? skiPlace(area, places) : hikePlace(area, places);
  if (!pl) return [];
  const hi = mode === "ski" ? role(pl, "Top") || role(pl, pl.glance) : role(pl, "High");
  const lo = mode === "ski" ? role(pl, "Base") : role(pl, "Trailhead");
  if (!hi) return [];
  const locOf = (p) => live(input.card?.detail?.(p.key)) || live(input.glance?.(p.key));
  const pts = [hi, lo && lo.key !== hi.key ? lo : null].filter(Boolean).map((p) => ({ name: spotLabel(pl, p) || fmtFt(p.elev_ft), ft: p.elev_ft, loc: locOf(p) }));
  return plainClouds(live(input.card?.clouds?.(hi.key)), pts, input.nowMs) || [];
}

/* ---------- Backcountry (mock windLine, snowLine24, backcountrySec) ---------- */
function windOf(top) {
  if (!top) return null;
  const ps = top.periods.slice(0, 3).filter((p) => p.wind);
  if (!ps.length) return null;
  const lo = Math.min(...ps.map((p) => p.wind.mph)), hi = Math.max(...ps.map((p) => p.wind.mph));
  const dirs = [...new Set(ps.map((p) => p.wind.dir))];
  const surface = ps.some((p) => p.wind.from === "surface");
  return {
    text: `${dirs.join("/")} ${Math.round(lo)} to ${Math.round(hi)} mph next 24 h`,
    note: `At ${top.name || top.ft}${top.name ? `, ${top.ft}` : ""}, the strongest hour in each period. ${surface ? "Surface wind (10 m)." : "Free-air wind from pressure levels; expect less in sheltered terrain."}`,
    cells: top.periods.slice(0, 3).map((p) => ({ day: p.day, part: p.part, dir: p.wind?.dir ?? null, mph: p.wind ? Math.round(p.wind.mph) : null })),
  };
}
function snow24Of(z) {
  if (!z?.bands?.length) return null;
  return { text: z.bands.map(([n, , m]) => `${m}″ ${String(n).toLowerCase()}`).join(", "), heights: `Est. Heights: ${z.bands.map(([n, e]) => `${n} ${e}`).join(", ")}.`, bands: z.bands };
}

/* ---------- At a glance (round 11, 11b) ---------- */
// One card per other tab the mode has, in the mock's card order (Clouds, Elevation, Snow, Cams); each opens its tab.
// The plan said "in tab order" (Elevation before Clouds); the approved mock's order stands (architect, fix round 1).
function glanceCards(tabs, { clouds, spots, resorts, skiZ, cams }) {
  const has = (k) => tabs.some(([t]) => t === k);
  const card = (tab, title, body, extra = null) => ({ tab, title, body, extra, ariaLabel: `${title}. ${body}. Open ${title}.` });
  const out = [];
  if (has("clouds")) out.push(card("clouds", "Clouds", clouds[0] ? cloudSentence(clouds[0]) : "Cloud layers by elevation"));
  if (has("elevation")) {
    const top = spots[0], p = top?.periods?.[0];
    let line = "Temperature and wind by elevation";
    if (p && fin(p.hi)) {
      const w = fin(p.gust) ? `gusts to ${Math.round(p.gust)} mph` : p.wind && fin(p.wind.mph) ? `wind ${Math.round(p.wind.mph)} mph` : "";
      line = `${top.name ? `${top.name} ${top.ft}` : top.ft}: ${Math.round(p.hi)}°${w ? `, ${w}` : ""}`;
    }
    out.push(card("elevation", "Elevation", line));
  }
  if (has("snow")) {
    // One source per card: with a resort, its 5-day total and bars; without one, the zone's next 24 hours.
    const rs = resorts.filter((r) => r.bars && fin(r.t5)).sort((x, y) => y.t5 - x.t5)[0];
    if (rs) {
      const big = rs.t5 > 0 && rs.t5 < 1 ? "<1″" : `${Math.round(rs.t5)}″`;
      out.push(card("snow", "Snow", `${big} new snow, next 5 days, ${rs.name}`, { big, sub: `next 5 days, ${rs.name}`, bars: rs.bars.slice(0, 5), barsNA: rs.barsNA.slice(0, 5), aria: rs.aria }));
    } else {
      // vm.js writes NA for a 24 h total it cannot make; then the card says there is none.
      const n = (skiZ?.trio || []).find(([w]) => w === "24 h")?.[1];
      if (n != null && n !== NA) out.push(card("snow", "Snow", `${n}″ new snow, next 24 hours`, { big: `${n}″`, sub: "new snow, next 24\u00a0h" }));
      else out.push(card("snow", "Snow", "No snow forecast for this place"));
    }
  }
  if (has("cams") && cams.length) {
    const n = `${cams.length} ${cams.length === 1 ? "cam" : "cams"}`;
    out.push(card("cams", "Cams", n, { cam: cams.find((c) => !c.night) || cams[0] }));
  }
  return out;
}

/* ---------- the place view ---------- */
// in: { area, mode, places, nowMs, glance(key), freeze(key), bands(key), card: { detail(key), clouds(key), aloft(key) },
//       snotel: { station, daily, hourly, from } | null, product | null, layers, cams, depth(triplet), loading(kind, key) }
// layers: the avalanche map layers; null while they load (the rating then reads "loading", never "unavailable").
// loading(kind, key), kind "detail" | "glance" | "bands": whether that point is still loading. A point with no data that
// is not loading has failed, so pending turns false and the sections say "Forecast unavailable". Without it, no data = loading.
export function placeView(input) {
  const { area, places, nowMs } = input;
  const card = input.card || {};
  const mode = area.far ? "ski" : input.mode === "hike" ? "hike" : "ski";   // areas outside Washington are Ski only
  const tabs = TABS[mode];
  const modes = ["ski", "hike"].map((id) => {
    const disabled = id === "hike" && !!area.far;
    return { id, label: id === "ski" ? "Ski" : "Hike", on: id === mode, disabled, ariaLabel: disabled ? "Hike, not available for this place" : null };
  });
  const layersIn = Array.isArray(input.layers), layers = layersIn ? input.layers : [];
  const avalOf = (pl) => {
    if (!pl) return null;
    const a = avalFor(pl, layers, nowMs);
    return !layersIn && a?.state === "unavailable" ? { ...a, state: "loading" } : a;
  };
  const wait = (kind, key) => (input.loading ? !!input.loading(kind, key) : true);

  // The ranking point's loc: the landing's glance first, so the week, the Best line and the strips read the same pull the
  // area's row read and both name the same Best day (final review I2). The view's own detail pull is the fallback (a
  // Ski | Hike switch inside the view) and stays the Elevation tab's source. Cost: the week can be up to 30 minutes
  // older than the Elevation tab.
  const pt = rankPoint(area, mode, places);
  const loc = pt ? live(input.glance?.(pt.key)) || live(card.detail?.(pt.key)) : null;
  const here = placeFor(area, mode, places);
  const aval = avalOf(here || skiPlace(area, places) || hikePlace(area, places));

  // vm.js builders, as mock/v3/snapshot.mjs calls them. The station distance is measured from the area's own ranking
  // point (bc.glance, Panorama Point at Rainier), never v2's region anchor (final review M3).
  const bc = bcPlace(area, places), hk = hikePlace(area, places);
  const snotel = bc && input.snotel ? { ...input.snotel, from: bc.glance } : null;
  const skiZ = bc ? skiCardZ(bc, byRole(bc, card.detail), byRole(bc, card.clouds), byRole(bc, input.glance), snotel,
    input.product || null, input.cams, nowMs, avalOf(bc), byRole(bc, card.aloft)) : null;
  const hikeZ = hk ? hikeCardZ(hk, byRole(hk, card.detail), byRole(hk, card.clouds), input.cams, nowMs, byRole(hk, input.glance), byRole(hk, card.aloft)) : null;

  const spots = spotsOf(area, places, card, nowMs);
  const clouds = cloudsOf(area, mode, places, input);
  const resorts = area.resorts.map((id) => places[id]).filter(Boolean).map((r) => {
    const row = resortRow({ glance: input.glance, bands: input.bands, nowMs, pos: null, aval: avalOf }, r, area);
    return { id: r.id, name: row.resort.name, sub: row.resort.sub, n24Text: row.n24Text, bars: row.bars, barsNA: row.barsNA, aria: row.barsAria,
      t5: row.t5, base: row.base, top: row.top, bands: row.bands, ariaLabel: row.ariaLabel.replace(/ Open$/, "") };
  });
  const camIds = [...new Set([...area.hike, area.bc, ...area.resorts].filter(Boolean).flatMap((id) => places[id]?.cams || []))];
  const cams = camsFor(camIds, input.cams, nowMs);

  // Hike: the snow line block above At a glance, nowhere else (round 11b). The freezing level from the Hike landing, else
  // the place view's clouds, so a Hike view opened from Ski still has one.
  let line = null, tag = null;
  if (mode === "hike" && hk && pt) {
    const st = hk.snotel?.[0] || null;
    const cl = withPrecip(live(input.freeze?.(pt.key)) || live(card.clouds?.(pt.key)), loc);
    const L = snowLine(st, pt.elev_ft, st ? input.depth?.(st.triplet) ?? null : null, cl, nowMs);
    line = L ? { ...L, at: spotLabel(hk, pt) || fmtFt(pt.elev_ft) } : null;
    tag = snowTag(L);
  }

  const week = weekOf(loc, pt, nowMs, mode);
  // The weather window: the next profile(mode).days days, today only while an hour is ahead.
  const strips = [];
  const n0 = loc ? nowIndex(loc, nowMs) : -1;   // -1 when now is outside the loc's hours: no strips, never a throw
  if (n0 >= 0) {
    const ymd0 = loc.time[n0].slice(0, 10);
    for (let d = 0; d < profile(mode).days; d++) {
      const ymd = addDays(ymd0, d);
      const s = hourStrip(loc, ymd, nowMs, mode, pt, d === 0 ? "Today" : d === 1 ? "Tomorrow" : weekday(ymd));
      if (s) strips.push(s);
    }
  }

  const backcountry = mode === "ski" && skiZ ? {
    wind: windOf(spots[0]), snow24: snow24Of(skiZ),
    standInNote: area.bc ? null : `This area has no NWAC zone of its own; these use its hike points and the ${aval?.zone || "nearest"} rating.`,
  } : null;

  // pending: a point this view loads that has no data yet (the ranking point, spot detail, resort rows).
  const pp = placePoints(area, places);
  const pending = (!loc && wait("detail", pt?.key)) || pp.spots.some((p) => !live(card.detail?.(p.key)) && wait("detail", p.key))
    || pp.mids.some((p) => !live(input.glance?.(p.key)) && wait("glance", p.key))
    || pp.bands.some((p) => !live(input.bands?.(p.key)) && wait("bands", p.key));

  return {
    mode, modes, tabs, overview: OVERVIEW[mode], title: area.name, sub: areaSub(area, places), aval,
    avyBands: mode === "ski" ? skiZ?.avalBands ?? null : null,
    glance: glanceCards(tabs, { clouds, spots, resorts: mode === "ski" ? resorts : [], skiZ: mode === "ski" ? skiZ : null, cams }),
    week, windowStrips: strips, windowDef: WINDOW_DEF, windowTip: WINDOW_TIP,
    snowLine: line, snowTag: tag, clouds, resorts, backcountry, spots, skiZ, hikeZ, cams, pending,
  };
}
