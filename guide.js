// page/guide.js
// The v3 landing view-model ("Where to go" and "All places"), ported from mock/v3/index.html (guide, flagReasons, row,
// areaGroups, resortGroups, resortRow, placesList) and mock/v3/snapshot.mjs (slotsFor, glanceAt) onto the engine.
// Pure: no DOM, no fetch, no storage, no clock. Locs come in through the input's getters; the viewer's position (pos) is
// only ever an argument here, used for miles and never returned except as those miles.
// Program R1: Best, Good, the window and the "Not looking good" reasons come from engine/best.js and engine/window.js only.
import { BEST, V, metricsOver, dayMetrics, partMetrics, rank, earlyLook, dayIsEarly, areaBest, slotBest, skiTags, skyKey, isDry } from "./engine/best.js";
import { windowShort, WINDOW_LEAD, FLAG_SPAN, profile } from "./engine/window.js";
import { slotClose, weekEntries } from "./engine/week.js";
import { nowIndex, addDays, windowTotals, next24 } from "./engine/forecast.js";
import { span, hourOf } from "./engine/hours.js";
import { SHORT } from "./engine/models.js";
import { modelNow } from "./engine/now.js";
import { PICK } from "./engine/picks.js";
import { rankPoint, placeFor, skiPlace, hikePlace, areasFor, areaPoint } from "./engine/areas.js";
import { snowLine, snowTag } from "./engine/snowline.js";
import { skiRowZ, spotLabel, fmtFt, fmtNum, fmtIn, fmtWater, dow, sunUp, miles, withPrecip, NA } from "./vm.js";

const fin = (x) => typeof x === "number" && Number.isFinite(x);
const isLoc = (l) => !!l && Array.isArray(l.time) && !!l.series;
const pad = (h) => String(h).padStart(2, "0");
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const cmpNum = (a, b) => (a === b ? 0 : a < b ? -1 : 1);
const spoken = (s) => s.replace(/~/g, "about ");   // "good weather window till ~4 PM" read aloud
// Inches read aloud from their printed form (vm.js fmtIn, fmtWater): "<1" is "under 1 inch", "1" is "1 inch", else
// "N inches". Also the place view's aria text (page/place.js), so no label says "1 inches". A value the screen prints as
// n/a (vm.js NA) is spoken as "no data".
export const n24Spoken = (t) => (t === NA || t == null ? "no data" : t === "<1" ? "under 1 inch" : t === "1" ? "1 inch" : `${t} inches`);
// The icon's label (mock WX_LABEL), the one copy: the landing here, the place view (page/place.js) and the icons
// (page/ui.js) import it. moon (a clear night) comes only from the night's icon and the row's weather code; skyKey never
// returns it. SKY: the same word in lowercase for "Morning sunny, afternoon cloudy".
export const WX_LABEL = { sun: "Sunny", partly: "Partly sunny", cloudy: "Cloudy", rain: "Rain", snow: "Snow", mixed: "Rain and snow", moon: "Clear" };
export const SKY = Object.fromEntries(Object.entries(WX_LABEL).map(([k, v]) => [k, v.toLowerCase()]));
// Round 13: the region groups outside Washington, Ski only, in this order.
export const REGION_ORDER = ["Washington", "Oregon Cascades", "Idaho", "BC, Canada"];

/* ---------- When: the day picker ---------- */
const subOf = (ymd) => new Date(`${ymd}T12:00:00Z`).toLocaleString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });

