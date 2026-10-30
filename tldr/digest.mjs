#!/usr/bin/env node
// tldr/digest.mjs
// A small JSON digest of what the page shows on load, built with the page's own engine and view-model,
// so the TLDR writer has one source of facts and tldr/check.mjs can verify every number and place.
//
//   node tldr/digest.mjs --root <deploy root> [--out digest.json] [--saved]
//
// --saved reads Open-Meteo from the disk copy in scripts/saved_fetch.mjs. It is for local runs; the deployed copy has no scripts/.
//
// <root> is laid out like the deploy: vm.js, net.js, engine.js, engine/, places.json, package.json.
// Fetches what page/app.js fetches on load for Ski > Resorts, Ski > Backcountry and Hike: glance for every
// place and region anchor, clouds for the anchors (and the hike top three's high points), the three avalanche
// map layers, and SNOTEL hourly for the anchor stations and each ski place's nearest station. Open-Meteo: planRequests (weight <= 300), 2 in flight.
// A failed request leaves its regions and places out and names them under "missing". Nothing is guessed.
// "picks" names the best weather for the TLDR. engine/picks.js holds the rules; this file only gathers their inputs.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const VIEWS = ["resorts", "backcountry", "hike"];
const MODE = { resorts: "resort", backcountry: "backcountry", hike: "hike" };
const NOUN = { resorts: "resort", backcountry: "zone", hike: "area" };
const CENTERS = ["NWAC", "COAA", "IPAC"];
const TIMEOUT_MS = 20000;   // the page's Open-Meteo timeout; used for every request here (a batch job, not a phone)
const NEEDED = ["vm.js", "net.js", "engine.js", "engine/request.js", "engine/clouds.js"];
const fin = (x) => typeof x === "number" && Number.isFinite(x);
const rnd = (x) => (fin(x) ? Math.round(x) : null);

