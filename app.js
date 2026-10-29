// page/app.js
// Fetches every source on open. Claude is not in the loop for data.
import { snowFromHourly, wetness, deck, trendWord, fullWindow } from "./engine.js";

const OM = "https://api.open-meteo.com/v1/forecast";
const AWDB = "https://wcc.sc.egov.usda.gov/awdbRestApi/services/v1";
const AVY = "https://api.avalanche.org/v2/public/products/map-layer/NWAC";
const TZ = "America/Los_Angeles";
const MODELS = ["ecmwf_ifs025", "gfs_seamless", "gem_hrdps_continental", "icon_seamless"];
const OUTLOOK = ["ecmwf_ifs025", "gfs_seamless"];
const FIELDS = "temperature_2m,precipitation,wind_gusts_10m,cloud_cover_low,cloud_cover_850hPa";
const DANGER = { 1: "Low", 2: "Moderate", 3: "Considerable", 4: "High", 5: "Extreme" };
const FORECAST_DAYS = 10;

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function nowParts() {
  const d = new Date();
  const ymd = d.toLocaleDateString("en-CA", { timeZone: TZ });                       // YYYY-MM-DD
  const hour = Number(d.toLocaleString("en-US", { timeZone: TZ, hour: "numeric", hourCycle: "h23" }));
  return { ymd, hour };
}
function addDays(ymd, n) {
  const d = new Date(ymd + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function dow(ymd) { return new Date(ymd + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }); }
function md(ymd) { return ymd.slice(5).replace("-", "/"); }

async function j(url, retry = 1) {
  const r = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8000) });
  if (r.status === 429 && retry > 0) {
    await new Promise((res) => setTimeout(res, 1500));
    return j(url, retry - 1);
  }
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

async function pool(items, limit, fn) {
  const queue = [...items];
  const run = async () => { while (queue.length) await fn(queue.shift()); };
  await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, run));
}

// ---------- forecast ----------
function omUrl(z, bandsFt) {
  const n = bandsFt.length;
  const lat = Array(n).fill(z.lat).join(","), lon = Array(n).fill(z.lon).join(",");
  const el = bandsFt.map((b) => Math.round(b / 3.28084)).join(",");
  return `${OM}?latitude=${lat}&longitude=${lon}&elevation=${el}&hourly=${FIELDS}` +
    `&models=${MODELS.join(",")}&temperature_unit=fahrenheit&wind_speed_unit=mph` +
    `&precipitation_unit=inch&timezone=${TZ}&forecast_days=${FORECAST_DAYS + 1}`;
}

function col(h, key, m) { return h[`${key}_${m}`] || null; }

function daySummary(h, ymd) {
  // Daylight window 8a-5p for temps/precip/cloud/gust; all 24 hours for snow.
  const day = [], all = [];
  h.time.forEach((t, i) => { if (t.startsWith(ymd)) { all.push(i); const hr = Number(t.slice(11, 13)); if (hr >= 8 && hr <= 17) day.push(i); } });
  if (!day.length) return null;
  const per = {};
  for (const m of MODELS) {
    const T = col(h, "temperature_2m", m), P = col(h, "precipitation", m), G = col(h, "wind_gusts_10m", m);
    const L = col(h, "cloud_cover_low", m), C = col(h, "cloud_cover_850hPa", m);
    if (!T || !P) continue;
    const pick = (arr, idx) => idx.map((i) => arr[i]).filter((v) => v != null);
    if (!fullWindow(T, day)) continue;
    const t = pick(T, day);
    const p = pick(P, day), l = L ? pick(L, day) : [], c = C ? pick(C, day) : [], g = G ? pick(G, day) : [];
    per[m] = {
      tmin: Math.min(...t), tmax: Math.max(...t), precip: p.reduce((a, b) => a + b, 0),
      low: l.length ? l.reduce((a, b) => a + b, 0) / l.length : null,
      c850: c.length ? c.reduce((a, b) => a + b, 0) / c.length : null,
      gust: g.length ? Math.max(...g) : null,
      snow: snowFromHourly(all.map((i) => T[i]), all.map((i) => P[i])),
    };
  }
  return Object.keys(per).length ? per : null;
}

function rowText(per, elevFt) {
  const vals = Object.values(per);
  const tmin = Math.min(...vals.map((v) => v.tmin)), tmax = Math.max(...vals.map((v) => v.tmax));
  const prs = vals.map((v) => v.precip), sn = Math.max(...vals.map((v) => v.snow));
  const gust = Math.max(...vals.map((v) => v.gust ?? 0));
  const lows = vals.map((v) => v.low).filter((v) => v != null), c8s = vals.map((v) => v.c850).filter((v) => v != null);
  const parts = [`${Math.round(tmin)}-${Math.round(tmax)}F`, wetness(prs)];
  if (sn > 0.3) parts.push(`snow to ${sn.toFixed(1)}"`);
  if (gust >= 35) parts.push(`gusts ${Math.round(gust)}`);
  if (lows.length && c8s.length) {
    const d = deck(lows.reduce((a, b) => a + b, 0) / lows.length, c8s.reduce((a, b) => a + b, 0) / c8s.length, elevFt);
    if (!d.startsWith("mixed")) parts.push(d);
  }
  return parts.join(" · ");
}