// The slots at one loc (mock snapshot.mjs slotsFor, with Now = the 3 hours starting after the current hour):
//   now    sky n+1 to n+3; fresh snow since midnight through the end of those hours; flag span those 3 hours
//   later  hours starting after Now up to 10 PM, only before 5 PM local and with 2 or more hours; fresh = 24 h ending 10 PM
//   d1-d6  8 AM to 5 PM (dayMetrics); flag span FLAG_SPAN
// sky and fresh are this loc's indices. Every loc gets its own slots (timezone=auto: BC's Mountain-time resorts differ).
export function slotsAt(loc, nowMs) {
  if (!isLoc(loc)) return [];
  const n = nowIndex(loc, nowMs);
  if (n < 0) return [];
  const T = loc.time.length, ymd0 = loc.time[n].slice(0, 10), hour = +loc.time[n].slice(11, 13);
  const at = (ymd, h) => loc.time.indexOf(`${ymd}T${pad(h)}:00`);
  const range = (a, b) => (a < 0 || b < a ? [] : Array.from({ length: b - a + 1 }, (_, k) => a + k).filter((i) => i < T));
  const h = (i) => (i < T ? hourOf(loc, ymd0, i) : hour + (i - n));
  const out = [];
  const d0 = at(ymd0, 0);
  out.push({ id: "now", label: "Now", sub: "next 3 h", ymd: ymd0, off: 0, sky: range(n + 1, n + 3),
    fresh: range(Math.max(d0, 0) + 1, n + 4), span: { fromH: h(n + 1), toH: h(n + 1) + 3 } });
  if (hour < 17) {
    const from = h(n + 4), sky = span(loc, ymd0, from, 22), i22 = at(ymd0, 22);
    if (sky.length >= 2) out.push({ id: "later", label: "Later today", sub: "to 10 PM", ymd: ymd0, off: 0, sky,
      fresh: range(Math.max(0, i22 - 23), i22), span: { fromH: from, toH: 22 } });
  }
  for (let d = 1; d <= 6; d++) {
    const ymd = addDays(ymd0, d), f10 = at(ymd, 10);
    out.push({ id: `d${d}`, label: d === 1 ? "Tomorrow" : dow(ymd), sub: subOf(ymd), ymd, off: d, sky: span(loc, ymd, BEST.fromH, BEST.toH),
      fresh: f10 >= 23 ? range(f10 - 23, f10) : [], span: FLAG_SPAN });
  }
  return out;
}

// This loc's reading of the picker's slot. Now and Later today: this loc's own hours, matched by id. A day: the picker's
// local date, so a Mountain-time loc reads the same date as the picker at any hour (ruling, 2026-11-06). The memo builds
// each loc's slots once per moment; same input, same output.
const memo = new WeakMap();
function locSlot(loc, slot, nowMs) {
  if (!isLoc(loc) || !slot) return null;
  if (slot.off >= 1) return nowIndex(loc, nowMs) >= 0 ? { ...slot, sky: span(loc, slot.ymd, BEST.fromH, BEST.toH) } : null;
  let c = memo.get(loc);
  if (!c || c.nowMs !== nowMs) { c = { nowMs, slots: slotsAt(loc, nowMs) }; memo.set(loc, c); }
  return c.slots.find((s) => s.id === slot.id) || null;
}

// Now and Later today: metricsOver on the slot's hours (water hour-ending, Mock vs spec 6). Days: dayMetrics, 8 AM to 5 PM.
export function slotMetrics(loc, slot, nowMs) {
  const s = locSlot(loc, slot, nowMs);
  if (!s) return null;
  if (s.off === 0) return metricsOver(loc, s.sky, nowMs, s.fresh);
  return dayMetrics(loc, s.ymd, nowMs, false);
}

// Everything one loc says about one slot. The engine decides the window's reach and whether the slot is closed
// (engine/week.js slotClose, the rule Plan 3's digest shares): past the window's days the day reads the 8 to 5 numbers and
// its two halves; Now and Later today flag on their own hours. A closed slot never ranks and never gets Best (best.js rank
// and areaBest). Avalanche and thin snow only display: the page compares weather.
function readSlot(loc, slot, nowMs, mode) {
  const s = locSlot(loc, slot, nowMs);
  if (!s) return null;
  const m = slotMetrics(loc, s, nowMs);
  const { w, reasons, closed } = slotClose(loc, s.ymd, nowMs, mode, { m, idx: s.off === 0 ? s.sky : null });
  let line = null;
  if (w) line = cap(windowShort(w, PICK_LEAD));
  else if (s.off >= 1) {
    const { am, pm } = partWords(loc, s.ymd, nowMs);
    const parts = [am && `morning ${am}`, pm && `afternoon ${pm}`].filter(Boolean);
    line = parts.length ? cap(parts.join(", ")) : null;
  }
  return { s, m, w, closed, reasons, line };
}