// ISO 8601 with the America/Los_Angeles offset, e.g. 2026-10-30T06:37:12-07:00.
export function isoPacific(ms) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hourCycle: "h23", year: "numeric", month: "2-digit",
    day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", timeZoneName: "longOffset" }).formatToParts(new Date(ms));
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  const off = p.timeZoneName.replace("GMT", "") || "+00:00";
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${off}`;
}

// Display string -> the value a writer copies: "<1" stays a string, anything else a plain number.
const dispVal = (s) => (s === "<1" ? "<1" : fin(Number(String(s).replaceAll(",", ""))) ? Number(String(s).replaceAll(",", "")) : null);
// rangeText output ("3–6", "<1–2", "4", "<1") -> [lo, hi].
function rangeOf(text) {
  if (typeof text !== "string" || text === "–") return [null, null];
  const [a, b = a] = text.split("–");
  return [dispVal(a), dispVal(b)];
}
const ftOf = (s) => { const m = /([\d,]+) ft/.exec(String(s || "")); return m ? Number(m[1].replaceAll(",", "")) : null; };
const plain = (html) => String(html).replace(/<[^>]*>/g, "").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");

// Every number a writer may copy: numeric values and the digits inside display strings.
// Names and links are not displayed numbers; avalanche levels are left out on purpose (the writer uses the word).
const NOT_NUMBERS = new Set(["name", "spot", "zone", "gust_at", "link", "level", "center", "state",
  "key", "zone_key", "spot_zone_key", "gust_at_zone_key"]);
function collectNumbers(x, out) {
  if (typeof x === "number") { if (fin(x)) out.add(x); }
  else if (typeof x === "string") for (const m of x.matchAll(/\d[\d,]*(\.\d+)?/g)) out.add(Number(m[0].replaceAll(",", "")));
  else if (Array.isArray(x)) x.forEach((v) => collectNumbers(v, out));
  else if (x && typeof x === "object") for (const [k, v] of Object.entries(x)) if (!NOT_NUMBERS.has(k)) collectNumbers(v, out);
  return out;
}

async function loadModules(codeDir) {
  const imp = (rel) => import(pathToFileURL(path.join(codeDir, rel)).href);
  const [net, request, models, parse, avalanche, snotel, forecast, clouds, picks, vm] = await Promise.all([
    imp("net.js"), imp("engine/request.js"), imp("engine/models.js"), imp("engine/parse.js"), imp("engine/avalanche.js"),
    imp("engine/snotel.js"), imp("engine/forecast.js"), imp("engine/clouds.js"), imp("engine/picks.js"), imp("vm.js"),
  ]);
  return { ...net, ...request, ...models, ...parse, ...avalanche, ...snotel, ...forecast, ...clouds, ...picks, ...vm };
}

// codeDir holds vm.js, net.js and engine/; placesPath is places.json. Both are the deploy root in production.
export async function buildDigest({ codeDir, placesPath, fetchImpl, nowMs = Date.now(), retryDelayMs = 1500, timeoutMs = TIMEOUT_MS }) {
  const M = await loadModules(codeDir);
  const P = JSON.parse(fs.readFileSync(placesPath, "utf8"));
  const byId = Object.fromEntries(P.places.map((x) => [x.id, x]));
  const net = M.makeNet({ fetchImpl, storage: null, timeoutMs, retryDelayMs, now: () => nowMs });

  // ---- helpers re-created from page/app.js (it touches the DOM, so it is not imported) ----
  const pstDay = (ms) => new Date(ms - 8 * 3600000).toISOString().slice(0, 10);   // SNOTEL runs on station standard time
  const ptKey = (placeId, role) => `${placeId}:${role}`;
  const pointOf = (place, role) => place.points.find((p) => p.role === role) || null;
  const withKey = (place, role) => { const p = pointOf(place, role); return p ? { ...p, key: ptKey(place.id, role) } : null; };
  const placesOf = (view) => P.places.filter((p) => p.mode === MODE[view]);
  const regionsOf = (view) => P.regions[view];
  const glance = new Map(), clouds = new Map(), stations = new Map();
  let layers = [];
  const locOf = (map, key) => (map.get(key)?.status === "ok" ? map.get(key).loc : null);

  async function getJson(url) {
    const data = await net.fetchJson(url);
    if (data && data.error === true) throw new Error(data.reason || "error body");
    return data;
  }
  async function forecast(req, profile, into) {
    const Pr = M.PROFILES[profile];
    try {
      const data = await getJson(req.url);
      const locs = M.parseForecast(data, Pr.models, Pr.hourly);
      req.points.forEach((p, i) => into.set(p.key, locs[i] && locs[i].time.length ? { status: "ok", loc: locs[i] } : { status: "error" }));
    } catch {
      req.points.forEach((p) => into.set(p.key, { status: "error" }));
    }
  }
  function forecastJobs(pts, profile, into) {
    const todo = pts.filter((p) => p && !into.has(p.key));
    todo.forEach((p) => into.set(p.key, { status: "loading" }));
    return M.planRequests(todo, profile).map((req) => () => forecast(req, profile, into));
  }
  const runJobs = (jobs) => net.pool(jobs, 2, (job) => job());   // at most 2 Open-Meteo requests in flight
  function viewGlancePoints(view) {
    const out = new Map();
    for (const p of placesOf(view)) { const k = withKey(p, p.glance); if (k) out.set(k.key, k); }
    for (const r of regionsOf(view)) { const k = withKey(byId[r.anchor.place], r.anchor.role); if (k) out.set(k.key, k); }
    return [...out.values()];
  }
  const anchorPoints = (view) => regionsOf(view).map((r) => withKey(byId[r.anchor.place], r.anchor.role)).filter(Boolean);
  function anchorStation(region) {
    const a = byId[region.anchor.place], pt = pointOf(a, region.anchor.role);
    const sts = (a.snotel || []).filter((s) => fin(s.lat) && fin(s.lon));
    if (!pt || !sts.length) return null;
    return sts.reduce((b, s) => (M.miles(pt.lat, pt.lon, s.lat, s.lon) < M.miles(pt.lat, pt.lon, b.lat, b.lon) ? s : b));
  }
  async function loadLayers() {
    const res = await net.pool(CENTERS, 3, (c) => getJson(M.mapLayerUrl(c)));
    layers = res.filter((x) => x.ok).map((x) => x.value);
  }
  async function loadStations(view) {
    const sts = [...new Map(regionsOf(view).map(anchorStation).filter(Boolean).map((s) => [s.triplet, s])).values()];
    await fetchStations(sts.map((s) => s.triplet).filter((t) => !stations.has(t)));
  }
  async function fetchStations(trips) {
    if (!trips.length) return;
    trips.forEach((t) => stations.set(t, { status: "loading" }));
    try {
      const data = await getJson(M.snotelUrl(trips, "HOURLY", pstDay(nowMs - 36 * 3600000), `${pstDay(nowMs)} 23:59`, ["TOBS", "SNWD"]));
      const rows = M.parseSnotel(data);
      trips.forEach((t) => stations.set(t, { status: "ok", hourly: rows[t] || [] }));
    } catch { trips.forEach((t) => stations.set(t, { status: "error" })); }
  }

  // ---- fetch, the way loadView does for each view ----
  const omJobs = VIEWS.flatMap((v) => [...forecastJobs(viewGlancePoints(v), "glance", glance), ...forecastJobs(anchorPoints(v), "clouds", clouds)]);
  await Promise.all([runJobs(omJobs), loadLayers(), ...VIEWS.map(loadStations)]);
  if (![...glance.values()].some((g) => g.status === "ok")) throw new Error("no forecast data loaded (every Open-Meteo glance request failed)");
  // best_day reads each ski place's own station. One more SNOTEL request for the ones the anchors didn't bring; a failure drops those places from best_day.
  const ownStations = [...placesOf("resorts"), ...placesOf("backcountry")].map((p) => p.snotel?.[0]?.triplet).filter(Boolean);
  await fetchStations([...new Set(ownStations)].filter((t) => !stations.has(t)));

  // ---- view-model, the way rowZ / regionView / top3View build it ----
  const avalOf = (place) => M.avalFor(place, layers, nowMs);
  const verdicts = new Map();
  function rowZ(place) {
    const g = glance.get(ptKey(place.id, place.glance));
    const loc = g?.status === "ok" ? g.loc : null;
    const z = place.mode === "hike" ? M.hikeRowZ(place, loc, nowMs) : M.skiRowZ(place, loc, nowMs, avalOf(place));
    z.status = loc ? "ok" : "error";
    if (place.mode === "hike") z.rank.verdict = verdicts.get(place.id) || null;
    return z;
  }
  // Hike top three: clouds at the winners' high points, then their tomorrow AM verdict (loadHikeVerdicts).
  const t0 = M.top3Z("hike", placesOf("hike").map(rowZ));
  await runJobs(forecastJobs(t0.rows.map((r) => withKey(byId[r.id], "High")).filter(Boolean), "clouds", clouds));
  for (const r of t0.rows) {
    const pt = pointOf(byId[r.id], "High"), cl = locOf(clouds, ptKey(r.id, "High"));
    if (pt && cl) verdicts.set(r.id, M.tomorrowVerdict(cl, pt.elev_ft, nowMs));
  }

  // ---- digest pieces ----
  const missing = [];
  const zoneRefs = new Map();   // "center:zoneId" -> one place in that zone, for the avalanche list
  function avalDigest(a) {
    if (!a) return null;
    if (a.state === "link") return { center: "Avalanche Canada", state: "no-rating", level: 0, word: null };
    const state = a.state === "no rating" ? "no-rating" : a.state;
    const rated = state === "rated";
    return { center: a.c, state, level: rated ? a.l : 0, word: rated ? M.DANGER_NAMES[a.l] : null };
  }
  const zoneName = (a) => (a && a.state !== "link" ? a.zone ?? null : null);
  function noteZone(place) {
    const av = place.avalanche;
    if (!av || av.center === "AVCAN") return;
    zoneRefs.set(`${av.center}:${av.zone}`, place);
  }
  // "<CENTER>:<zone name>", the link between a named place and its avalanche[] entry. A zone whose layer
  // failed has no name to show, so its key falls back to the zone id ("NWAC:3021"). AvCan and no zone: null.
  function zoneKeyOf(place) {
    const av = place?.avalanche;
    if (!av || av.center === "AVCAN" || av.zone == null) return null;
    return `${av.center}:${zoneName(avalOf(place)) ?? av.zone}`;
  }
  // A region carries a zone only when every place in it maps to the same one (the page's range pill treats it the same way).
  function regionZone(mine) {
    const keys = new Set(mine.map((p) => (p.avalanche && p.avalanche.zone != null ? `${p.avalanche.center}:${p.avalanche.zone}` : "none")));
    if (keys.size !== 1 || keys.has("none")) return { zone: null, zone_key: null };
    return { zone: zoneName(avalOf(mine[0])), zone_key: zoneKeyOf(mine[0]) };   // its state is in avalanche[] under zone_key
  }

  function skiTop3Row(r) {
    const place = byId[r.id];
    const [lo, hi] = rangeOf(r.small.replace(/ est\.$/, ""));
    return { name: r.name, zone: zoneName(r.aval), zone_key: zoneKeyOf(place), at_ft: ftOf(r.at), value_in: dispVal(r.num.replace("″", "")), lo, hi, gust: r.gust,
      aval: avalDigest(r.aval ?? avalOf(place)) };
  }
  function hikeTop3Row(r) {
    const place = byId[r.id], a = avalOf(place);
    return { name: r.name, zone: zoneName(a), zone_key: zoneKeyOf(place), at_ft: ftOf(r.at), water_in: dispVal(r.num.replace("″", "")),
      verdict: r.verdict ? r.verdict[1] : null, gust: r.gust, aval: avalDigest(a) };
  }
  function next24Of(next) {
    if (!next) return null;
    const span = /<span class="nw">([^<]*(?:&lt;[^<]*)?)<\/span>/.exec(next.p);
    const [lo, hi] = span ? rangeOf(plain(span[1]).replace("″", "")) : [null, null];
    const text = plain(next.p);
    return { lo_f: next.lo, hi_f: next.hi, text, snow_lo_in: lo, snow_hi_in: hi, rain: /\brain at\b/.test(text) };
  }
  // Ski regions, today and the next three days (the TLDR covers today and the next 2-3 days; the 20 KB cap has no room
  // for all seven): per day, the lowest and highest of the region's mini bars (each read through fmtIn, as the rows show it),
  // and the snow level at the anchor from the page's snowLevel over that day's hours.
  function skiDays(region, zs, anchor, aGlance, aClouds) {
    const cl = M.withPrecip(aClouds, aGlance);
    const minFt = Math.min(...anchor.points.map((p) => p.elev_ft));
    const nIdx = aGlance ? M.nowIndex(aGlance, nowMs) : -1;
    const ymd0 = nIdx >= 0 ? aGlance.time[nIdx].slice(0, 10) : null;
    const cNow = cl ? M.nowIndex(cl, nowMs) : -1;
    const out = [];
    for (let d = 0; d < 4; d++) {
      const vals = zs.filter((z) => !z.glance.barsNA[d] && z.glance.days[d]).map((z) => z.glance.bars[d]);
      if (!vals.length) continue;
      const dow = zs.find((z) => z.glance.days[d]).glance.days[d];
      let snowLevel = null;
      if (cl && ymd0) {
        const ymd = M.addDays(ymd0, d);
        const idx = [];
        cl.time.forEach((t, i) => { if (t.startsWith(ymd) && (d > 0 || i > cNow)) idx.push(i); });
        snowLevel = idx.length ? M.snowLevelText(M.snowLevel(cl, idx, M.FREEZE_SHORT, minFt)) : null;
      }
      out.push({ dow, snow_in_lo: dispVal(M.fmtIn(Math.min(...vals))), snow_in_hi: dispVal(M.fmtIn(Math.max(...vals))), snow_level: snowLevel });
    }
    return out;
  }
  // Hike regions: the anchor's cloud verdict, AM and PM, today (until 5 PM local, as the card face) and tomorrow.
  function hikeClouds(aGlance, aClouds, ft) {
    const cl = M.withPrecip(aClouds, aGlance);
    if (!cl) return { today: null, tomorrow: null };
    const local = M.localHourString(nowMs, cl.utcOffset), ymd = local.slice(0, 10), hour = +local.slice(11, 13);
    const pair = (day, off) => {
      const [am, pm] = ["AM", "PM"].map((h) => M.cloudVerdict(cl, day, h, ft, off));
      return am || pm ? { am: M.wordFor(am)[1], pm: M.wordFor(pm)[1] } : null;
    };
    return { today: hour >= 17 ? null : pair(ymd, 0), tomorrow: pair(M.addDays(ymd, 1), 1) };
  }

  const usable = (p) => glance.get(ptKey(p.id, p.glance))?.status === "ok";
  function viewDigest(view) {
    const places = placesOf(view);
    places.forEach(noteZone);
    const zs = places.map(rowZ), zsById = Object.fromEntries(zs.map((z) => [z.id, z]));
    for (const p of places) if (!usable(p)) missing.push(p.title);
    const t = M.top3Z(view === "hike" ? "hike" : "ski", zs);
    const top3 = t.rows.map(view === "hike" ? hikeTop3Row : skiTop3Row);
    const regions = [];
    for (const rg of regionsOf(view)) {
      const mine = places.filter((p) => p.region === rg.id);
      const anchor = byId[rg.anchor.place], aKey = ptKey(anchor.id, rg.anchor.role);
      if (!locOf(glance, aKey) || !mine.every(usable)) { missing.push(rg.title); continue; }   // never a partial region
      const glanceByPlace = Object.fromEntries(mine.map((p) => [p.id, locOf(glance, ptKey(p.id, p.glance))]));
      const st = anchorStation(rg), sd = st ? stations.get(st.triplet) : null;
      const aGlance = locOf(glance, aKey), aClouds = locOf(clouds, aKey);
      const r = M.regionZ(rg, P.places, mine.map((p) => zsById[p.id]), glanceByPlace, { glance: aGlance, clouds: aClouds },
        st && sd?.status === "ok" ? { station: st, hourly: sd.hourly } : null, nowMs, NOUN[view]);
      const out = {
        name: r.name, ...regionZone(mine), spot: r.spot, spot_zone_key: zoneKeyOf(anchor),
        now: r.now ? { temp_f: r.now.t, word: r.now.w, source: r.now.source === "station" ? "SNOTEL" : "model", age_min: r.now.ageMin ?? null } : null,
        next24: next24Of(r.next), line: r.line,
      };
      if (view === "hike") {
        out.clouds = hikeClouds(aGlance, aClouds, pointOf(anchor, rg.anchor.role).elev_ft);
        const g = mine.map((p) => ({ p, z: zsById[p.id] })).filter((x) => x.z.rank.tomorrow).map((x) => ({ p: x.p, mph: Math.round(x.z.rank.tomorrow.gust) }));
        const top = g.length ? g.reduce((a, b) => (b.mph > a.mph ? b : a)) : null;
        const tmr = M.addDays(M.localHourString(nowMs, aGlance.utcOffset).slice(0, 10), 1);
        Object.assign(out, { gust_max_mph: top ? top.mph : null, gust_at: top ? top.p.title : null,
          gust_at_zone_key: top ? zoneKeyOf(top.p) : null, gust_day: top ? M.dow(tmr) : null });
      } else {
        out.days = skiDays(rg, mine.map((p) => zsById[p.id]), anchor, aGlance, aClouds);
      }
      regions.push(out);
    }
    const md = { top3, regions };
    if (t.partial) md.partial = t.partial;
    if (t.empty) md.empty = /unavailable/i.test(t.empty) ? "unavailable" : t.empty;   // page wording, not the writer's
    return md;
  }

  const modes = Object.fromEntries(VIEWS.map((v) => [v, viewDigest(v)]));
  const avalanche = [];
  for (const place of zoneRefs.values()) {
    const a = avalOf(place), d = avalDigest(a);
    avalanche.push({ key: zoneKeyOf(place), center: d.center, zone: zoneName(a), state: d.state, level: d.level, word: d.word, link: a?.url ?? null });
  }

  // ---- picks ----
  const gone = [...new Set(missing)];
  // A broken pick reads null. It never stops the run: the rest of the digest still publishes.
  function safely(name, build) {
    try { return build(); }
    catch (e) { process.stderr.write(`digest: pick ${name} left out: ${String(e?.message || e).split("\n")[0]}\n`); return null; }
  }
  // Same place set for both ski picks. The title check matters: a place can load while another of its name fails (resort and
  // backcountry Stevens Pass), and a name in missing is one the checker rejects.
  const skiPlaces = () => [...placesOf("resorts"), ...placesOf("backcountry")].filter((p) => usable(p) && !gone.includes(p.title));
  function mostSnowPick() {
    const zs = skiPlaces().map(rowZ);
    const row = M.top3Z("ski", zs).rows[0];
    if (!row || !(zs.find((z) => z.id === row.id).rank.n24.precip.value >= M.PICK.stormIn)) return null;
    const loc = locOf(glance, ptKey(row.id, byId[row.id].glance));
    return { ...skiTop3Row(row), quality: M.snowQuality(M.snowRatio(loc, M.nowIndex(loc, nowMs))) };
  }
  // Depth at the place's own nearest station (snotel is nearest first): the page's latest reading, finite and at most 36 h old.
  // null: no station speaks for this place, so a storm can still qualify it.
  // undefined: one should have answered and didn't. The base is unknown, and a measurement might have ruled the place out, so it can't compete.
  function baseOf(place) {
    const st = place.snotel?.[0];
    if (!st || !M.stationSpeaks(st.elev_ft, Math.min(...place.points.map((x) => x.elev_ft)))) return null;
    const sd = stations.get(st.triplet);
    return sd?.status === "ok" ? M.depthReading({ hourly: sd.hourly }, nowMs)?.depth : undefined;
  }
  // Forecast snow before a day, for ranking only. Offset 0: today's hours up to now. Offset 1: all of today. Offset 2: today and tomorrow.
  // Yesterday is out of reach: the forecast data starts at local midnight today.
  function freshBefore(loc, n, ymd0, offset) {
    const wholeDay = (d) => M.daySummary(loc, M.addDays(ymd0, d), d, -1)?.snow?.value ?? 0;
    const midnight = loc.time.indexOf(`${ymd0}T00:00`);
    const inches = offset === 0 ? M.windowTotals(loc, midnight, n - midnight).snow?.value ?? 0 : wholeDay(0) + (offset === 2 ? wholeDay(1) : 0);
    return Math.round(inches * 10) / 10;
  }
  function bestDayPick() {
    if (![...stations.values()].some((s) => s.status === "ok")) return null;   // SNOTEL down: nothing to compare against
    const cands = [];
    for (const p of skiPlaces()) {
      const loc = locOf(glance, ptKey(p.id, p.glance)), n = M.nowIndex(loc, nowMs);
      if (n < 0) continue;
      const baseIn = baseOf(p);
      if (baseIn === undefined) continue;
      const local = M.localHourString(nowMs, loc.utcOffset), ymd0 = local.slice(0, 10);
      for (const offset of [0, 1, 2]) {
        if (offset === 0 && +local.slice(11, 13) >= 11) continue;
        const ymd = M.addDays(ymd0, offset);
        if (p.mode === "resort" && !M.resortSeason(ymd)) continue;
        const s = M.daySummary(loc, ymd, offset, offset === 0 ? n : -1);
        if (M.niceDay(s)) cands.push({ id: p.id, offset, gust: s.gust.value, freshIn: freshBefore(loc, n, ymd0, offset), baseIn, s });
      }
    }
    const c = M.bestSkiDay(cands);
    if (!c) return null;
    const p = byId[c.id];
    return { name: p.title, zone_key: zoneKeyOf(p), day: M.dow(c.s.ymd), gust: rnd(c.gust), hi_f: rnd(c.s.hi.value), lo_f: rnd(c.s.lo?.value),
      fresh: c.freshIn >= M.PICK.freshIn, sky: M.skyWord(c.s), aval: avalDigest(avalOf(p)) };
  }
  // modes.hike.top3[0], built from the same row. A row whose name is in missing can't be used, so the next one stands in.
  function hikePick() {
    const zs = placesOf("hike").map(rowZ);
    const row = M.top3Z("hike", zs).rows.find((r) => !gone.includes(r.name));
    if (!row) return null;
    const t = zs.find((z) => z.id === row.id).rank.tomorrow;
    return { ...hikeTop3Row(row), day: M.dow(t.ymd), hi_f: rnd(t.hi) };
  }

  // place_index: every name a writer may use -> its zone key. Place, region and spot names come first; a name that two
  // of them use with different zone keys is ambiguous and left out. Zone names fill in only where no such name exists.
  // Nothing in missing is ever indexed, even when another source still carries that name.
  const index = new Map(), ambiguous = new Set();
  const add = (name, key) => {
    if (!name || ambiguous.has(name)) return;
    if (index.has(name) && index.get(name) !== key) { index.delete(name); ambiguous.add(name); return; }
    index.set(name, key);
  };
  for (const md of Object.values(modes)) {
    for (const row of md.top3) add(row.name, row.zone_key);
    for (const r of md.regions) { add(r.name, r.zone_key); add(r.spot, r.spot_zone_key); add(r.gust_at, r.gust_at_zone_key); }
  }
  // A pick whose name already means another zone can't be written, so it reads null and the name keeps its meaning.
  const named = (pick) => {
    if (!pick) return null;
    if (ambiguous.has(pick.name) || (index.has(pick.name) && index.get(pick.name) !== pick.zone_key)) return null;
    add(pick.name, pick.zone_key);
    return pick;
  };
  const picks = {
    ski: { most_snow: named(safely("most_snow", mostSnowPick)), best_day: named(safely("best_day", bestDayPick)) },
    hike: { best: named(safely("hike", hikePick)) },
  };
  for (const a of avalanche) if (a.zone && !index.has(a.zone) && !ambiguous.has(a.zone)) index.set(a.zone, a.key);
  for (const m of gone) index.delete(m);
  const place_index = Object.fromEntries(index);

  const numbers = [...collectNumbers([Object.values(modes).map((m) => [m.top3, m.regions, m.partial, m.empty]), picks], new Set())].sort((a, b) => a - b);
  return { at: isoPacific(nowMs), modes, picks, avalanche, numbers, place_index, places: Object.keys(place_index), ambiguous: [...ambiguous], missing: gone };
}

// JSON a person can skim and a model can read, kept small: one line per top3 row, region and avalanche zone
// (anything up to 1,000 characters), every array of plain values on one line; larger values open up one level.
export function layout(v, pad = "") {
  const flat = JSON.stringify(v);
  if (v === null || typeof v !== "object" || flat.length <= 1000) return flat;
  if (Array.isArray(v) && v.every((x) => x === null || typeof x !== "object")) return flat;
  const inner = pad + " ";
  const items = Array.isArray(v)
    ? v.map((x) => inner + layout(x, inner))
    : Object.entries(v).map(([k, x]) => `${inner}${JSON.stringify(k)}: ${layout(x, inner)}`);
  return `${Array.isArray(v) ? "[" : "{"}\n${items.join(",\n")}\n${pad}${Array.isArray(v) ? "]" : "}"}`;
}

/* ---------- CLI ---------- */
function fail(msg, code = 1) { process.stderr.write(`digest: ${msg}\n`); process.exit(code); }
async function main(argv) {
  const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  const rootArg = arg("--root"), out = arg("--out");
  if (!rootArg) fail("usage: node tldr/digest.mjs --root <deploy root> [--out digest.json] [--saved]", 2);
  const root = path.resolve(rootArg);
  const lack = [...NEEDED, "places.json"].filter((f) => !fs.existsSync(path.join(root, f)));
  if (lack.length) fail(`--root ${root} is not a deploy root (missing ${lack.join(", ")})`, 2);
  // Dynamic import: the deployed copy has no scripts/, so the helper loads only when --saved is given. No flag means live fetch, as before.
  const fetchImpl = argv.includes("--saved")
    ? (await import(new URL("../scripts/saved_fetch.mjs", import.meta.url))).savedFetch({ log: () => {} })
    : undefined;
  let d;
  try { d = await buildDigest({ codeDir: root, placesPath: path.join(root, "places.json"), fetchImpl }); }
  catch (e) { fail(String(e?.message || e).split("\n")[0]); }
  let json = layout(d) + "\n";
  if (Buffer.byteLength(json) >= 20480) json = JSON.stringify(d) + "\n";   // compact when the readable form runs long
  if (Buffer.byteLength(json) >= 20480) process.stderr.write(`digest: warning, ${Buffer.byteLength(json)} bytes (over 20 KB)\n`);
  if (out) fs.writeFileSync(out, json); else process.stdout.write(json);
}
// Run as a script, not when imported. Compare real paths: on macOS the temp dir is /var -> /private/var,
// and import.meta.url carries the resolved one.
const isMain = (() => { try { return import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href; } catch { return false; } })();
if (isMain) main(process.argv.slice(2));
