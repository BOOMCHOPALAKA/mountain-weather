// page/app.js
// The v3 page (Weather Window): state, routing, events and fetching. View-models come from guide.js (the landing) and
// place.js (the place view); HTML strings from ui.js. Ported from mock/v3/index.html (state, routing, events) onto the
// v2 page's fetching: every Open-Meteo request comes from planRequests (weight <= 300), cached 30 minutes, at most 2 in
// flight, and the landing's forecasts stay on the device 24 hours as a fallback, shown with a notice when Open-Meteo refuses.
// Program R7: a mode open loads that activity's landing only; the Resorts view loads its rows on first selection; a place
// view loads its own points.
// Privacy (mock round 13): S.pos, the viewer's position for Sort by distance, is read on a tap only and held in memory for
// this page. It is never stored, never sent in any request, never put in the URL or the history state.
import { makeNet, limitOf } from "./net.js";
import { planRequests } from "./engine/request.js";
import { PROFILES } from "./engine/models.js";
import { parseForecast } from "./engine/parse.js";
import { mapLayerUrl, productUrl } from "./engine/avalanche.js";
import { snotelUrl, parseSnotel } from "./engine/snotel.js";
import { resortSeason } from "./engine/picks.js";
import { areaIndex, landingPoints, resortPoints, allResorts, placePoints, skiPlace, hikePlace } from "./engine/areas.js";
import { avalFor, depthReading, zonesFrom, zoneExpired, forecastNotice } from "./vm.js";
import { landing } from "./guide.js";
import { placeView, tabFor } from "./place.js";
import * as UI from "./ui.js";