// The window's lead word on pick cards and area rows (Scott, 2026-11-07): "good weather window" on both. A row's Best breaks
// on purpose: "Best Sat" on one line, the window on its own line under it (bestLines), so the window never wraps by
// accident. scripts/check_page.mjs pins one line each at 390 px.
export const PICK_LEAD = WINDOW_LEAD.long, ROW_LEAD = WINDOW_LEAD.long;

const slotWord = (slot) => (slot.id === "now" ? "now" : slot.id === "later" ? "later today" : slot.off === 1 ? "tomorrow" : slot.label);
const dayName = (offset, ymd) => (offset === 1 ? "Tomorrow" : dow(ymd));

/* ---------- words ---------- */
const skyWord = (c) => (c >= 0.8 ? "clear" : c >= 0.5 ? "mostly clear" : c >= 0.2 ? "some sun" : "cloudy");
const stateWord = (m) => (isDry(m) ? "dry" : "snowing");
// The short line under a pick (mock shortReason): never repeats the big numbers on the right.
function shortReason(mode, m) {
  const g = V(m.gust) >= 20 ? `gusts ${Math.round(V(m.gust))} mph` : "light wind";
  const nw = mode === "ski" && V(m.fresh) >= 0.5 ? `, ${fmtIn(V(m.fresh))}″ new snow` : "";
  return `${cap(stateWord(m))}${isDry(m) ? "" : ` ${fmtIn(V(m.snowIn))}″`}${nw}, ${g}`;
}
// The full sentence for the pick's accessible name (mock reason).
function longReason(mode, m, slot) {
  const h = slot.sky.length;
  const fresh = slot.id === "now" ? "since midnight" : slot.id === "later" ? "in the 24 hours to 10 PM" : `by 10 AM ${slot.off === 1 ? "tomorrow" : slot.label}`;
  const nw = mode === "ski" && V(m.fresh) >= 0.5 ? `, ${fmtIn(V(m.fresh))}″ new ${fresh}` : "";
  const g = m.gust ? `, gusts to ${Math.round(V(m.gust))} mph` : "";
  return `${cap(stateWord(m))}, ${skyWord(V(m.clear))}, clear ${Math.round(V(m.clear) * h)} of ${h} h${nw}${g}`;
}
// Morning and afternoon sky for a day past the window's days (partMetrics, the icon rule).
function partWords(loc, ymd, nowMs) {
  const k = (part) => SKY[skyKey(partMetrics(loc, ymd, part, nowMs))] || null;
  return { am: k("AM"), pm: k("PM") };
}

/* ---------- Not looking good ---------- */
function stationOf(area, places) { return hikePlace(area, places)?.snotel?.[0] || null; }
function stationDepth(input, area) {
  const st = stationOf(area, input.places);
  const d = st ? input.depth?.(st.triplet)?.depth : null;
  return fin(d) ? d : null;
}
const locAt = (input, area) => { const p = rankPoint(area, input.mode, input.places); return p ? input.glance?.(p.key) ?? null : null; };

// The reasons for one area on the selected slot, in order: weather, avalanche, thin snow (Copy "Flags").
// Weather inside the window's days uses the window's hourly rules, so the flag and the window line read the same hours and
// models (Mock vs spec 4); past them, the 8 to 5 numbers (readSlot).
// early: the Ski early season (thin snow then shows once, above the list, not per row).
export function flagsFor(input, area, slot, early) {
  const { mode, places, nowMs } = input;
  const out = [];
  const r = readSlot(locAt(input, area), slot, nowMs, mode);
  if (r) out.push(...r.reasons);
  const av = input.aval?.(placeFor(area, mode, places)) ?? null;
  if (av && av.l >= 4) out.push(`avalanche danger ${av.l >= 5 ? "Extreme" : "High"}${slot && slot.off >= 1 ? " (today's rating)" : ""}`);
  if (mode === "ski" && !early) {
    const d = stationDepth(input, area);
    if (d != null && d < PICK.baseIn) out.push(`thin snow, ${Math.round(d)}″ at the station`);
  }
  return out;
}
const flagText = (reasons, slot) => (reasons.length && slot ? `Not looking good ${slotWord(slot)}: ${reasons.join(", ")}` : null);