function outlookText(days) {
  // days: [{ymd, per}] for days 3-6, ECMWF + GFS only
  return days.map(({ ymd, per }) => {
    const sub = OUTLOOK.filter((m) => per[m]).map((m) => per[m]);
    if (!sub.length) return `${dow(ymd)} ?`;
    return `${dow(ymd)} ${trendWord(sub.map((v) => v.precip), Math.max(...sub.map((v) => v.snow)))}`;
  }).join(" · ");
}

// ---------- SNOTEL ----------
function parseSnotel(raw) {
  const out = {};
  for (const st of raw || []) {
    const by = {};
    for (const el of st.data || []) {
      const code = el.stationElement.elementCode.toLowerCase();
      for (const v of el.values || []) {
        by[v.date] ??= { date: v.date, snwd: null, wteq: null };
        by[v.date][code] = v.value ?? null;
      }
    }
    out[st.stationTriplet] = Object.keys(by).sort().map((d) => by[d]);
  }
  return out;
}
function storms(rows) {
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1], b = rows[i];
    if (a.snwd == null || b.snwd == null) continue;
    const nw = Math.max(b.snwd - a.snwd, 0);
    const water = (a.wteq != null && b.wteq != null) ? Math.round((b.wteq - a.wteq) * 10) / 10 : null;
    const slr = (nw >= 1 && water && water >= 0.1) ? Math.floor(nw / water + 0.5) : null;   // half up, matches snotel.py
    out.push({ date: b.date, depth: b.snwd, new: nw, water, slr });
  }
  return out;
}

// ---------- NWAC ----------
function nwacPill(f) {
  if (!f) return "";
  const p = f.properties;
  if (p.off_season) return `<span class="pill">NWAC off-season</span>`;
  const lvl = Math.max(p.danger_level ?? 0, 0);
  if (lvl < 1) return `<span class="pill">NWAC no rating</span>`;
  const cls = lvl >= 4 ? "pill pill-crit" : lvl >= 3 ? "pill pill-warn" : "pill";
  const label = `NWAC ${esc(DANGER[lvl] || p.danger)}`;
  return typeof p.link === "string" && p.link.startsWith("https://")
    ? `<a class="${cls}" href="${esc(p.link)}" target="_blank" rel="noopener">${label}</a>`
    : `<span class="${cls}">${label}</span>`;
}

// ---------- bars ----------
function barsSvg(past, future, todayYmd) {
  // past: [{date, new}], future: [{ymd, min, max, ecm}]. 17 slots, 20px each.
  const W = 340, H = 100, top = 14, base = 74, slot = 20;
  const vals = [...past.map((d) => d.new), ...future.map((d) => d.max)];
  const ymax = Math.max(1, ...vals);
  const y = (v) => base - (v / ymax) * (base - top);
  let s = `<svg class="bars" viewBox="0 0 ${W} ${H}" role="img" aria-label="snow per day, measured then forecast">`;
  let x = 0;
  for (const d of past) {
    const h = base - y(d.new);
    s += `<rect class="measured" x="${x + 3}" y="${y(d.new)}" width="${slot - 6}" height="${h}"/>`;
    if (d.new >= 1) s += `<text class="val" x="${x + slot / 2}" y="${y(d.new) - 3}" text-anchor="middle">${d.new}</text>`;
    s += `<text x="${x + slot / 2}" y="${base + 11}" text-anchor="middle">${dow(d.date)[0]}</text>`;
    x += slot;
  }
  s += `<line class="today" x1="${x}" y1="${top - 6}" x2="${x}" y2="${base + 14}"/>`;
  s += `<text x="${x + 2}" y="${base + 22}">today</text>`;
  for (const d of future) {
    const yMax = y(d.max), yMin = y(d.min);
    s += `<rect class="forecast" x="${x + 3}" y="${yMax}" width="${slot - 6}" height="${Math.max(base - yMax, 1)}"/>`;
    s += `<rect class="measured" x="${x + 3}" y="${yMin}" width="${slot - 6}" height="${Math.max(base - yMin, 0)}" opacity="0.35"/>`;
    if (d.ecm != null) s += `<line class="ecm" x1="${x + 3}" y1="${y(d.ecm)}" x2="${x + slot - 3}" y2="${y(d.ecm)}"/>`;
    if (d.max >= 1) s += `<text class="val" x="${x + slot / 2}" y="${yMax - 3}" text-anchor="middle">${Math.round(d.max)}</text>`;
    s += `<text x="${x + slot / 2}" y="${base + 11}" text-anchor="middle">${dow(d.ymd)[0]}</text>`;
    x += slot;
  }
  s += `<text x="${W - 2}" y="${top - 6}" text-anchor="end">${ymax.toFixed(0)}" max</text></svg>`;
  return s;
}

