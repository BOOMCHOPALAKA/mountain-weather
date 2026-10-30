// page/app.js
// Orchestration: loads only what the visible view shows, builds vm objects, renders with render.js, wires the controls.
// Every Open-Meteo request comes from planRequests (weight <= 300), cached 30 minutes, at most 2 in flight.
import { makeNet } from "./net.js";
import { planRequests } from "./engine/request.js";
import { PROFILES } from "./engine/models.js";
import { parseForecast } from "./engine/parse.js";
import { mapLayerUrl, productUrl } from "./engine/avalanche.js";
import { snotelUrl, parseSnotel } from "./engine/snotel.js";
import { defaultMode } from "./engine/regions.js";
import { localHourString } from "./engine/forecast.js";
import { skiRowZ, skiCardZ, hikeRowZ, hikeCardZ, regionZ, top3Z, avalFor, camsForPage, distanceRole, miles, tomorrowVerdict, zonesFrom, zoneExpired } from "./vm.js";
import * as R from "./render.js";

const VIEWS = ["resorts", "backcountry", "hike"];
const MODE = { resorts: "resort", backcountry: "backcountry", hike: "hike" };
const NOUN = { resorts: "resort", backcountry: "zone", hike: "area" };
const CENTERS = ["NWAC", "COAA", "IPAC"];
const KEEP_VIEW_MS = 14 * 86400000;
const CACHE_TTL_MIN = 30;   // every cached request on this page
const OM_TIMEOUT_MS = 20000;   // Open-Meteo multi-point requests can take a while
const STALE_ON_RETURN_MS = 30 * 60000;
const PREF_KEYS = ["mw2:starred", "mw2:view", "mw2:sub", "mw2:open"];   // never evicted
const $ = (s) => document.querySelector(s);
const fin = (x) => typeof x === "number" && Number.isFinite(x);
const clock = (ms) => (fin(ms) ? new Date(ms).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" }) : null);
const pstDay = (ms) => new Date(ms - 8 * 3600000).toISOString().slice(0, 10);   // SNOTEL runs on station standard time
const slug = (s) => String(s).replace(/[^A-Za-z0-9_-]/g, "_");

/* ---------- storage, guarded ---------- */
const store = (kind) => ({
  get(k) { try { return JSON.parse(globalThis[kind].getItem(k)); } catch { return null; } },
  set(k, v) { try { globalThis[kind].setItem(k, JSON.stringify(v)); } catch { /* blocked */ } },
});
const LS = store("localStorage"), SS = store("sessionStorage");

/* ---------- state ---------- */
const net = makeNet();
const S = {
  P: null, byId: {}, cams: null, view: null, sub: "resorts", now: Date.now(),
  starred: new Set(LS.get("mw2:starred") || []), open: SS.get("mw2:open") || {}, filter: "",
  glance: new Map(), clouds: new Map(), stations: new Map(), cards: new Map(), verdicts: new Map(),
  layers: null, layersP: null, layersAt: null, brief: null, briefP: null, loading: new Set(), seen: new Set(), hashes: new Map(),
  lastGoodAt: null,
};
const saveOpen = () => SS.set("mw2:open", S.open);

/* ---------- fetching ---------- */
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
async function getJson(url, ttl = CACHE_TTL_MIN, opts = {}) {
  S.seen.add(url);
  const r = await net.cachedJson(url, ttl, opts);
  if (r.data && r.data.error === true) throw new Error(r.data.reason || "error body");
  return r;
}
const ptKey = (placeId, role) => `${placeId}:${role}`;
const pointOf = (place, role) => place.points.find((p) => p.role === role) || null;
const withKey = (place, role) => { const p = pointOf(place, role); return p ? { ...p, key: ptKey(place.id, role) } : null; };

// One forecast request; each requested point lands in `into` by key. Never throws to the caller's pool twice.
async function forecast(req, profile, into) {
  const P = PROFILES[profile];
  try {
    const { at, data } = await omSlot(() => getJson(req.url, CACHE_TTL_MIN, { timeoutMs: OM_TIMEOUT_MS }));
    const locs = parseForecast(data, P.models, P.hourly);   // rule 7: the requested model list
    req.points.forEach((p, i) => into.set(p.key, locs[i] && locs[i].time.length ? { status: "ok", loc: locs[i], at } : { status: "error" }));
  } catch (e) {
    req.points.forEach((p) => into.set(p.key, { status: "error" }));
    throw e;
  } finally { schedule(); }
}
const needs = (map, pts) => pts.filter((p) => p && (!map.has(p.key) || map.get(p.key).status === "error"));
function forecastJobs(pts, profile, into) {
  const todo = needs(into, pts);
  todo.forEach((p) => into.set(p.key, { status: "loading" }));
  return planRequests(todo, profile).map((req) => () => forecast(req, profile, into));
}
const runJobs = (jobs) => net.pool(jobs, 2, (job) => job());

/* ---------- places by view ---------- */
const placesOf = (view) => S.P.places.filter((p) => p.mode === MODE[view]);
const regionsOf = (view) => S.P.regions[view];
const locOf = (map, key) => (map.get(key)?.status === "ok" ? map.get(key).loc : null);
function viewGlancePoints(view) {
  const out = new Map();
  for (const p of placesOf(view)) { const k = withKey(p, p.glance); if (k) out.set(k.key, k); }
  for (const r of regionsOf(view)) { const k = withKey(S.byId[r.anchor.place], r.anchor.role); if (k) out.set(k.key, k); }   // rule 5
  return [...out.values()];
}
const anchorPoints = (view) => regionsOf(view).map((r) => withKey(S.byId[r.anchor.place], r.anchor.role)).filter(Boolean);
// Rule 4: the station nearest the anchor point, by the station's own coordinates.
function anchorStation(region) {
  const a = S.byId[region.anchor.place], pt = pointOf(a, region.anchor.role);
  const sts = (a.snotel || []).filter((s) => fin(s.lat) && fin(s.lon));
  if (!pt || !sts.length) return null;
  return sts.reduce((b, s) => (miles(pt.lat, pt.lon, s.lat, s.lon) < miles(pt.lat, pt.lon, b.lat, b.lon) ? s : b));
}
const avalOf = (place) => (S.layers ? avalFor(place, S.layers, S.now) : null);

function loadLayers() {
  if (!S.layersP) {
    S.layersP = net.pool(CENTERS, 3, (c) => getJson(mapLayerUrl(c))).then((res) => {
      const ok = res.filter((x) => x.ok);
      S.layers = ok.map((x) => x.value.data);
      S.layersAt = ok.length ? Math.min(...ok.map((x) => x.value.at)) : null;
      schedule();
    });
  }
  return S.layersP;
}
async function loadStations(view) {
  const sts = [...new Map(regionsOf(view).map(anchorStation).filter(Boolean).map((s) => [s.triplet, s])).values()];
  const todo = sts.filter((s) => !S.stations.has(s.triplet));
  if (!todo.length) return;
  const trips = todo.map((s) => s.triplet);
  trips.forEach((t) => S.stations.set(t, { status: "loading" }));
  try {
    const { at, data } = await getJson(snotelUrl(trips, "HOURLY", pstDay(Date.now() - 36 * 3600000), `${pstDay(Date.now())} 23:59`, ["TOBS", "SNWD"]));
    const rows = parseSnotel(data);   // rule 7: a station missing from the reply just has no rows
    trips.forEach((t) => S.stations.set(t, { status: "ok", hourly: rows[t] || [], at }));
  } catch { trips.forEach((t) => S.stations.set(t, { status: "error" })); }
  schedule();
}
function loadBrief() {
  if (!S.briefP) {
    S.briefP = net.fetchJson("brief.json").then((b) => {
      const at = Date.parse(b?.at || "");
      S.brief = Number.isFinite(at) && Date.now() - at <= 6 * 3600000 && Date.now() >= at - 600000 ? { ...b, atMs: at } : null;
    }).catch(() => { S.brief = null; }).finally(schedule);
  }
  return S.briefP;
}
async function loadView(view) {
  if (S.loading.has(view)) return;
  S.loading.add(view);
  try {
    const jobs = [...forecastJobs(viewGlancePoints(view), "glance", S.glance), ...forecastJobs(anchorPoints(view), "clouds", S.clouds)];
    await Promise.all([runJobs(jobs), loadLayers(), loadStations(view), loadBrief()]);
    if (view === "hike") await loadHikeVerdicts();
  } finally { S.loading.delete(view); schedule(); }
}
// Hike top three: the clouds for the three winners' high points, then their tomorrow AM verdict.
async function loadHikeVerdicts() {
  const t = top3Z("hike", placesOf("hike").map(rowZ));
  const pts = t.rows.map((r) => withKey(S.byId[r.id], "High")).filter(Boolean);
  await runJobs(forecastJobs(pts, "clouds", S.clouds));
  for (const r of t.rows) {
    const pt = pointOf(S.byId[r.id], "High"), cl = locOf(S.clouds, ptKey(r.id, "High"));
    if (pt && cl) S.verdicts.set(r.id, tomorrowVerdict(cl, pt.elev_ft, Date.now()));
  }
  schedule();
}
// A card: detail + clouds at every point, SNOTEL daily and hourly (ski), the avalanche product when rated.
async function loadCard(place) {
  const have = S.cards.get(place.id);
  if (have && have.status !== "error") return;
  const c = { status: "loading", detail: new Map(), clouds: new Map(), snotel: null, product: null, at: null };
  S.cards.set(place.id, c);
  schedule();
  const pts = place.points.map((p) => withKey(place, p.role));
  const jobs = [...forecastJobs(pts, "detail", c.detail), ...forecastJobs(pts, "clouds", c.clouds)];
  const st = place.mode !== "hike" ? place.snotel?.[0] : null;
  const snow = st ? Promise.all([
    getJson(snotelUrl([st.triplet], "DAILY", pstDay(Date.now() - 9 * 86400000), pstDay(Date.now()), ["SNWD", "WTEQ"])).then((r) => parseSnotel(r.data)[st.triplet] || []).catch(() => { c.snotelError = true; return []; }),
    getJson(snotelUrl([st.triplet], "HOURLY", pstDay(Date.now() - 36 * 3600000), `${pstDay(Date.now())} 23:59`, ["TOBS", "SNWD"])).then((r) => parseSnotel(r.data)[st.triplet] || []).catch(() => []),
  ]).then(([daily, hourly]) => { c.snotel = { station: st, daily, hourly, from: distanceRole(place, S.P.regions) }; }) : Promise.resolve();
  const prod = place.mode !== "hike" ? loadLayers().then(async () => {
    const a = avalOf(place);
    if (!(a && a.l >= 1 && place.avalanche?.zone != null)) return;
    try { c.product = (await getJson(productUrl(place.avalanche.center, place.avalanche.zone))).data; } catch { c.product = null; }
  }) : Promise.resolve();
  await Promise.all([runJobs(jobs), snow, prod]);
  const ats = [...c.detail.values()].map((x) => x.at).filter(fin);
  c.at = ats.length ? Math.min(...ats) : null;
  c.status = ats.length ? "ok" : "error";
  schedule();
}

/* ---------- view-model ---------- */
function rowZ(place) {
  const g = S.glance.get(ptKey(place.id, place.glance));
  const loc = g?.status === "ok" ? g.loc : null;
  const z = place.mode === "hike" ? hikeRowZ(place, loc, S.now) : skiRowZ(place, loc, S.now, avalOf(place));
  z.status = !g || g.status === "loading" ? "loading" : loc ? "ok" : "error";
  z.star = S.starred.has(place.id);
  if (place.mode === "hike") z.rank.verdict = S.verdicts.get(place.id) || null;
  return z;
}
const glanceLocsOf = (place) => Object.fromEntries(place.points.map((p) => [p.role, locOf(S.glance, ptKey(place.id, p.role))]).filter(([, l]) => l));
const byRole = (place, m) => Object.fromEntries(place.points.map((p) => [p.role, m ? locOf(m, ptKey(place.id, p.role)) : null]).filter(([, l]) => l));
function cardZ(place) {
  const c = S.cards.get(place.id);
  const gl = glanceLocsOf(place), aval = avalOf(place);
  const detail = byRole(place, c?.detail), clouds = byRole(place, c?.clouds);
  const z = place.mode === "hike"
    ? hikeCardZ(place, detail, clouds, S.cams, S.now, gl)
    : skiCardZ(place, detail, clouds, gl, c?.snotel || null, c?.product || null, S.cams, S.now, aval);
  if (place.mode === "hike") z.aval = aval;
  if (place.mode !== "hike" && place.snotel?.length && (!c || c.status === "loading")) z.snotelPending = true;   // never "no station" while it loads
  if (c?.snotelError) {   // a failed SNOTEL request is not "not posted": say it didn't load
    z.snotelError = true;
    z.snotelNote = `${place.snotel[0].name}: measured snow didn't load this time. Tap Refresh.`;
  }
  const anyLoc = Object.values(detail)[0] || Object.values(gl)[0];
  if (anyLoc && place.mode !== "hike") z.day0Gone = +localHourString(S.now, anyLoc.utcOffset).slice(11, 13) >= 23;   // no hours of today remain
  z.star = S.starred.has(place.id);
  const g = S.glance.get(ptKey(place.id, place.glance));
  z.status = c?.status === "loading" || !g || g.status === "loading" ? "loading" : "error";
  z.fresh = clock(c?.at || g?.at);
  return z;
}
function regionView(view, region, zsById) {
  const mine = placesOf(view).filter((p) => p.region === region.id);
  const zs = mine.map((p) => zsById[p.id]);
  const glanceByPlace = Object.fromEntries(mine.map((p) => [p.id, locOf(S.glance, ptKey(p.id, p.glance))]).filter(([, l]) => l));
  const aKey = ptKey(region.anchor.place, region.anchor.role);
  const st = anchorStation(region), sd = st ? S.stations.get(st.triplet) : null;
  const r = regionZ(region, S.P.places, zs, glanceByPlace, { glance: locOf(S.glance, aKey), clouds: locOf(S.clouds, aKey) },
    st && sd?.status === "ok" ? { station: st, hourly: sd.hourly } : null, S.now, NOUN[view]);
  if (r.now?.source === "station") r.now.elev_ft = st.elev_ft;
  const gs = mine.map((p) => S.glance.get(ptKey(p.id, p.glance)));
  r.status = gs.some((g) => !g || g.status === "loading") ? "loading" : "error";
  const ats = gs.map((g) => g?.at).filter(fin);
  r.fresh = clock(ats.length ? Math.min(...ats) : null);
  return r;
}
function top3View(view, zs) {
  const pts = viewGlancePoints(view).map((p) => S.glance.get(p.key));
  const done = pts.filter((g) => g && g.status !== "loading").length;
  return R.top3Panel(top3Z(view === "hike" ? "hike" : "ski", zs), view, { done, total: pts.length });
}

/* ---------- rendering ---------- */
const hash = (s) => { let h = 5381; const n = s.replace(/tip-\d+/g, ""); for (let i = 0; i < n.length; i++) h = (h * 33) ^ n.charCodeAt(i); return h >>> 0; };
function fromHtml(html) { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; }
// Replacing a node drops keyboard focus to <body>. Note the focused control before the swap, put it back after.
const FOCUS_KEYS = ["data-row", "data-rgn", "data-star", "data-more", "data-jump"];
function focusSpot(root) {
  const a = document.activeElement;
  if (!root || !a || a === document.body || !root.contains(a)) return null;
  const k = FOCUS_KEYS.find((x) => a.hasAttribute(x));
  if (k) { const sel = `[${k}="${CSS.escape(a.getAttribute(k))}"]`; return (nu) => nu.querySelector(sel); }
  const sel = a.tagName.toLowerCase() + (a.classList[0] ? `.${CSS.escape(a.classList[0])}` : "");   // tooltip buttons: same position among their kind
  const i = [...root.querySelectorAll(sel)].indexOf(a);
  return (nu) => nu.querySelectorAll(sel)[i];
}
const refocus = (spot, nu) => { const t = spot && nu && spot(nu); if (t) t.focus({ preventScroll: true }); };
function swap(key, el, html) {   // replace el only when its rendered html changed
  if (!el) return null;
  const h = hash(html);
  if (S.hashes.get(key) === h) return el;
  const nu = fromHtml(html), spot = focusSpot(el);
  el.replaceWith(nu);
  refocus(spot, nu);
  S.hashes.set(key, h);
  return nu;
}
const moreState = (id) => {
  const secs = {};
  for (const [k, v] of Object.entries(S.open)) if (k.startsWith(`sec:${id}:`)) secs[k.slice(`sec:${id}:`.length)] = v;
  return { more: !!S.open[`more:${id}`], secs };
};
const pinnedCard = (place) => {
  const z = cardZ(place);
  return place.mode === "hike" ? R.hikeCard(z, moreState(place.id)) : R.skiCard(z, S.view, moreState(place.id));
};
function rowHtml(place, z, view) {
  const o = { starred: S.starred.has(place.id), open: !!S.open[`row:${place.id}`] };
  return view === "hike" ? R.areaRow(z, o) : R.skiRow(z, view, o);
}
function bodyHtml(place, view) {
  const z = cardZ(place);
  return view === "hike" ? R.areaRowBody(z, moreState(place.id)) : R.skiRowBody(z, view, moreState(place.id));
}
const regionOpen = (view, id) => !!S.open[`rgn:${view}:${id}`];
function regionCount(view) {
  const n = placesOf(view).length, k = regionsOf(view).length;
  return view === "hike" ? `WTA regions · ${n} areas` : `${k} regions · ${n} ${NOUN[view]}s`;
}
function briefFor(view) {
  const b = S.brief, text = b && (view === "hike" ? b.hike : b.ski);
  return typeof text === "string" && text.trim() ? { text, atText: clock(b.atMs) } : null;
}
// Never "Loading…" once every request has settled: a total failure says so, with the last good time if there was one.
function updateAsOf(view) {
  const gs = viewGlancePoints(view).map((p) => S.glance.get(p.key));
  const ats = gs.map((g) => g?.at).filter(fin);
  if (ats.length) {
    S.lastGoodAt = Math.min(...ats);
    $(".asof-t").textContent = `as of ${clock(S.lastGoodAt)}`;
  } else if (S.loading.has(view) || !gs.length || gs.some((g) => !g || g.status === "loading")) {
    $(".asof-t").textContent = "Loading…";
  } else {
    $(".asof-t").textContent = S.lastGoodAt ? `Forecast unavailable · last loaded ${clock(S.lastGoodAt)}` : "Forecast unavailable";
  }
}
// The oldest data on screen: the view's forecasts and the avalanche layers.
function oldestOnScreen(view) {
  const ats = viewGlancePoints(view).map((p) => S.glance.get(p.key)?.at).filter(fin);
  if (fin(S.layersAt)) ats.push(S.layersAt);
  return ats.length ? Math.min(...ats) : null;
}

function renderFrame() {
  const view = S.view;
  S.now = Date.now();
  S.hashes.clear();
  const zs = placesOf(view).map(rowZ), zsById = Object.fromEntries(zs.map((z) => [z.id, z]));
  const starred = placesOf(view).filter((p) => S.starred.has(p.id));
  const regions = regionsOf(view).map((rg) => {
    const r = regionView(view, rg, zsById);
    const rows = placesOf(view).filter((p) => p.region === rg.id).map((p) => rowHtml(p, zsById[p.id], view)).join("");
    return view === "hike" ? R.hikeRegion(r, rows, { open: regionOpen(view, rg.id) }) : R.skiRegion(r, rows, { open: regionOpen(view, rg.id), mode: view });
  }).join("");
  const filter = view === "resorts" ? '<div class="filter"><label for="filter">Find a resort</label><input id="filter" type="search" placeholder="Crystal, Baker, Whistler" autocomplete="off"></div>' : "";
  const legend = view === "hike" ? "" : `<div class="legend legend-top" role="note" aria-label="Bar legend">${R.LEGEND_TOP}</div>`;
  const pinned = starred.length ? starred.map(pinnedCard).join("") : '<p class="small muted">Tap the star on any card to pin it here.</p>';
  $("#main").innerHTML = `${R.briefSection(briefFor(view))}<div data-part="cams">${R.camsStrip(camsForPage(S.cams, S.now), clock(S.now))}</div>
    <div class="mode" data-for="${view}"><div class="panel" data-part="top3">${top3View(view, zs)}${legend}</div>
    <section class="starred list-start" aria-labelledby="h-star"><div class="sec-h"><h2 id="h-star">Starred</h2><span class="small muted">Saved on this device</span></div>${pinned}</section>
    <section class="rgns" aria-labelledby="h-rgn"><div class="sec-h"><h2 id="h-rgn">Regions</h2><span class="small muted">${regionCount(view)}</span></div>${filter}${regions}</section></div>`;
  for (const p of placesOf(view)) if (S.open[`row:${p.id}`] && !S.starred.has(p.id)) fillBody(p, view);
  const f = $("#filter");
  if (f) { f.value = S.filter; applyFilter(); }
  observeCards();
  updateAsOf(view);
}
// Card detail loads only for a card that is open and on screen: a pinned card, or a row opened earlier this session.
const io = "IntersectionObserver" in globalThis ? new IntersectionObserver((es) => {
  for (const e of es) {
    if (!e.isIntersecting) continue;
    io.unobserve(e.target);
    const p = S.byId[e.target.dataset.card];
    if (p && !e.target.closest("[hidden]")) loadCard(p);
  }
}) : null;
function observeCards() {
  for (const el of document.querySelectorAll('.starred .card[id^="pin-"], .srow-body:not([hidden])')) {
    const id = el.id.replace(/^(pin|body)-/, "");
    if (!S.byId[id] || S.cards.has(id) || el.closest("[hidden]")) continue;   // an errored card retries on Refresh, not in a loop
    const g = S.glance.get(ptKey(id, S.byId[id].glance));
    if (!g || g.status === "loading") continue;   // wait for the glance: a short "Loading" card would count as on screen
    el.dataset.card = id;
    if (io) io.observe(el); else loadCard(S.byId[id]);
  }
}
function fillBody(place, view) {
  const body = document.getElementById(`body-${slug(place.id)}`);
  if (!body || body.hidden) return;
  const html = bodyHtml(place, view), h = hash(html);
  if (S.hashes.get(`body:${place.id}`) === h) return;
  const spot = focusSpot(body);
  body.innerHTML = html;
  refocus(spot, body);
  S.hashes.set(`body:${place.id}`, h);
}
let pending = false;
function schedule() {
  if (pending || !S.view) return;
  pending = true;
  requestAnimationFrame(() => { pending = false; update(); });
}
function update() {   // data landed: swap only what changed, keep open rows, filter text and focus
  const view = S.view;
  S.now = Date.now();
  const zs = placesOf(view).map(rowZ), zsById = Object.fromEntries(zs.map((z) => [z.id, z]));
  const panel = $('[data-part="top3"] .top3-sec');
  swap("top3", panel, top3View(view, zs));
  for (const p of placesOf(view).filter((x) => S.starred.has(x.id))) swap(`pin:${p.id}`, document.getElementById(`pin-${slug(p.id)}`), pinnedCard(p));
  for (const rg of regionsOf(view)) {
    const sec = document.querySelector(`.rgn[data-region="${CSS.escape(rg.id)}"]`);
    if (!sec) continue;
    const r = regionView(view, rg, zsById);
    const head = view === "hike" ? R.regionRow(r, { open: regionOpen(view, rg.id), mode: "hike" }) : R.regionRow(r, { open: regionOpen(view, rg.id), mode: view });
    swap(`rgn:${rg.id}`, sec.querySelector(":scope > .rgn-row"), head);
  }
  for (const p of placesOf(view)) {
    const li = document.querySelector(`.srow-li[data-place="${CSS.escape(p.id)}"]`);
    if (!li) continue;
    const html = rowHtml(p, zsById[p.id], view), h = hash(html);
    if (S.hashes.get(`row:${p.id}`) !== h) {
      const nu = fromHtml(html).querySelector(".srow");
      const old = li.querySelector(":scope > .srow");
      if (nu && old) {
        const spot = focusSpot(old);
        old.replaceWith(nu);
        refocus(spot, nu);
        const btn = nu.querySelector(".srow-btn");
        if (btn) btn.setAttribute("aria-expanded", String(!(li.querySelector(".srow-body")?.hidden ?? true)));
      }
      S.hashes.set(`row:${p.id}`, h);
    }
    if (!S.starred.has(p.id)) fillBody(p, view);
  }
  const brief = $(".brief"), want = R.briefSection(briefFor(view));
  if (!brief && want) $("#main").insertAdjacentHTML("afterbegin", want);
  if (brief && !want) brief.remove();
  if (S.filter) applyFilter();   // swapped region headers come back with their saved aria-expanded
  observeCards();
  updateAsOf(view);
}

/* ---------- view switching ---------- */
function setView(view, { save = true } = {}) {
  S.view = view;
  if (view !== "hike") S.sub = view;
  const top = view === "hike" ? "hike" : "ski";
  document.querySelectorAll(".seg button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.top === top)));
  document.querySelectorAll(".seg2 button").forEach((b) => b.setAttribute("aria-pressed", String(top === "ski" && b.dataset.sub === view)));
  $("#sub").hidden = top === "hike";
  if (save) { LS.set("mw2:view", { view, at: Date.now() }); if (view !== "hike") LS.set("mw2:sub", view); }
  if (location.hash !== `#${view}`) history.replaceState(null, "", `#${view}`);
  renderFrame();
  loadView(view);
}
// First visit (or nothing chosen in 14 days): ski when an avalanche center is in season or a resort forecasts 1" or more.
async function chooseView() {
  const fromHash = location.hash.slice(1);
  if (VIEWS.includes(fromHash)) return fromHash;
  const saved = LS.get("mw2:view");
  if (saved && VIEWS.includes(saved.view) && Date.now() - saved.at <= KEEP_VIEW_MS) return saved.view;
  const sub = LS.get("mw2:sub") === "backcountry" ? "backcountry" : "resorts";
  await loadLayers();
  const inSeason = Object.values(zonesFrom(S.layers || [])).some((z) => !z.off_season && z.level >= 1 && !zoneExpired(z, Date.now()));
  if (inSeason) return sub;
  await runJobs(forecastJobs(viewGlancePoints("resorts"), "glance", S.glance));
  const snow24 = placesOf("resorts").map(rowZ).map((z) => z.glance.n24).filter(fin);
  return defaultMode({ avalancheInSeason: false, resortSnow24: snow24 }) === "ski" ? sub : "hike";
}

/* ---------- controls ---------- */
function toggle(btn) {
  const p = document.getElementById(btn.getAttribute("aria-controls"));
  const o = btn.getAttribute("aria-expanded") === "true";
  btn.setAttribute("aria-expanded", String(!o));
  if (p) p.hidden = o;
  return !o;
}
function applyFilter() {
  const q = S.filter.trim().toLowerCase();
  document.querySelectorAll('.mode[data-for="resorts"] .rgn').forEach((rg) => {
    let any = false;
    rg.querySelectorAll(".srow-li").forEach((li) => { const hit = !q || li.dataset.name.includes(q); li.hidden = !hit; any = any || hit; });
    rg.hidden = !any;
    const b = rg.querySelector(".rgn-btn"), open = q ? any : regionOpen("resorts", rg.dataset.region);
    b.setAttribute("aria-expanded", String(open));
    document.getElementById(b.getAttribute("aria-controls")).hidden = !open;
  });
}
document.addEventListener("click", (e) => {
  const i = e.target.closest(".info");
  if (i) { toggle(i); return; }
  const m = e.target.closest(".more");
  if (m) { const o = toggle(m); m.firstChild.textContent = o ? "Less" : "More"; S.open[`more:${m.dataset.more}`] = o; saveOpen(); return; }
  const s = e.target.closest(".star");
  if (s) {
    const id = s.dataset.star;
    if (S.starred.has(id)) S.starred.delete(id); else S.starred.add(id);
    LS.set("mw2:starred", [...S.starred]);
    renderFrame();
    // renderFrame rebuilds the page: keep focus on this place's star, or on its row when the pinned card is gone
    (document.querySelector(`[data-star="${CSS.escape(id)}"]`) || document.querySelector(`[data-row="${CSS.escape(id)}"]`))?.focus({ preventScroll: true });
    return;
  }
  const h = e.target.closest(".rgn-row");
  if (h) {
    if (e.target.closest(".tip, a")) return;
    const b = h.querySelector(".rgn-btn");
    S.open[`rgn:${S.view}:${b.dataset.rgn}`] = toggle(b); saveOpen();
    observeCards();
    return;
  }
  const c = e.target.closest(".srow-btn");
  if (c) {
    const id = c.dataset.row, o = toggle(c);
    S.open[`row:${id}`] = o; saveOpen();
    if (o) { S.hashes.delete(`body:${id}`); fillBody(S.byId[id], S.view); loadCard(S.byId[id]); }
    return;
  }
  const j = e.target.closest(".srow-jump");
  if (j) {
    const t = document.getElementById(j.dataset.jump);
    if (t) { t.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" }); t.focus({ preventScroll: true }); }
  }
});
document.addEventListener("toggle", (e) => {
  const d = e.target;
  if (d.matches?.("details[data-sec]")) { S.open[`sec:${d.dataset.place}:${d.dataset.sec}`] = d.open; saveOpen(); }
}, true);
document.addEventListener("keydown", (e) => {   // Escape closes the open tooltip and returns focus to its button
  if (e.key !== "Escape") return;
  const b = document.querySelector('.info[aria-expanded="true"]');
  if (b) { toggle(b); b.focus(); }
});
document.addEventListener("input", (e) => { if (e.target.id === "filter") { S.filter = e.target.value; applyFilter(); } });
document.addEventListener("error", (e) => {   // a cam that fails to load says so instead of showing a broken image
  const img = e.target;
  if (img.tagName !== "IMG" || !img.closest(".cam")) return;
  const a = img.closest("a");
  if (a) a.replaceWith(Object.assign(document.createElement("p"), { className: "small muted", textContent: "Camera didn't load." }));
}, true);
$(".seg").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-top]");
  if (b) { setView(b.dataset.top === "hike" ? "hike" : S.sub); window.scrollTo({ top: 0 }); }
});
$("#sub").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-sub]");
  if (b) { setView(b.dataset.sub); window.scrollTo({ top: 0 }); }
});
function refresh() {   // drop the device cache for every request this page made, then fetch again
  for (const u of S.seen) { try { localStorage.removeItem(`mw2:${u}`); } catch { /* blocked */ } }
  S.seen.clear();
  for (const m of [S.glance, S.clouds, S.stations, S.cards, S.verdicts]) m.clear();
  S.layers = null; S.layersP = null; S.layersAt = null; S.briefP = null; S.brief = null;
  setView(S.view, { save: false });
}
$("#refresh").addEventListener("click", refresh);
// A phone tab reopened hours later: refetch when what's on screen is over 30 minutes old (or nothing loaded),
// and always re-render so time-based states (an expired avalanche rating) use the current clock.
function onReturn() {
  if (!S.P || !S.view || document.visibilityState === "hidden") return;
  if (S.loading.has(S.view)) { schedule(); return; }
  const oldest = oldestOnScreen(S.view);
  if (oldest == null || Date.now() - oldest > STALE_ON_RETURN_MS) refresh(); else schedule();
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
async function main() {
  $(".asof-t").textContent = "Loading…";
  net.evict(CACHE_TTL_MIN, PREF_KEYS);   // expired forecasts would otherwise fill the device's storage and block starring
  S.sub = LS.get("mw2:sub") === "backcountry" ? "backcountry" : "resorts";
  $("#foot").innerHTML = R.footer();
  try {
    const [p, c] = await Promise.all([net.fetchJson("places.json"), net.fetchJson("cams.json")]);
    S.P = p; S.cams = c; S.byId = Object.fromEntries(p.places.map((x) => [x.id, x]));
  } catch {
    $("#main").innerHTML = `<p class="empty">The place list didn't load. ${R.UNAVAILABLE}.</p>`;
    $(".asof-t").textContent = "";
    return;
  }
  $("#main").innerHTML = '<p class="empty">Loading</p>';
  const view = await chooseView();
  setView(view, { save: false });
}
window.addEventListener("hashchange", () => { const h = location.hash.slice(1); if (S.P && VIEWS.includes(h) && h !== S.view) setView(h); });
main();