/* ---------- Hike snow line ---------- */
function lineFor(input, area) {
  const st = stationOf(area, input.places), pt = rankPoint(area, "hike", input.places);
  if (!st || !pt) return null;
  return snowLine(st, pt.elev_ft, input.depth?.(st.triplet) ?? null, withPrecip(input.freeze?.(pt.key) ?? null, input.glance?.(pt.key)), input.nowMs);
}

/* ---------- rows ---------- */
// mock snapshot.mjs glanceAt: the model's current hour and the next 24 h at the ranking point.
function glanceAt(loc, pt, nowMs) {
  const n = isLoc(loc) ? nowIndex(loc, nowMs) : -1;
  if (n < 0 || !pt) return null;
  const now = modelNow(loc, n), nx = next24(loc, n);
  const code = now ? loc.series.weather_code?.[now.model]?.[n] ?? null : null;
  return {
    code, night: fin(pt.lat) ? !sunUp(pt.lat, pt.lon, nowMs) : false,
    ft: pt.elev_ft, at: spotLabel({ mode: "x" }, pt) || fmtFt(pt.elev_ft),
    t: now ? Math.round(now.tempF) : null, w: now?.word || "", icon: now?.icon || "cloud",
    p: nx ? nx.precip.type : null, v: nx && nx.precip.type !== "dry" ? +nx.precip.value.toFixed(2) : 0,
    lo: nx ? Math.round(nx.lo) : null, hi: nx ? Math.round(nx.hi) : null,
  };
}
function glanceAria(g) {
  if (!g || g.t == null) return "no data";
  const amt = g.p === "snow" ? `${n24Spoken(fmtIn(g.v))} of snow` : g.p === "rain" ? `${n24Spoken(fmtWater(g.v))} of rain` : "dry";
  return `now ${g.t} degrees, ${g.w}, at ${g.at}; next 24 hours ${amt}`;
}

// The area's own Best day this week (Copy "Area row"): areaBest over engine/week.js weekEntries (the week the place view
// reads), which skips days whose window never opens or that carry a weather reason, then the window's short form while the
// window reaches the day, else the morning's sky. today: the picker's date, for "Tomorrow".
// { text, lines }: text is the one sentence the row's name reads ("Best Sat, good weather window till ~4 PM"); lines are
// what the row shows, the day and then the window as a line start (["Best Sat", "Good weather window till ~4 PM"]).
function rowBest(loc, mode, nowMs, today) {
  const days = weekEntries(loc, nowMs, mode);
  if (!days.some((d) => d.offset >= 1 && d.m)) return null;
  const b = areaBest(days, mode);
  if (b.none) return { text: "No good day this week", lines: ["No good day this week"] };
  const d = days.find((x) => x.ymd === b.ymd);
  let tail;
  if (d.w) tail = windowShort(d.w, ROW_LEAD);
  else { const am = SKY[skyKey(d.card.am)], pm = SKY[skyKey(d.card.pm)]; tail = am ? `morning ${am}` : pm ? `afternoon ${pm}` : null; }
  const head = `Best ${today && b.ymd === addDays(today, 1) ? "Tomorrow" : dayName(b.offset, b.ymd)}`;
  return { text: `${head}${tail ? `, ${tail}` : ""}`, lines: tail ? [head, cap(tail)] : [head] };
}

// Also the place view's subtitle (page/place.js).
export function areaSub(area, places) {
  if (area.far && area.resorts.length > 1) return area.resorts.map((id) => places[id]?.title).filter(Boolean).join(", ");
  const id = area.hike[0] || area.bc || area.resorts[0];
  return places[id]?.subtitle || "";
}

const milesTo = (pos, p) => (pos && p && fin(p.lat) && fin(p.lon) ? miles(pos.lat, pos.lon, p.lat, p.lon) : null);