const MODES = ["ski", "hike"];
const OLD_SKI = ["resorts", "backcountry"];   // v2 hashes and saved views
const CENTERS = ["NWAC", "COAA", "IPAC"];
const KEEP_MODE_MS = 14 * 86400000;
const CACHE_TTL_MIN = 30;   // every cached request on this page
const LAST_GOOD_MIN = 24 * 60;   // how long a landing forecast stays usable as a fallback
const OM_TIMEOUT_MS = 20000;   // Open-Meteo multi-point requests can take a while
const STALE_ON_RETURN_MS = 30 * 60000;
const GEO_TIMEOUT_MS = 10000;
// Never evicted. The v2 keys stay so mw2:starred is kept in place (the v3 stars are migrated from it, not moved).
const PREF_KEYS = ["mw2:mode", "mw2:areas-starred", "mw2:starred", "mw2:view", "mw2:sub", "mw2:open"];
const GEO_NO_API = "Couldn't get your location. This browser can't share one.";
const GEO_FAILED = "Couldn't get your location. It may be blocked here or timed out.";
const $ = (s) => document.querySelector(s);
const fin = (x) => typeof x === "number" && Number.isFinite(x);
const clock = (ms) => (fin(ms) ? new Date(ms).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" }) : null);
const pstDay = (ms) => new Date(ms - 8 * 3600000).toISOString().slice(0, 10);   // SNOTEL runs on station standard time
const localYmd = (ms) => { const d = new Date(ms); return new Date(ms - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };

/* ---------- storage, guarded ---------- */
const LS = {
  get(k) { try { return JSON.parse(globalThis.localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { globalThis.localStorage.setItem(k, JSON.stringify(v)); } catch { /* blocked */ } },
};

/* ---------- state ---------- */
const net = makeNet();
const S = {
  P: null, areas: [], byArea: {}, places: {}, cams: null, now: Date.now(), gen: 0,
  mode: null, when: null, list: "areas", starred: new Set(),
  // The viewer's position, only after a tap on Sort by distance. Memory only (see the header).
  pos: null, geoMsg: "", geoBusy: false,
  open: null, openedFrom: null, tab: "forecast", tabKeys: [], elev: null, day: null, detail: new Set(), cloudDetail: false, camsAt: null,
  glance: new Map(), freeze: new Map(), bands: new Map(), stations: new Map(), cards: new Map(),
  layers: null, layersP: null, layersAt: null, brief: null, briefP: null, stationsP: null,
  loading: new Set(), hashes: new Map(), seen: new Set(), lastGood: new Set(), force: new Set(), lastGoodAt: null, triedAt: 0,
};

/* ---------- fetching (v2 rules) ---------- */
let omActive = 0;
const omQueue = [];
function omSlot(fn) {   // at most 2 Open-Meteo requests in flight across the page
  return new Promise((res, rej) => {
    const run = async () => {
      omActive++;
      try { res(await fn()); } catch (e) { rej(e); } finally { omActive--; if (omQueue.length) omQueue.shift()(); }
    };
    if (omActive < 2) run(); else omQueue.push(run);
  });
}
// One request per URL at a time: a second ask while the first is in flight (Refresh in the middle of a load) shares it.
const inflight = new Map();
function getJson(url, ttl = CACHE_TTL_MIN, opts = {}) {
  S.seen.add(url);
  if (opts.lastGoodMin) S.lastGood.add(url);
  if (inflight.has(url)) { S.force.delete(url); return inflight.get(url); }
  const p = net.cachedJson(url, ttl, { ...opts, force: S.force.delete(url) }).then((r) => {
    if (r.data && r.data.error === true) throw new Error(r.data.reason || "error body");
    return r;
  }).finally(() => inflight.delete(url));
  inflight.set(url, p);
  return p;
}
// One forecast request; each requested point lands in `into` by key. Never throws to the caller's pool twice.
// gen: the load generation the job was made in. A job still queued when Refresh starts a new one never runs.
async function forecast(req, profile, into, keep, gen) {
  const P = PROFILES[profile];
  try {
    const get = () => getJson(req.url, CACHE_TTL_MIN, { timeoutMs: OM_TIMEOUT_MS, ...(keep ? { lastGoodMin: LAST_GOOD_MIN } : {}) });
    // The same URL already in flight (Refresh in the middle of a load): share it now, do not queue for a slot behind it.
    const { at, data, saved, reason } = await (inflight.has(req.url) ? get() : omSlot(() => {
      if (gen !== S.gen) throw new Error("replaced by Refresh");
      return get();
    }));
    const locs = parseForecast(data, P.models, P.hourly);   // rule 7: the requested model list
    const extra = saved ? { saved: true, limit: limitOf(reason) } : {};
    req.points.forEach((p, i) => into.set(p.key, locs[i] && locs[i].time.length ? { status: "ok", loc: locs[i], at, ...extra } : { status: "error" }));
  } catch (e) {
    req.points.forEach((p) => into.set(p.key, { status: "error", limit: limitOf(e && e.message) }));
    throw e;
  } finally { schedule(); }
}
const needs = (map, pts) => pts.filter((p) => p && (!map.has(p.key) || map.get(p.key).status === "error"));
function forecastJobs(pts, profile, into, keep = false) {
  const todo = needs(into, pts);
  todo.forEach((p) => into.set(p.key, { status: "loading" }));
  const gen = S.gen;
  return planRequests(todo, profile).map((req) => () => forecast(req, profile, into, keep, gen));
}
const runJobs = (jobs) => net.pool(jobs, 2, (job) => job());
const locOf = (map, key) => (map?.get(key)?.status === "ok" ? map.get(key).loc : null);
const getter = (map) => (key) => locOf(map, key);
// Still loading, as the view-models need it to tell "Loading" from a failed load: no entry yet (asked for, not started)
// or an entry marked loading. A failed point is not loading.
const waiting = (map, key) => { const e = map?.get(key); return !e || e.status === "loading"; };

function loadLayers() {
  if (!S.layersP) {
    const gen = S.gen;
    S.layersP = net.pool(CENTERS, 3, (c) => getJson(mapLayerUrl(c))).then((res) => {
      if (gen !== S.gen) return;
      const ok = res.filter((x) => x.ok);
      S.layers = ok.map((x) => x.value.data);
      S.layersAt = ok.length ? Math.min(...ok.map((x) => x.value.at)) : null;
      schedule();
    });
  }
  return S.layersP;
}
function loadBrief() {
  if (!S.briefP) {
    const gen = S.gen;
    S.briefP = net.fetchJson("brief.json").then((b) => {
      const at = Date.parse(b?.at || "");
      if (gen === S.gen) S.brief = Number.isFinite(at) && Date.now() - at <= 6 * 3600000 && Date.now() >= at - 600000 ? { ...b, atMs: at } : null;
    }).catch(() => { if (gen === S.gen) S.brief = null; }).finally(schedule);
  }
  return S.briefP;
}
// The Washington areas' snow stations (Hike snow line; Ski early season and thin snow), both modes: one hourly and one
// daily request for all of them, once per page load or Refresh.
function loadStations() {
  if (!S.stationsP) {
    const into = S.stations;
    const sts = [...new Map(S.areas.filter((a) => !a.far).map((a) => hikePlace(a, S.places)?.snotel?.[0]).filter(Boolean).map((s) => [s.triplet, s])).values()];
    const trips = sts.map((s) => s.triplet);
    trips.forEach((t) => into.set(t, { status: "loading" }));
    const now = Date.now();
    const rows = (dur, from, to, el) => getJson(snotelUrl(trips, dur, from, to, el)).then((r) => parseSnotel(r.data)).catch(() => null);
    S.stationsP = !trips.length ? Promise.resolve() : Promise.all([
      rows("HOURLY", pstDay(now - 36 * 3600000), `${pstDay(now)} 23:59`, ["TOBS", "SNWD"]),
      rows("DAILY", pstDay(now - 2 * 86400000), pstDay(now), ["SNWD", "WTEQ"]),
    ]).then(([hourly, daily]) => {
      trips.forEach((t) => into.set(t, hourly || daily ? { status: "ok", hourly: hourly?.[t] || [], daily: daily?.[t] || [] } : { status: "error" }));
      schedule();
    });
  }
  return S.stationsP;
}
// R7: the selected activity's landing only. Hike adds the freezing level at the same points (the snow line).
async function loadMode(mode) {
  if (S.loading.has(mode)) return;
  const loading = S.loading;
  loading.add(mode);
  try {
    const pts = landingPoints(S.areas, mode, S.places);
    const jobs = [...forecastJobs(pts, "glance", S.glance, true), ...(mode === "hike" ? forecastJobs(pts, "freeze", S.freeze, true) : [])];
    await Promise.all([runJobs(jobs), loadLayers(), loadStations(), loadBrief()]);
  } finally { loading.delete(mode); schedule(); }
}
// The Resorts view, on its first selection: every resort's Mid glance and its Base and Top on the bands profile. No memo:
// forecastJobs skips points loaded or loading, so choosing Resorts again only retries the ones that failed.
function loadResorts() {
  const { mids, bands } = resortPoints(allResorts(S.areas), S.places);
  return runJobs([...forecastJobs(mids, "glance", S.glance, true), ...forecastJobs(bands, "bands", S.bands, true)]).finally(schedule);
}
function ensureLoads() {
  loadMode(S.mode);
  if (S.mode === "ski" && S.list === "resorts") loadResorts();
}
// A place view: detail, clouds and aloft at every spot (both activities, so the Ski | Hike switch needs no new load),
// the resort rows, SNOTEL daily and hourly for the Ski place's first station, the avalanche product when rated.
async function loadCard(area) {
  const have = S.cards.get(area.id);
  if (have && have.status !== "error") return;
  const c = { status: "loading", detail: new Map(), clouds: new Map(), aloft: new Map(), snotel: null, product: null };
  S.cards.set(area.id, c);
  schedule();
  const pp = placePoints(area, S.places);
  const jobs = [...forecastJobs(pp.spots, "detail", c.detail), ...forecastJobs(pp.spots, "clouds", c.clouds), ...forecastJobs(pp.spots, "aloft", c.aloft),
    ...forecastJobs(pp.mids, "glance", S.glance), ...forecastJobs(pp.bands, "bands", S.bands)];
  const sp = skiPlace(area, S.places), bc = sp && sp.mode !== "resort" ? sp : null;
  const st = bc?.snotel?.[0] || null, now = Date.now();
  const snow = st ? Promise.all([
    getJson(snotelUrl([st.triplet], "DAILY", pstDay(now - 9 * 86400000), pstDay(now), ["SNWD", "WTEQ"])).then((r) => parseSnotel(r.data)[st.triplet] || []).catch(() => []),
    getJson(snotelUrl([st.triplet], "HOURLY", pstDay(now - 36 * 3600000), `${pstDay(now)} 23:59`, ["TOBS", "SNWD"])).then((r) => parseSnotel(r.data)[st.triplet] || []).catch(() => []),
  ]).then(([daily, hourly]) => { c.snotel = { station: st, daily, hourly }; }) : Promise.resolve();
  const prod = bc ? loadLayers().then(async () => {
    const a = S.layers ? avalFor(bc, S.layers, Date.now()) : null;
    if (!(a && a.l >= 1 && bc.avalanche?.zone != null)) return;
    try { c.product = (await getJson(productUrl(bc.avalanche.center, bc.avalanche.zone))).data; } catch { c.product = null; }
  }) : Promise.resolve();
  await Promise.all([runJobs(jobs), snow, prod]);
  c.status = [...c.detail.values()].some((x) => x.status === "ok") ? "ok" : "error";
  schedule();
}

/* ---------- view-model inputs ---------- */
const avalOf = (place) => (place && S.layers ? avalFor(place, S.layers, S.now) : null);
function depthOf(triplet) {
  const s = S.stations.get(triplet);
  return s?.status === "ok" ? depthReading(s, S.now) : null;
}
function landingModel() {
  return landing({
    areas: S.areas, places: S.places, mode: S.mode, nowMs: S.now, when: S.when, list: S.list, starred: S.starred,
    pos: S.pos,
    glance: getter(S.glance), freeze: getter(S.freeze), bands: getter(S.bands), depth: depthOf, aval: avalOf,
    loading: (kind, key) => waiting(S[kind], key),
  });
}
function placeModel(area) {
  const c = S.cards.get(area.id);
  return placeView({
    area, mode: S.mode, places: S.places, nowMs: S.now,
    glance: getter(S.glance), freeze: getter(S.freeze), bands: getter(S.bands),
    card: { detail: getter(c?.detail), clouds: getter(c?.clouds), aloft: getter(c?.aloft) },
    snotel: c?.snotel || null, product: c?.product || null, layers: S.layers, cams: S.cams, depth: depthOf,   // layers null: still loading
    loading: (kind, key) => waiting(kind === "detail" ? c?.detail : S[kind], key),
  });
}
function briefFor(mode) {
  const b = S.brief, text = b && b[mode];
  return typeof text === "string" && text.trim() ? { text, atText: clock(b.atMs) } : null;
}

/* ---------- rendering: swap only what changed, never drop focus to <body> ---------- */
const hash = (s) => { let h = 5381; const n = s.replace(/tip-\d+/g, ""); for (let i = 0; i < n.length; i++) h = (h * 33) ^ n.charCodeAt(i); return h >>> 0; };
const FOCUS_KEYS = ["data-open", "data-star", "data-when", "data-list", "data-sortgeo", "data-pvmode", "data-tab", "data-goto", "data-day", "data-detail", "data-elev", "data-clouddetail"];
// The focused control inside root, as a way to find its twin in the new markup: by its data key (and which of the matches
// it was: a starred area's row appears twice), else by its tag and class among its kind.
function focusSpot(root) {
  const a = document.activeElement;
  if (!root || !a || a === document.body || a === root || !root.contains(a)) return null;
  const k = FOCUS_KEYS.find((x) => a.hasAttribute(x));
  const sel = k ? `${a.tagName.toLowerCase()}[${k}="${CSS.escape(a.getAttribute(k))}"]` : a.tagName.toLowerCase() + (a.classList[0] ? `.${CSS.escape(a.classList[0])}` : "");
  const i = [...root.querySelectorAll(sel)].indexOf(a);
  return (el) => { const all = el.querySelectorAll(sel); return all[i] || all[0] || null; };
}
const openTips = (root) => [...root.querySelectorAll(".info")].map((b, i) => (b.getAttribute("aria-expanded") === "true" ? i : -1)).filter((i) => i >= 0);
function reopenTips(root, idx) {
  const bs = root.querySelectorAll(".info");
  for (const i of idx) {
    const b = bs[i], p = b && document.getElementById(b.getAttribute("aria-controls"));
    if (b && p) { b.setAttribute("aria-expanded", "true"); p.hidden = false; }
  }
}
// Replace el's content when its markup changed. A focused control comes back on its twin; when it has none (a "Loading"
// state), focus goes to `fallback` (a container the script can focus), never to <body>, and moves on to the twin when a
// later swap brings it back while focus still sits on the fallback.
const lost = new Map();
function swap(key, el, html, fallback = el) {
  if (!el) return false;
  const h = hash(html);
  if (S.hashes.get(key) === h) return false;
  const spot = focusSpot(el), tips = openTips(el);
  const again = !spot && lost.has(key) && document.activeElement === fallback ? lost.get(key) : null;
  el.innerHTML = html;
  reopenTips(el, tips);
  const want = spot || again, t = want && want(el);
  if (t) { t.focus({ preventScroll: true }); lost.delete(key); }
  else if (spot) { fallback?.focus({ preventScroll: true }); lost.set(key, spot); }
  S.hashes.set(key, h);
  return true;
}
function shell() {
  if ($("#guide-slot")) return;
  // geo-live: the Sort by distance status, one live region that stays put while #places-slot is swapped around it.
  $("#main").innerHTML = '<div id="brief-slot"></div><div id="guide-slot" tabindex="-1"></div><p class="vh" id="geo-live" role="status"></p><div id="places-slot" tabindex="-1"></div>';
  S.hashes.clear();
}
function renderMain() {
  if (!S.P || !S.mode) return;
  S.now = Date.now();
  shell();
  document.querySelectorAll(".seg [data-mode]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === S.mode)));
  const m = landingModel();
  swap("brief", $("#brief-slot"), UI.tldr(briefFor(S.mode), S.mode));
  swap("guide", $("#guide-slot"), UI.guide(m));
  swap("places", $("#places-slot"), UI.placesList(m, { geoMsg: S.geoMsg, liveOutside: true }));
  const live = $("#geo-live");
  if (live.textContent !== S.geoMsg) live.textContent = S.geoMsg;   // updated in place, never re-created
  updateAsOf();
}
const pv = $("#pv");
function renderPV() {
  const area = S.byArea[S.open];
  if (!area) return;
  S.now = Date.now();
  const v = placeModel(area);
  const h = UI.placeHeader(v, { id: area.id, star: S.starred.has(area.id), tab: S.tab });
  S.tab = h.tab;
  S.tabKeys = v.tabs.map(([k]) => k);
  const back = $("#pv-back");
  swap("pv-mode", $("#pv-mode"), h.mode, back);
  swap("pv-h", $("#pv-h"), h.title);   // title and sub arrive escaped (ui.js placeHeader)
  swap("pv-pill", $("#pv-pill"), h.pill, back);
  swap("pv-avy", $("#pv-avy"), h.avy, back);
  $("#pv-avy").hidden = h.avyHidden;
  swap("pv-star", $("#pv-star"), h.star, back);
  swap("pv-sub", $("#pv-sub"), h.sub);
  swap("pv-tabs", $("#pv-tabs"), h.tabs, back);
  const panel = $("#pv-panel");
  panel.setAttribute("aria-labelledby", h.labelledBy);
  swap("pv-panel", panel, UI.tabBody(v, h.tab, { id: area.id, elev: S.elev, day: S.day, detail: S.detail, cloudDetail: S.cloudDetail, camsAt: S.camsAt }), panel);
}
const PV_KEYS = ["pv-mode", "pv-h", "pv-pill", "pv-avy", "pv-star", "pv-sub", "pv-tabs", "pv-panel"];
function freshPV() { for (const k of PV_KEYS) S.hashes.delete(k); renderPV(); $("#pv-body").scrollTop = 0; }

let pending = false;
function schedule() {
  if (pending || !S.mode) return;
  pending = true;
  requestAnimationFrame(() => { pending = false; renderMain(); if (S.open && pv.open) renderPV(); });
}

/* ---------- the as-of line, the saved tag and the notice (v2) ---------- */
function onScreen() {
  const pts = landingPoints(S.areas, S.mode, S.places);
  const gs = pts.map((p) => S.glance.get(p.key));
  if (S.mode === "hike") gs.push(...pts.map((p) => S.freeze.get(p.key)));
  if (S.mode === "ski" && S.list === "resorts") {
    const r = resortPoints(allResorts(S.areas), S.places);
    gs.push(...r.mids.map((p) => S.glance.get(p.key)), ...r.bands.map((p) => S.bands.get(p.key)));
  }
  return { glance: pts.map((p) => S.glance.get(p.key)), all: gs };
}
// Never "Loading…" once every request has settled: a total failure says so, with the last good time if there was one.
function updateAsOf() {
  const { glance, all } = onScreen();
  const ats = glance.map((g) => g?.at).filter(fin);
  if (ats.length) {
    S.lastGoodAt = Math.min(...ats);
    $(".asof-t").textContent = `${glance.some((g) => g?.saved) ? "saved forecast from" : "as of"} ${clock(S.lastGoodAt)}`;
  } else if (S.loading.has(S.mode) || !glance.length || glance.some((g) => !g || g.status === "loading")) {
    $(".asof-t").textContent = "Loading…";
  } else {
    $(".asof-t").textContent = S.lastGoodAt ? `Forecast unavailable · last loaded ${clock(S.lastGoodAt)}` : "Forecast unavailable";
  }
  const note = forecastNotice(all, clock), el = $("#notice");
  el.textContent = note || "";
  el.hidden = !note;
  const savedAt = all.filter((g) => g?.saved).map((g) => g.at).filter(fin), tag = $("#saved-tag");
  tag.textContent = savedAt.length ? `Saved forecast from ${clock(Math.min(...savedAt))}` : "";
  tag.hidden = !savedAt.length;
}
function oldestOnScreen() {
  const ats = onScreen().all.map((g) => g?.at).filter(fin);
  if (fin(S.layersAt)) ats.push(S.layersAt);
  return ats.length ? Math.min(...ats) : null;
}

/* ---------- routing: #ski, #hike, #ski/<area>/<tab> (old #resorts and #backcountry go to #ski) ---------- */
let pushed = false, back = null;
function hashFor() { return `#${S.mode}${S.open ? `/${S.open}/${S.tab}` : ""}`; }
function readHash() {
  const [m, p, t] = location.hash.slice(1).split("/");
  const mode = MODES.includes(m) ? m : OLD_SKI.includes(m) ? "ski" : null;
  return { mode, open: mode && p && S.byArea[p] ? p : null, tab: t || "forecast" };
}
function setMode(mode, { save = true } = {}) {
  if (save) LS.set("mw2:mode", { mode, at: Date.now() });
  if (mode === S.mode) return;
  S.mode = mode;
  S.when = null;
}
// Where focus goes back to when the place view closes: the control that opened it, or its twin after a re-render.
function rememberOpener() {
  const a = document.activeElement;
  const id = a?.getAttribute?.("data-open");
  if (!id) return { el: a && a !== document.body ? a : null };
  const sel = `.${CSS.escape(a.classList[0] || "prow-btn")}[data-open="${CSS.escape(id)}"]`;
  return { el: a, sel, i: [...document.querySelectorAll(`#main ${sel}`)].indexOf(a), id };
}
function returnFocus() {
  const b = back;
  back = null;
  let t = b?.el && document.contains(b.el) ? b.el : null;
  if (!t && b?.sel) { const all = document.querySelectorAll(`#main ${b.sel}`); t = all[b.i] || all[0] || null; }
  if (!t && b?.id) t = document.querySelector(`#main [data-open="${CSS.escape(b.id)}"]`);
  (t || $("#main [data-open]") || $("#places-slot"))?.focus({ preventScroll: !!t });
}
function showPV() {
  if (pv.open) return;
  pv.showModal();
  document.body.classList.add("locked");
  $("#pv-back").focus();
}
// An area outside Washington is Ski only: a Hike hash for one shows the Ski view and the hash says so.
function farToSki(area) {
  if (!area.far || S.mode !== "hike") return false;
  setMode("ski", { save: false });
  ensureLoads();
  renderMain();
  return true;
}
function resetPV() { S.elev = null; S.day = null; S.detail = new Set(); S.cloudDetail = false; S.camsAt = clock(Date.now()); }
function openPlace(id, tab = "forecast") {
  const area = S.byArea[id];
  if (!area) return;
  back = rememberOpener();
  if (farToSki(area)) history.replaceState(null, "", hashFor());   // S.open is still null: the entry under the view says #ski
  S.openedFrom = S.mode;
  S.open = id;
  resetPV();
  S.tab = tabFor(area.far ? "ski" : S.mode, tab);
  history.pushState(null, "", hashFor()); pushed = true;
  loadCard(area);
  freshPV();
  showPV();
}
function closePlace() {
  if (pushed) { pushed = false; history.back(); return; }
  S.open = null; history.replaceState(null, "", hashFor()); pv.close();
}
pv.addEventListener("close", () => {
  document.body.classList.remove("locked");
  if (S.open) { S.open = null; history.replaceState(null, "", hashFor()); }
  returnFocus();
});
let tipClosed = false;
pv.addEventListener("cancel", (e) => { e.preventDefault(); if (tipClosed) { tipClosed = false; return; } closePlace(); });
window.addEventListener("popstate", () => {
  pushed = false;
  const h = readHash();
  if (!h.open && pv.open && S.open) {
    // Closing by Back, Escape or browser Back: the entry under the view still holds the mode it opened from. The mode
    // chosen inside the view stays (the landing and mw2:mode already follow it). A typed hash with another mode switches.
    if (h.mode && h.mode !== S.openedFrom && h.mode !== S.mode) { setMode(h.mode, { save: false }); ensureLoads(); renderMain(); }
    S.open = null;
    history.replaceState(null, "", hashFor());
    pv.close();
    return;
  }
  if (h.mode && h.mode !== S.mode) { setMode(h.mode, { save: false }); ensureLoads(); renderMain(); }
  if (!h.open) { S.open = null; if (pv.open) pv.close(); return; }
  const area = S.byArea[h.open];
  farToSki(area);
  if (!pv.open || S.open !== h.open) {   // Forward into a place view: its row gets focus back on close
    if (!pv.open) { back = { id: h.open }; S.openedFrom = S.mode; }
    resetPV();
  }
  S.open = h.open;
  S.tab = tabFor(area.far ? "ski" : S.mode, h.tab);
  if (location.hash !== hashFor()) history.replaceState(null, "", hashFor());   // a bad tab or a Hike hash for a Ski-only area
  loadCard(area);
  freshPV();
  showPV();
});

/* ---------- events (mock 918282a) ---------- */
function selectTab(k, focus = false) {
  S.tab = k;
  history.replaceState(null, "", hashFor());
  freshPV();
  if (focus) document.getElementById(`tab-${k}`)?.focus();
}
function renderPlaces(focusSel) {
  renderMain();
  if (focusSel) document.querySelector(focusSel)?.focus();
}
function sortByDistance() {
  if (S.pos) { S.pos = null; S.geoMsg = ""; renderPlaces("[data-sortgeo]"); return; }
  const geo = globalThis.navigator?.geolocation;
  if (!geo) { S.geoMsg = GEO_NO_API; renderPlaces("[data-sortgeo]"); return; }
  if (S.geoBusy) return;
  S.geoBusy = true;
  // One read on this tap, kept in memory only (see S.pos). Never watched, never stored, never sent.
  geo.getCurrentPosition(
    (p) => { S.geoBusy = false; S.pos = { lat: p.coords.latitude, lon: p.coords.longitude }; S.geoMsg = ""; renderPlaces("[data-sortgeo]"); },
    () => { S.geoBusy = false; S.geoMsg = GEO_FAILED; renderPlaces("[data-sortgeo]"); },
    { timeout: GEO_TIMEOUT_MS });
}
function toggleTip(t) {
  const p = document.getElementById(t.getAttribute("aria-controls"));
  const on = t.getAttribute("aria-expanded") !== "true";
  t.setAttribute("aria-expanded", String(on));
  if (p) p.hidden = !on;
}
document.addEventListener("click", (e) => {
  const t = e.target.closest("button, a");
  if (!t) return;
  const d = t.dataset;
  if (t.classList.contains("info")) { toggleTip(t); return; }
  if (d.mode && t.closest(".top")) {
    if (d.mode === S.mode) return;
    setMode(d.mode);
    history.replaceState(null, "", hashFor());
    ensureLoads();
    renderMain();
    return;
  }
  // In the place view: same area, same tab when the other mode has it (Snow is Ski only), and the landing follows.
  if (d.pvmode) {
    if (t.disabled || d.pvmode === S.mode) return;
    setMode(d.pvmode);
    S.tab = tabFor(d.pvmode, S.tab);
    history.replaceState(null, "", hashFor());
    ensureLoads();
    renderMain();
    renderPV();
    document.querySelector(`#pv [data-pvmode="${d.pvmode}"]`)?.focus();
    return;
  }
  if (d.list) {
    S.list = d.list === "resorts" ? "resorts" : "areas";
    if (S.list === "resorts") loadResorts();
    renderPlaces(`[data-list="${S.list}"]`);
    return;
  }
  if (d.sortgeo) { sortByDistance(); return; }
  if (d.when) { S.when = d.when; renderPlaces(`[data-when="${CSS.escape(d.when)}"]`); return; }
  if (d.open) { openPlace(d.open); return; }
  if (d.star) {
    const id = d.star, inPV = !!t.closest("#pv");
    if (S.starred.has(id)) S.starred.delete(id); else S.starred.add(id);
    LS.set("mw2:areas-starred", [...S.starred]);
    renderMain();
    if (inPV) renderPV();
    document.querySelector(`${inPV ? "#pv " : "#main "}[data-star="${CSS.escape(id)}"]`)?.focus();
    return;
  }
  if (d.tab) { selectTab(d.tab, true); return; }
  if (d.goto) { selectTab(d.goto); $("#pv-panel").focus({ preventScroll: true }); return; }
  if (d.detail) {
    const id = d.detail, on = !S.detail.has(id);
    if (on) S.detail.add(id); else S.detail.delete(id);
    t.setAttribute("aria-expanded", String(on));
    t.querySelector(".dline-t").textContent = on ? "Hide" : "Details";
    document.getElementById(`dl-${id}`).hidden = !on;
    return;
  }
  if (d.clouddetail) {
    S.cloudDetail = !S.cloudDetail;
    t.setAttribute("aria-expanded", String(S.cloudDetail));
    t.firstChild.textContent = S.cloudDetail ? "Hide model detail" : "Model detail";
    document.getElementById("cl-detail").hidden = !S.cloudDetail;
    return;
  }
  if (d.day) {
    // the one allowed expand: AM, PM and Night under the tapped day; one day open at a time
    S.day = S.day === d.day ? null : d.day;
    document.querySelectorAll("#pv-panel [data-day]").forEach((b) => {
      const on = b.dataset.day === S.day;
      b.setAttribute("aria-expanded", String(on));
      b.setAttribute("aria-label", b.getAttribute("aria-label").replace(/\b(Show|Hide) (?=(morning|afternoon|night)\b)/, on ? "Hide " : "Show "));
      document.getElementById(b.getAttribute("aria-controls")).hidden = !on;
    });
    return;
  }
  if (d.elev) {
    S.elev = d.elev;
    const sec = t.closest(".elev-sec");
    sec.querySelectorAll("[data-elev]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.elev === d.elev)));
    sec.querySelectorAll("[data-spot]").forEach((s) => { s.hidden = s.dataset.spot !== d.elev; });
    return;
  }
  if (t.id === "pv-back") { closePlace(); return; }
  if (t.id === "refresh") refresh();
});
$("#pv-tabs").addEventListener("keydown", (e) => {   // ARIA tabs: arrows, Home and End move and select
  const keys = S.tabKeys, i = keys.indexOf(S.tab);
  const j = e.key === "ArrowRight" ? (i + 1) % keys.length : e.key === "ArrowLeft" ? (i - 1 + keys.length) % keys.length : e.key === "Home" ? 0 : e.key === "End" ? keys.length - 1 : -1;
  if (j < 0 || !keys.length) return;
  e.preventDefault();
  selectTab(keys[j], true);
});
document.addEventListener("keydown", (e) => {   // Escape closes an open tooltip first, and returns focus to its button
  if (e.key !== "Escape") return;
  const b = document.querySelector('.info[aria-expanded="true"]');
  if (!b) return;
  toggleTip(b);
  b.focus();
  e.preventDefault();
  if (pv.open) { tipClosed = true; setTimeout(() => { tipClosed = false; }, 0); }
}, true);
document.addEventListener("error", (e) => {   // a cam that fails to load says so instead of showing a broken image
  const img = e.target;
  if (img.tagName !== "IMG") return;
  const fig = img.closest(".cam"), tile = img.closest(".pc-cam");
  if (fig) { const a = img.closest("a"); if (a) a.replaceWith(Object.assign(document.createElement("p"), { className: "small muted", textContent: "Camera didn't load." })); }
  else if (tile) tile.replaceWith(Object.assign(document.createElement("span"), { className: "pc-tile small muted", textContent: "Camera didn't load." }));
}, true);

/* ---------- Refresh, return to the tab, compact header (v2) ---------- */
function refresh() {   // fetch again; a landing forecast stays on the device as the fallback until a new one replaces it
  if (!S.P) { location.reload(); return; }   // the place list never loaded: start over
  S.triedAt = Date.now();
  for (const u of S.seen) {
    if (S.lastGood.has(u)) S.force.add(u);
    else { try { globalThis.localStorage.removeItem(`mw2:${u}`); } catch { /* blocked */ } }
  }
  S.seen.clear();
  S.gen++;   // requests still in flight write into the old maps and promises, never the new ones
  S.glance = new Map(); S.freeze = new Map(); S.bands = new Map(); S.stations = new Map(); S.cards = new Map();
  S.loading = new Set();
  S.layers = null; S.layersP = null; S.layersAt = null; S.briefP = null; S.brief = null; S.stationsP = null;
  ensureLoads();
  renderMain();
  if (S.open) { loadCard(S.byArea[S.open]); renderPV(); }
}
// A phone tab reopened hours later: refetch when what's on screen is over 30 minutes old (or nothing loaded),
// and always re-render so time-based states (an expired avalanche rating) use the current clock.
function onReturn() {
  if (!S.P || !S.mode || document.visibilityState === "hidden") return;
  if (S.loading.has(S.mode)) { schedule(); return; }
  const oldest = oldestOnScreen();
  const stale = oldest == null || Date.now() - oldest > STALE_ON_RETURN_MS;
  // A saved forecast is always old, so a failed refresh waits the same 30 minutes before the next automatic try. The Refresh button still works.
  if (stale && Date.now() - S.triedAt > STALE_ON_RETURN_MS) refresh(); else schedule();
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") onReturn(); });
window.addEventListener("pageshow", (e) => { if (e.persisted) onReturn(); });
const top = $(".top");
let compact = false, ticking = false;
window.addEventListener("scroll", () => {   // hysteresis so the shrinking header never flickers
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => {
    ticking = false;
    const y = window.scrollY;
    if (!compact && y > 96) { compact = true; top.classList.add("compact"); }
    else if (compact && y < 24) { compact = false; top.classList.remove("compact"); }
  });
}, { passive: true });

/* ---------- start ---------- */
// v2 starred place ids, mapped once to every area whose hike, bc or resorts hold one. mw2:starred stays in place.
function loadStars() {
  const saved = LS.get("mw2:areas-starred");
  if (Array.isArray(saved)) return new Set(saved.filter((id) => S.byArea[id]));
  const old = new Set(Array.isArray(LS.get("mw2:starred")) ? LS.get("mw2:starred") : []);
  const ids = S.areas.filter((a) => [...a.hike, a.bc, ...a.resorts].some((id) => id && old.has(id))).map((a) => a.id);
  LS.set("mw2:areas-starred", ids);
  return new Set(ids);
}
// First open with no saved choice in 14 days (Question 4): Ski from Nov 15 to Apr 30, else Ski when an avalanche center
// is rating (the map layers, no forecast weight), else Hike. No forecast is fetched before the first screen.
async function chooseMode(fromHash) {
  if (fromHash) return fromHash;
  const saved = LS.get("mw2:mode");
  if (saved && MODES.includes(saved.mode) && Date.now() - saved.at <= KEEP_MODE_MS) return saved.mode;
  const v2 = LS.get("mw2:view");   // a v2 choice still counts for its 14 days
  if (v2 && Date.now() - v2.at <= KEEP_MODE_MS && (v2.view === "hike" || OLD_SKI.includes(v2.view))) return v2.view === "hike" ? "hike" : "ski";
  if (resortSeason(localYmd(Date.now()))) return "ski";
  await loadLayers();
  const rating = Object.values(zonesFrom(S.layers || [])).some((z) => !z.off_season && z.level >= 1 && !zoneExpired(z, Date.now()));
  return rating ? "ski" : "hike";
}
async function main() {
  $(".asof-t").textContent = "Loading…";
  net.evict(CACHE_TTL_MIN, PREF_KEYS);   // expired forecasts would otherwise fill the device's storage and block starring
  $("#foot").innerHTML = UI.footer();
  try {
    const [p, c] = await Promise.all([net.fetchJson("places.json"), net.fetchJson("cams.json")]);
    const ix = areaIndex(p);
    S.P = p; S.cams = c; S.areas = ix.areas; S.byArea = ix.byArea; S.places = ix.places;
  } catch {
    $("#main").innerHTML = '<p class="empty">The place list didn\'t load. Tap Refresh to try again.</p>';
    $(".asof-t").textContent = "";
    return;
  }
  S.starred = loadStars();
  $("#main").innerHTML = '<p class="empty">Loading</p>';
  const h = readHash();
  S.mode = await chooseMode(h.mode);
  history.replaceState(null, "", hashFor());
  ensureLoads();
  renderMain();
  if (h.open) openPlace(h.open, h.tab);
}
main();