// ---------- render ----------
function zoneShell(name, z, nwac) {
  return `<article class="zone" id="z-${name}">
    <div class="zone-head"><b>${esc(z.label)}</b><span class="small muted">${z.elev_ft.toLocaleString()} ft</span>${nwac}</div>
    <div class="row"><span class="row-k">24 h</span><span class="row-v muted" data-r="d0">loading</span></div>
    <div class="row"><span class="row-k">48 h</span><span class="row-v muted" data-r="d1">loading</span></div>
    <div class="row"><span class="row-k">outlook</span><span class="row-v muted" data-r="out">loading</span></div>
    <div class="snow" data-r="snow" hidden></div>
  </article>`;
}

function renderZone(name, z, locs, bandsFt, snot, start) {
  const el = $(`#z-${name}`);
  const set = (k, html, muted = false) => { const n = el.querySelector(`[data-r="${k}"]`); n.innerHTML = html; n.classList.toggle("muted", muted); };
  if (!locs) { set("d0", "forecast failed", true); set("d1", "", true); set("out", "", true); return; }
  const h = locs[locs.length - 1].hourly;                 // the zone's own point, always last
  const d0 = daySummary(h, addDays(start, 0)), d1 = daySummary(h, addDays(start, 1));
  set("d0", d0 ? `<span class="muted small">${dow(addDays(start, 0))} ${md(addDays(start, 0))}</span> ${esc(rowText(d0, z.elev_ft))}` : "no data", !d0);
  set("d1", d1 ? `<span class="muted small">${dow(addDays(start, 1))} ${md(addDays(start, 1))}</span> ${esc(rowText(d1, z.elev_ft))}` : "no data", !d1);
  const outDays = [2, 3, 4, 5].map((n) => ({ ymd: addDays(start, n), per: daySummary(h, addDays(start, n)) })).filter((d) => d.per);
  set("out", outDays.length ? esc(outlookText(outDays)) : "no data", !outDays.length);

  // snow panel: show when measured depth > 0, or any model forecasts >= 0.3" on any of the next 10 days
  const station = z.snotel && z.snotel[0];
  const rows = station ? (snot[station.triplet] || []) : [];
  const past = storms(rows).slice(-7);
  const depth = [...rows].reverse().find((r) => r.snwd != null)?.snwd ?? null;
  const barBandsFt = bandsFt.length ? bandsFt : [z.elev_ft];
  const barLocs = bandsFt.length ? locs.slice(0, bandsFt.length) : [locs[locs.length - 1]];
  const perBand = barBandsFt.map((_, bi) => {
    const hb = barLocs[bi].hourly;
    return Array.from({ length: FORECAST_DAYS }, (_, n) => {
      const ymd = addDays(nowParts().ymd, n);
      const per = daySummary(hb, ymd);
      if (!per) return { ymd, min: 0, max: 0, ecm: null };
      const sn = Object.values(per).map((v) => v.snow);
      return { ymd, min: Math.min(...sn), max: Math.max(...sn), ecm: per.ecmwf_ifs025 ? per.ecmwf_ifs025.snow : null };
    });
  });
  const anyForecast = perBand.some((b) => b.some((d) => d.max >= 0.3));
  if (!(depth > 0) && !anyForecast) return;
  const panel = el.querySelector('[data-r="snow"]');
  panel.hidden = false;
  let band = barBandsFt.length - 1;
  const draw = () => {
    const bandLabel = barBandsFt.length > 1
      ? `<div class="band-toggle" role="group" aria-label="elevation band">${barBandsFt.map((b, i) => `<button type="button" data-b="${i}" aria-pressed="${i === band}">${b.toLocaleString()}</button>`).join("")}</div>`
      : `<span class="small muted">at ${z.elev_ft.toLocaleString()} ft</span>`;
    const last = [...past].reverse().find((d) => d.new >= 1);
    const meas = station
      ? `<span><b>${depth ?? "?"}"</b> at ${esc(station.name)} ${station.elev_ft.toLocaleString()} ft${last ? ` · last storm ${md(last.date)}: ${last.new}"${last.water != null ? ` on ${last.water}" water` : ""}${last.slr ? ` = ${last.slr}:1` : ""}` : ""}${station.note ? ` · ${esc(station.note)}` : ""}</span>`
      : `<span class="muted">no station</span>`;
    const through = rows.length ? `through ${md(rows[rows.length - 1].date)}` : "";
    panel.innerHTML = `<div class="meta">${meas}${bandLabel}</div>${barsSvg(past, perBand[band], nowParts().ymd)}
      <div class="legend"><span><i class="m"></i>measured new ${through}</span><span><i class="f"></i>forecast range, ECMWF tick</span></div>`;
    panel.querySelectorAll("button[data-b]").forEach((b) => b.addEventListener("click", () => { band = Number(b.dataset.b); draw(); }));
  };
  draw();
}

async function main() {
  const { ymd, hour } = nowParts();
  const start = hour >= 15 ? addDays(ymd, 1) : ymd;      // after 3 PM "next 24" is tomorrow
  $("#asof").textContent = new Date().toLocaleString("en-US", { timeZone: TZ, weekday: "short", hour: "numeric", minute: "2-digit" });
  $("#refresh").addEventListener("click", () => location.reload());

  const [cfg, cams] = await Promise.all([j("zones.json"), j("cams.json")]);

  // Claude's block, if a run has written one
  fetch("claude.json", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((c) => {
    if (!c || !c.call) return;
    $("#claude-call").textContent = c.call;
    $("#claude-lines").innerHTML = (c.lines || []).map((l) => `<div>${esc(l)}</div>`).join("");
    $("#claude-asof").textContent = `Claude's read, ${c.as_of}`;
    $("#claude").hidden = false;
  }).catch(() => {});

  // cams: plain images, cache-busted; drop any that fail
  const t = Date.now();
  const camZones = new Set(Object.values(cfg.zones).map((z) => z.cam_zone).filter(Boolean));
  $("#cams").innerHTML = cams.cams.filter((c) => camZones.has(c.zone)).map((c) =>
    `<figure class="cam"><img src="${esc(c.url)}${c.url.includes("?") ? "&" : "?"}t=${t}" alt="${esc(c.name)}" loading="lazy" onerror="this.closest('figure').remove()">
     <figcaption>${esc(c.name)} · ${c.elev_ft.toLocaleString()} ft${c.proxy ? " · proxy" : ""}</figcaption></figure>`).join("");

  // zone shells, grouped, NWAC pill from the map layer
  let avy = {};
  try { const m = await j(AVY); for (const f of m.features) avy[f.id] = f; } catch (e) { avy = null; }
  const groups = {};
  for (const [name, z] of Object.entries(cfg.zones)) (groups[z.group || "Other"] ??= []).push([name, z]);
  $("#zones").innerHTML = Object.entries(groups).map(([g, zs]) =>
    `<div class="group"><h2>${esc(g)}</h2>${zs.map(([name, z]) => {
      const ski = cfg.ski && cfg.ski.zones[name];
      return zoneShell(name, z, avy && ski ? nwacPill(avy[ski.nwac_zone]) : (avy === null && ski ? `<span class="pill">NWAC unavailable</span>` : ""));
    }).join("")}</div>`).join("");

  // SNOTEL, one request for every station
  const trips = [...new Set(Object.values(cfg.zones).flatMap((z) => (z.snotel || []).map((s) => s.triplet)))];
  const end = ymd, begin = addDays(ymd, -8);
  let snot = {};
  try {
    snot = parseSnotel(await j(`${AWDB}/data?stationTriplets=${trips.join(",")}&elements=SNWD,WTEQ&duration=DAILY&beginDate=${begin}&endDate=${end}&periodRef=END`));
  } catch (e) { $("#status").textContent += " SNOTEL unavailable this load."; }

  // forecasts, one request per zone, rendered as each lands
  await pool(Object.entries(cfg.zones), 2, async ([name, z]) => {
    try {
      const ski = cfg.ski && cfg.ski.zones[name];
      const bandsFt = ski ? ski.bands_ft : [];
      const locsFt = [...bandsFt, z.elev_ft];                       // summit point last, always
      let locs = null;
      try { const d = await j(omUrl(z, locsFt)); locs = Array.isArray(d) ? d : [d]; } catch (e) { locs = null; }
      if (locs && (locs.length !== locsFt.length || locs.some((l) => !l || !l.hourly))) locs = null;
      renderZone(name, z, locs, bandsFt, snot, start);
    } catch (e) {
      const el = $(`#z-${name}`);
      if (el) el.querySelectorAll('[data-r]').forEach((n, i) => { n.textContent = i === 0 ? "forecast failed" : ""; n.classList.add("muted"); });
    }
  });
}

main().catch((e) => { $("#status").textContent = `Page failed to load: ${e.message}`; });