// Rows sorted by distance inside each group, groups by their nearest row (mock areaGroups, resortGroups). Stable, so ties
// keep the default order. Rows with no point go last. groups: [[name, items]]. Returns new arrays; the input is untouched.
export function sortByDistance(groups, pos, pointOf) {
  if (!pos) return groups.map(([name, items]) => [name, [...items]]);
  const d = (it) => milesTo(pos, pointOf(it)) ?? Infinity;
  const sorted = groups.map(([name, items]) => [name, items.map((it) => [it, d(it)]).sort((a, b) => cmpNum(a[1], b[1]))]);
  const first = (l) => (l.length ? l[0][1] : Infinity);
  return sorted.sort((p, q) => cmpNum(first(p[1]), first(q[1]))).map(([name, l]) => [name, l.map(([it]) => it)]);
}

/* ---------- Resorts view ---------- */
const midOf = (place) => place?.points.find((p) => p.role === "Mid") || place?.points.find((p) => p.role === place.glance) || null;
function band(input, place, role) {
  const p = place.points.find((x) => x.role === role);
  if (!p) return null;
  const bl = input.bands?.(p.key) ?? null, n = isLoc(bl) ? nowIndex(bl, input.nowMs) : -1;
  const s = n >= 0 ? windowTotals(bl, n, 24, SHORT).snow : null;
  return { ft: p.elev_ft, snow: s ? s.value : null };
}
const bandText = (b, k) => (b ? `${k} ${fmtNum(b.ft)} ft: ${b.snow == null ? NA : `${fmtIn(b.snow)}″`}` : null);

// One resort row: the Resorts view here and the place view's Resorts section (page/place.js), so both read the same numbers.
export function resortRow(input, place, area) {
  const mid = midOf(place), gl = mid ? input.glance?.(mid.key) ?? null : null;
  const z = isLoc(gl) ? skiRowZ(place, gl, input.nowMs, input.aval?.(place) ?? null).glance : null;
  const ok = !!z && !z.unavailable;
  const t5 = ok ? z.bars.slice(0, 5).reduce((a, b) => a + b, 0) : null;
  const base = band(input, place, "Base"), top = band(input, place, "Top");
  const bands = [bandText(base, "Base"), bandText(top, "Top")].filter(Boolean).join(" · ");
  const d = milesTo(input.pos, mid), mi = d == null ? null : Math.round(d);
  const n24Text = ok ? z.n24Text : NA;
  const snow = ok ? `Next 24 hours ${n24Spoken(n24Text)}, next 5 days ${n24Spoken(fmtIn(t5))}, estimated.` : "Snow forecast not loaded.";
  return {
    resort: { id: place.id, name: place.title, sub: place.subtitle }, area, n24Text, t5,
    bars: ok ? z.bars : null, barsNA: ok ? z.barsNA : null, barsAria: ok ? z.aria : null,
    base, top, bands, mi, point: mid,
    ariaLabel: `${place.title}, ${area.name}${mi == null ? "" : `, ${mi} miles away`}. ${snow}${bands ? ` ${bands.replaceAll(NA, "no data")}.` : ""} Open`,
  };
}
// Most new snow first (sum of the first 5 bars), then name; rows not loaded last.
const snowFirst = (x, y) => ((x.t5 == null) !== (y.t5 == null) ? (x.t5 == null ? 1 : -1) : (y.t5 ?? 0) - (x.t5 ?? 0) || x.resort.name.localeCompare(y.resort.name));

function resortGroups(input) {
  const { areas, places } = input;
  const seen = new Set(), map = new Map(REGION_ORDER.map((r) => [r, []]));
  for (const a of areas) for (const id of a.resorts) {
    if (seen.has(id) || !places[id]) continue;
    seen.add(id);
    const region = a.region || (a.far ? a.group : "Washington");
    if (!map.has(region)) map.set(region, []);
    map.get(region).push(resortRow(input, places[id], a));
  }
  const groups = [...map.entries()].filter(([, l]) => l.length).map(([n, l]) => [n, [...l].sort(snowFirst)]);
  return sortByDistance(groups, input.pos, (r) => r.point).map(([name, rows]) => ({ name, rows: rows.map(({ point, ...r }) => r) }));
}

/* ---------- the landing ---------- */
// input.loading(kind, key), kind "glance" | "freeze" | "bands": whether that point is still loading. A point with no data
// that is not loading has failed: pending turns false and the page says "Forecast unavailable" or "No data", never
// "Loading" forever. Without it, no data counts as loading.
export function landing(input) {
  const { mode, nowMs, areas, places } = input;
  const wait = (kind, key) => (input.loading ? !!input.loading(kind, key) : true);
  const list = mode === "ski" && input.list === "resorts" ? "resorts" : "areas";
  const shown = areasFor(areas, mode), wa = shown.filter((a) => !a.far);
  const starred = input.starred || new Set();
  const locs = new Map(shown.map((a) => [a.id, locAt(input, a)]));
  let pending = shown.some((a) => { const p = rankPoint(a, mode, places); return p && !isLoc(locs.get(a.id)) && wait("glance", p.key); });

  // When: the slots of the first loaded ranking loc. Default Tomorrow from 3 PM on, else Now.
  const first = shown.map((a) => locs.get(a.id)).find(isLoc) || null;
  const all = first ? slotsAt(first, nowMs) : [];
  const hour = all.length ? +first.time[nowIndex(first, nowMs)].slice(11, 13) : null;
  const def = hour != null && hour >= 15 ? "d1" : "now";
  const when = all.some((s) => s.id === input.when) ? input.when : all.some((s) => s.id === def) ? def : all[0]?.id ?? input.when ?? def;
  const slot = all.find((s) => s.id === when) || null;
  const slots = all.map((s) => ({ id: s.id, label: s.label, sub: s.sub, ariaLabel: `${s.label}${s.off >= 2 ? `, ${s.sub}` : ""}` }));

  // Early season (Ski): half or more of the Washington stations under 12 in.
  const depths = mode === "ski" ? wa.map((a) => stationDepth(input, a)).filter((d) => d != null) : [];
  const earlySeason = depths.length > 0 && depths.filter((d) => d < PICK.baseIn).length / depths.length >= 0.5;

  const lines = new Map(mode === "hike" ? wa.map((a) => [a.id, lineFor(input, a)]) : []);
  if (mode === "hike") pending = pending || wa.some((a) => { const p = rankPoint(a, "hike", places); return p && !isLoc(input.freeze?.(p.key)) && wait("freeze", p.key); });

  // Top 3: Washington areas, the selected slot, the Best rule.
  const entries = slotEntries(wa, locs, slot, nowMs, mode);
  const early = !!slot && dayIsEarly(entries);
  const top = slot ? rank(entries, mode) : [];
  const picks = top.map((e, i) => {
    const { a, m, r } = e, s = r.s, pt = rankPoint(a, mode, places);
    const key = skyKey(m), hi = m.hi ? Math.round(m.hi.value) : null;
    const at = spotLabel({ mode: "x" }, pt) || fmtFt(pt.elev_ft);
    const where = /ft$/.test(at) ? at : `${at}, ${fmtNum(pt.elev_ft)} ft`;
    const st = mode === "hike" ? snowTag(lines.get(a.id)) : null;
    const tags = mode === "hike" ? [st?.fact].filter(Boolean) : skiTags(m);
    const window = r.line;
    const flag = flagText(flagsFor(input, a, slot, earlySeason), slot);
    const tagA = mode === "hike" ? (st ? ` ${spoken(st.fact)} ${st.advice}` : "") : tags.length ? ` ${tags.join(", ")}.` : "";
    return {
      area: a, rank: i + 1, isBest: i === 0, key, hi, where, tags, reason: shortReason(mode, m), advice: st?.advice ?? null,
      window, flag, aval: input.aval?.(placeFor(a, mode, places)) ?? null, gust: m.gust ? Math.round(m.gust.value) : null,
      ariaLabel: `${a.name}${i === 0 ? ", best place" : ""}: ${WX_LABEL[key] || "no data"}, high ${hi ?? "unknown"} degrees, ${longReason(mode, m, s)}, at ${where}.${tagA}${window ? ` ${spoken(window)}.` : ""}${flag ? ` ${flag}.` : ""} Open`,
    };
  });
  const allLoaded = wa.every((a) => !rankPoint(a, mode, places) || isLoc(locs.get(a.id)));
  const picksNote = !slot || !allLoaded ? null
    : picks.length === 0 ? "Every area has rain in this window. Rain never gets Best. Try another day."
      : picks.length < 3 ? `Only ${picks.length === 1 ? "one area passes" : `${picks.length} areas pass`} without rain here.` : null;
  const rankRule = `Ranked by the Best rule: the driest place, then the sunniest${slot && slot.off >= 1 ? ", 8 AM to 5 PM" : ""}. Snow beats rain. A rainy place never ranks.`;

  // All places, Areas: Starred, the Washington groups, then (Ski) the region groups.
  const row = (a) => {
    const pt = rankPoint(a, mode, places), loc = locs.get(a.id), g = glanceAt(loc, pt, nowMs);
    const rb = rowBest(loc, mode, nowMs, slot ? all[0].ymd : null), best = rb?.text ?? null;
    const tag = mode === "hike" ? snowTag(lines.get(a.id))?.fact ?? null : null;
    const flag = flagText(flagsFor(input, a, slot, earlySeason), slot);
    const d = milesTo(input.pos, areaPoint(a, places)), mi = d == null ? null : Math.round(d), sub = areaSub(a, places);
    return {
      area: a, sub, glance: g, best, bestLines: rb?.lines ?? null, flag, tag, mi, star: starred.has(a.id),
      ariaLabel: `${a.name}${sub ? `, ${sub}` : ""}. ${glanceAria(g)}.${best ? ` ${spoken(best)}.` : ""}${tag ? ` ${spoken(tag)}` : ""}${flag ? ` ${flag}.` : ""}${mi == null ? "" : ` ${mi} miles away.`} Open`,
    };
  };
  const byGroup = new Map();
  for (const a of wa) { if (!byGroup.has(a.group)) byGroup.set(a.group, []); byGroup.get(a.group).push(a); }
  let groups = [...byGroup.entries()];
  if (mode === "ski") {
    const far = shown.filter((a) => a.far), names = [...new Set(far.map((a) => a.group))];
    const order = [...REGION_ORDER.filter((n) => names.includes(n)), ...names.filter((n) => !REGION_ORDER.includes(n))];
    groups = groups.concat(order.map((n) => [n, far.filter((a) => a.group === n)]));
  }
  const pointOf = (a) => areaPoint(a, places);
  groups = sortByDistance(groups, input.pos, pointOf);
  const stars = shown.filter((a) => starred.has(a.id));
  if (stars.length) groups = [["Starred", sortByDistance([["Starred", stars]], input.pos, pointOf)[0][1]], ...groups];
  const areaGroupsOut = groups.map(([name, l]) => ({ name, rows: l.map(row) }));

  let resorts = null;
  if (list === "resorts") {
    resorts = resortGroups(input);
    pending = pending || areas.some((a) => a.resorts.some((id) => {
      const p = places[id];
      const mid = midOf(p)?.key;
      return p && ((!isLoc(input.glance?.(mid)) && wait("glance", mid)) || p.points.some((x) => (x.role === "Base" || x.role === "Top") && !isLoc(input.bands?.(x.key)) && wait("bands", x.key)));
    }));
  }

  return { mode, when, whenWord: slot ? slotWord(slot) : null, slots, early, rankRule, picks, picksNote, earlySeason, list, sorted: !!input.pos,
    groups: areaGroupsOut, resortGroups: resorts, pending };
}

/* ---------- the TLDR (Plan 3) ---------- */
// One slot's Top 3 candidates: every Washington area with numbers for the slot, in the shape best.js rank reads. The
// landing and bestAhead both build them here, so the TLDR's Best and the Top 3 read the same numbers and the same closed rule.
function slotEntries(wa, locs, slot, nowMs, mode) {
  const out = [];
  if (slot) for (const a of wa) {
    const loc = locs.get(a.id), r = readSlot(loc, slot, nowMs, mode);
    if (r?.m) out.push({ id: a.id, m: r.m, offset: slot.off, closed: r.closed, early: earlyLook(r.m, slot.off), a, loc, r });
  }
  return out;
}

// The TLDR's Best (Plan 3; Scott, 2026-11-07: the #1 pick on the best of the next 3 days). The days are the landing's day
// slots the weather window reaches: Tomorrow through profile(mode).days - 1 days out (the landing has no Today slot, and a
// later day has no window to name). best.js slotBest picks the day (class, then sun, of each day's top 3, then the sooner
// day); the pick is that day's first entry, the same entry the landing's Top 3 shows first with that day selected.
// { slot, area, m, w } (w: that day's weatherWindow) or null when no day has a scoring area.
export function bestAhead(input) {
  const { mode, nowMs, areas } = input;
  const shown = areasFor(areas, mode), wa = shown.filter((a) => !a.far);
  const locs = new Map(shown.map((a) => [a.id, locAt(input, a)]));
  const first = shown.map((a) => locs.get(a.id)).find(isLoc) || null;
  if (!first) return null;
  const days = slotsAt(first, nowMs).filter((s) => s.off >= 1 && s.off < profile(mode).days);
  const byDay = days.map((slot) => ({ ymd: slot.ymd, offset: slot.off, slot, entries: slotEntries(wa, locs, slot, nowMs, mode) }));
  const b = slotBest(byDay, mode);
  if (!b) return null;
  const e = b.top[0];
  return { slot: byDay.find((d) => d.ymd === b.ymd).slot, area: e.a, m: e.m, w: e.r.w };
}

// Snow coming (Plan 3; Scott, 2026-11-07): the Washington resort the Resorts view lists first (most new snow in the next
// 5 days at its middle point, resortRow and its sort) and the Washington area whose backcountry gets the most in the same
// 5 days. An area's backcountry is its Ski place when that is not a resort (its NWAC zone, or the hike stand-in the place
// view's Backcountry section reads), at its ranking point: the point its row, its week and the Top 3 read. Its total is the
// same sum of the first 5 daily bars (vm.js skiRowZ: the rest of today, then 4 whole days) that resortRow makes, so the two
// numbers compare. ft: the height of that point (the resort's middle point, the area's ranking point), so the two amounts
// read as two heights, not a contradiction (Scott, 2026-11-07). by: the weekday of the 5th day. Each side null when nothing
// loaded; ties keep the list order.
export function snowComing(input) {
  const { areas, places, nowMs } = input;
  const byFive = (loc) => { const n = isLoc(loc) ? nowIndex(loc, nowMs) : -1; return n >= 0 ? dow(addDays(loc.time[n].slice(0, 10), 4)) : null; };
  const wash = resortGroups({ ...input, pos: null }).find((g) => g.name === "Washington");
  const top = wash?.rows.find((r) => r.t5 != null) ?? null;
  let resort = null;
  if (top) {
    const place = places[top.resort.id], mid = midOf(place);
    resort = { area: top.area, place, name: top.resort.name, t5: top.t5, ft: mid.elev_ft, by: byFive(input.glance?.(mid.key) ?? null) };
  }
  let backcountry = null;
  for (const a of areas.filter((x) => !x.far)) {
    const pl = skiPlace(a, places), pt = rankPoint(a, "ski", places);
    if (!pl || pl.mode === "resort" || !pt) continue;
    const loc = input.glance?.(pt.key) ?? null;
    const z = isLoc(loc) ? skiRowZ(pl, loc, nowMs, null).glance : null;
    if (!z || z.unavailable) continue;
    const t5 = z.bars.slice(0, 5).reduce((x, y) => x + y, 0);
    if (!backcountry || t5 > backcountry.t5) backcountry = { area: a, place: pl, name: a.name, t5, ft: pt.elev_ft, by: byFive(loc) };
  }
  return { resort, backcountry };
}
