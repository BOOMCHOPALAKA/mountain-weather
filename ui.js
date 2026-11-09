// page/ui.js
// The v3 page renderers (Weather Window), ported from mock/v3/index.html at 918282a onto the view-models: page/guide.js
// (the landing) and page/place.js (the place view). Pure: model in, HTML string out. No DOM, no fetch, no storage; the
// DOM writes are page/app.js (Task 11). Every value from data is escaped here.
// Atoms the mock shares with the v2 page come from page/render.js. This file writes no dash glyph for a missing value
// (plan Global constraints, Question 7): missing numbers print "n/a" or nothing. Dashes that still show come from vm.js
// placeholders or the render.js atoms, both parked for Plan 3.
import { esc, info, pill, gust, star, verdict, trio, strip, condLine, hikeRows, cloudChart, snowBands, elevSection,
  miniBars as miniBarsZ, briefSection, OD, UNAVAILABLE, CREDITS, DISCLAIMER } from "./render.js";
import { TABS } from "./place.js";
import { lineAbove, lineUnknown } from "./engine/snowline.js";
import { cloudSentence } from "./engine/plainclouds.js";
import { DANGER_NAMES } from "./engine/avalanche.js";
import { WX_LABEL } from "./guide.js";
import { fmtNum, fmtIn, fmtWater } from "./vm.js";

export { TABS };

const fin = (x) => typeof x === "number" && Number.isFinite(x);
const href = (u) => (typeof u === "string" && /^https:\/\//.test(u) ? esc(u) : null);
const slug = (s) => String(s).replace(/[^A-Za-z0-9_-]/g, "_");
const NA = "n/a";
const LOADING = "Loading";
const deg = (x) => (fin(x) ? `${Math.round(x)}°` : NA);
const DANGER = (l) => DANGER_NAMES[l] || "";
const capFirst = (w) => (w ? w[0].toUpperCase() + w.slice(1) : w);
const status = (pending) => (pending ? LOADING : UNAVAILABLE);
// The slot's day offset from its id: now and later are today; d1 to d6 are days ahead.
const offOf = (when) => (/^d\d$/.test(when || "") ? +when.slice(1) : 0);

/* ---------- weather icons (mock round 2): inline SVG, currentColor, colored by .wx .s/.c/.r/.f/.m ---------- */
const CLOUD = '<path class="c" d="M7 30h20.5a6.5 6.5 0 0 0 .6-13 9 9 0 0 0-17.3 2.2A5.5 5.5 0 0 0 7 30z" fill="currentColor"/>';
const SUN_RAYS = (cx, cy, r, ray) => Array.from({ length: 8 }, (_, k) => { const a = (k * Math.PI) / 4, c = Math.cos(a), s = Math.sin(a); return `M${(cx + c * (r + 3)).toFixed(1)} ${(cy + s * (r + 3)).toFixed(1)}L${(cx + c * (r + 3 + ray)).toFixed(1)} ${(cy + s * (r + 3 + ray)).toFixed(1)}`; }).join("");
export const WX = {
  sun: `<g class="s"><circle cx="20" cy="20" r="7.5" fill="currentColor"/><path d="${SUN_RAYS(20, 20, 7.5, 5)}" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></g>`,
  partly: `<g class="s"><circle cx="14" cy="14" r="6" fill="currentColor"/><path d="${SUN_RAYS(14, 14, 6, 3.6)}" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></g><g transform="translate(6 7)"><path class="c" d="M7 30h20.5a6.5 6.5 0 0 0 .6-13 9 9 0 0 0-17.3 2.2A5.5 5.5 0 0 0 7 30z" fill="currentColor" stroke="var(--surface)" stroke-width="2"/></g>`,
  cloudy: `<g transform="translate(2 1)">${CLOUD}</g>`,
  rain: `<g transform="translate(2 -4)">${CLOUD}</g><path class="r" d="M13 30l-2.5 6M20 30l-2.5 6M27 30l-2.5 6" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>`,
  snow: `<g transform="translate(2 -4)">${CLOUD}</g><g class="f" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 29v7M8.9 30.7l6.2 3.6M8.9 34.3l6.2-3.6"/><path d="M26 29v7M22.9 30.7l6.2 3.6M22.9 34.3l6.2-3.6"/></g>`,
  mixed: `<g transform="translate(2 -4)">${CLOUD}</g><path class="r" d="M13 30l-2.5 6" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/><g class="f" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M25 29v7M21.9 30.7l6.2 3.6M21.9 34.3l6.2-3.6"/></g>`,
  moon: `<path class="m" d="M24.5 6.5a13 13 0 1 0 9 22.5 11 11 0 0 1-9-22.5z" fill="currentColor"/>`,
};
// "Now" on a row reads the model's weather code: 0-1 Sunny (Clear at night), 2 Partly sunny (Cloudy at night), 3/45/48
// Cloudy, 71-77 and 85-86 Snow, everything else wet (drizzle, rain, showers, storms) Rain.
export function wxKeyCode(code, night) {
  if (!fin(code)) return null;
  if (code <= 1) return night ? "moon" : "sun";
  if (code === 2) return night ? "cloudy" : "partly";
  if (code === 3 || code === 45 || code === 48) return "cloudy";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
  return "rain";
}
// The icon with its label under it (label: false when the label sits beside it in the same component).
export function wxIcon(key, label = true, text = null) {
  if (!key || !WX[key]) return `<span class="wx"><span class="wx-t">${NA}</span></span>`;
  const t = text || WX_LABEL[key];
  return `<span class="wx"><svg viewBox="0 0 40 40" aria-hidden="true" focusable="false">${WX[key]}</svg>${label ? `<span class="wx-t">${esc(t)}</span>` : `<span class="vh">${esc(t)}</span>`}</span>`;
}

/* ---------- small parts ---------- */
// Round 11: the chevron that says a row opens.
export const ROW_CHEV = '<svg class="chev row-chev" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 6l5 5 5-5" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>';
const CHEV = '<svg class="chev" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 6l5 5 5-5" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>';
const CAM_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7h4l2-2h6l2 2h4v12H3z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><circle cx="12" cy="13" r="3.5" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
// 7 small bars, one per day from today. g: { bars, barsNA, aria }.
export const miniBars = (g) => miniBarsZ({ glance: g || {} });
// The Snow card and the Resorts view show 5 days, the same days their total adds up.
export const five = (g) => ({ ...g, bars: (g.bars || []).slice(0, 5), barsNA: (g.barsNA || []).slice(0, 5),
  aria: g.aria && g.aria.includes(": ") ? `Next 5 days snow, est.: ${g.aria.split(": ")[1].split(", ").slice(0, 5).join(", ")}` : g.aria });

/* ---------- the weather window (plan Task 10, exact markup; dark band: architect ruling, Task 9 review) ---------- */
// The short window line on a pick or a row. aria-hidden: the pick's and the row's accessible names already carry it.
// A window time never splits across lines (Plan 3 re-review N1): a no-break space joins the number and AM or PM ("~4 PM",
// "7 AM"); "~" and the number already hold together. Only the rendered line: names, tests and the TLDR keep plain spaces.
export const keepTimes = (t) => String(t).replace(/(\d)\s+(AM|PM)(?![A-Za-z])/g, "$1\u00a0$2");
export const wline = (text) => (text ? `<span class="wline" aria-hidden="true">${esc(keepTimes(text))}</span>` : "");
// One day's hour strip. s: place.hourStrip(...) result. The dark hours get their own 4 px band under the cells; the
// visually hidden sentence names them too, so color is never the only signal.
export function hourStrip(s) {
  const cls = (c) => ["hs-h", c.past ? "past" : c.open ? "open" : "shut", !c.open && /snow/.test(c.why || "") ? "snowy" : "", c.why === "gusts" ? "windy" : "", c.dark && !c.past ? "dark" : ""].filter(Boolean).join(" ");
  const cells = s.cells.map((c) => `<li class="${cls(c)}"></li>`).join("");
  // Reason labels only over closed runs of 3 hours or more (architect ruling, Task 10); a shorter closure keeps its hatch and
  // is named in the caption and the hidden sentence.
  const why = s.runs.filter((r) => r.why && r.to - r.from >= LABEL_MIN_H).map((r) => `<span style="grid-column:${r.from - 5} / ${r.to - 5}">${esc(r.why)}</span>`).join("");
  const dark = [];
  for (const c of s.cells) {
    if (!c.dark || c.past) continue;
    const r = dark[dark.length - 1];
    if (r && r.to === c.h) r.to = c.h + 1; else dark.push({ from: c.h, to: c.h + 1 });
  }
  const band = dark.map((r) => `<span style="grid-column:${r.from - 5} / ${r.to - 5}"></span>`).join("");
  return `<figure class="hstrip"><figcaption><b>${esc(s.label)}</b> ${esc(s.words)}</figcaption>
    <div class="hs-why" aria-hidden="true">${why}</div><ol class="hs" aria-hidden="true">${cells}</ol><div class="hs-dark" aria-hidden="true">${band}</div>
    <div class="hs-x" aria-hidden="true"><span>6 AM</span><span>10 AM</span><span>2 PM</span><span>6 PM</span></div>
    <p class="vh">${esc(s.text)}</p></figure>`;
}
export const LABEL_MIN_H = 3;
export const hourLegend = () => '<p class="hs-leg" aria-hidden="true"><span><i class="o"></i>Good weather</span><span><i class="c"></i>Closed</span><span><i class="d"></i>Dark</span></p>';

/* ---------- top of the page ---------- */
// brief: { text, atText, drift } for the mode, already checked fresh by the app; null hides it.
export const tldr = (brief, mode) => briefSection(brief, mode);

// The landing's "Where to go". m: guide.landing(...).
export function guide(m) {
  const mode = m.mode, slot = m.slots.find((s) => s.id === m.when) || null;
  const head = '<div class="sec-h"><h2 id="h-guide">Where to go</h2></div>';
  if (!slot) return `<section class="panel guide" aria-labelledby="h-guide">${head}<p class="picks-empty">${status(m.pending)}</p></section>`;
  const off = offOf(m.when);
  // Round 9: the strip is a plain day picker. No Best marker, no tags.
  const chips = m.slots.map((s) => `<button type="button" class="wchip" data-when="${esc(s.id)}" aria-pressed="${s.id === m.when}" aria-label="${esc(s.ariaLabel)}"><span class="wl" aria-hidden="true">${esc(s.label)}</span><span class="ws">${esc(s.sub)}</span></button>`).join("");
  const early = m.early ? `<p class="early"><b>Early look.</b> The models disagree on ${esc(slot.label)}, so treat these picks as a rough guess and check back.</p>` : "";
  const picks = m.picks.map((p, i) => {
    const hi = fin(p.hi) ? `${p.hi}°` : NA;
    return `<li class="pick${p.isBest ? " is-best" : ""}"><span class="pick-n"><span class="pick-id"><span class="rank" aria-hidden="true">${i + 1}</span><button type="button" class="pick-btn" data-open="${esc(p.area.id)}" aria-label="${esc(p.ariaLabel)}"><span class="t3-name">${esc(p.area.name)}</span></button></span>${p.isBest ? '<span class="best" aria-hidden="true">Best</span>' : ""}${(p.tags || []).map((t) => `<span class="tagp" aria-hidden="true">${esc(t)}</span>`).join("")}</span>
      <span class="pick-wx" aria-hidden="true">${wxIcon(p.key)}<span class="pick-t"><b>${hi}</b><small>high</small></span></span>
      <span class="reason" aria-hidden="true">${esc(p.reason)} · ${esc(p.where)}${p.advice ? `. ${esc(p.advice)}` : ""}${p.flag ? `<span class="rflag">${esc(p.flag)}</span>` : ""}</span>
      ${wline(p.window)}
      <span class="pick-flags">${pill(p.aval)}${gust(p.gust)}</span></li>`;
  }).join("");
  const at = mode === "ski" ? "each area's middle backcountry point" : "each area's high point";
  const avNote = off > 0 ? " The avalanche rating is today's; centers rate one day at a time." : " The avalanche rating is the center's for today.";
  const tipRows = [["Best", "Best: the driest place, then the sunniest. Snowing beats raining. Rain at this elevation never ranks. Compares weather only and never says a slope or trail is safe."]];
  if (mode === "ski") tipRows.push(["Powder", "Powder: 6″ or more of new snow by 10 AM, no rain."], ["Bluebird", "Bluebird: mostly clear and dry after 2″ or more of new snow. Often a higher avalanche day."]);
  else tipRows.push(["Snow line", "Hike only: an estimate from the nearest SNOTEL station's depth and the forecast snow level. Always \"likely\" and \"est.\""]);
  const tip = info({ what: "Best and tags", rows: tipRows });
  const body = picks
    ? `<ol class="picks" aria-labelledby="h-picks">${picks}</ol>${m.picksNote ? `<p class="picks-foot">${esc(m.picksNote)}</p>` : ""}`
    : `<div class="picks"><p class="picks-empty">${esc(m.picksNote || status(m.pending))}</p></div>`;
  return `<section class="panel guide" aria-labelledby="h-guide">
    ${head}
    <div class="g-label"><h3 id="h-when">When</h3></div>
    <div class="wchips" role="group" aria-labelledby="h-when">${chips}</div>
    ${early}
    <div class="picks-h"><h3 id="h-picks">Top 3, ${esc(m.whenWord || slot.label)}</h3>${tip.btn}</div>${tip.panel}
    <p class="best-def">${esc(m.rankRule)}</p>
    ${body}
    <p class="picks-foot">Numbers at ${at}, est.${esc(avNote)} Picks compare weather; they never say a slope or trail is OK.</p>
  </section>`;
}

/* ---------- All places ---------- */
// g: the row's glance from guide.js (mock rowGlance).
function rowGlance(g, pending) {
  if (!g || g.t == null) return `<span class="pg"><span class="small muted">${pending ? LOADING : "No data"}</span></span>`;
  const amt = g.p === "snow" ? `<b>${esc(fmtIn(g.v))}″</b> snow` : g.p === "rain" ? `<span class="wetv">${fin(g.v) ? fmtWater(g.v) : NA}″</span> rain` : "dry";
  return `<span class="pg" aria-hidden="true"><span class="g1">${wxIcon(wxKeyCode(g.code, g.night), false, g.w)}<b>${esc(g.t)}°</b></span><span class="gw">${esc(capFirst(g.w))}</span><span class="g2">24 h ${amt}</span></span>`;
}
// The row's Best (Plan 3): the day on one line and the window on its own line under it, below the whole row so the window
// has the row's width and never wraps (the text column is 178 px at 390). Hidden: the row's name reads it as one sentence.
const bestBlock = (lines) => (lines?.length ? `<div class="prow-best" aria-hidden="true">${lines.map((t) => `<span class="wline">${esc(keepTimes(t))}</span>`).join("")}</div>` : "");
// One area row. r: a guide.landing() groups[].rows[] item.
export function row(r, pending = false) {
  const a = r.area, mi = r.mi == null ? "" : ` · ${esc(r.mi)} mi`;
  return `<li><div class="prow"><button type="button" class="prow-btn" data-open="${esc(a.id)}" aria-label="${esc(r.ariaLabel)}"><span class="srow-n">${esc(a.name)}</span><span class="srow-s">${esc(r.sub)}</span><span class="row-inside" aria-hidden="true">Forecast, clouds and cams${mi}</span>${r.tag ? `<span class="sl-tag" aria-hidden="true">${esc(r.tag)}</span>` : ""}${r.flag ? `<span class="rflag" aria-hidden="true">${esc(r.flag)}</span>` : ""}</button>${rowGlance(r.glance, pending)}${ROW_CHEV}${star({ id: a.id, name: a.name, star: r.star })}${bestBlock(r.bestLines)}</div></li>`;
}
// One resort row (Resorts view). r: a guide.landing() resortGroups[].rows[] item.
export function resortRow(r) {
  const na = r.n24Text === NA, mi = r.mi == null ? "" : ` · ${esc(r.mi)} mi`;
  const t5 = fin(r.t5) ? `${fmtIn(r.t5)}″` : NA;
  return `<li><div class="rrow"><button type="button" class="rrow-btn" data-open="${esc(r.area.id)}" aria-label="${esc(r.ariaLabel)}"><span class="srow-n">${esc(r.resort.name)}</span><span class="srow-s">${esc(r.area.name)}${mi}</span></button>
    <span class="rr-n24" aria-hidden="true"><span class="sk-l">24 h</span><span class="sk-n${r.n24Text === "0" ? " zero" : ""}">${esc(r.n24Text)}${na ? "" : "″"}</span></span>
    <span class="rr-t5" aria-hidden="true"><span class="sk-l">5 days</span><span class="rr-t${r.t5 > 0 ? "" : " zero"}">${esc(t5)}</span></span>
    ${r.bars ? `<span class="rr-bars" aria-hidden="true">${miniBars({ bars: r.bars, barsNA: r.barsNA, aria: r.barsAria })}<span class="sk-l">7 days</span></span>` : "<span></span>"}
    ${ROW_CHEV}<span class="rr-base" aria-hidden="true">${esc(r.bands)}</span></div></li>`;
}
// The "All places" section. m: guide.landing(...). o.geoMsg: the Sort by distance error line (app state, never stored).
// o.liveOutside: the page keeps its own live region for that line outside this section (a region re-created with its
// text is often not announced), so the visible line here is hidden from screen readers.
export function placesList(m, o = {}) {
  const mode = m.mode, view = mode === "ski" ? m.list : "areas";
  const tip = info({ what: "the place rows", rows: [
    ["Now", "The model's current hour at the area's ranking point (Ski: the middle backcountry point; Hike: the high point)."],
    ["24 h", "Snow or rain over the next 24 hours there, est. NBM where it covers, else the middle model."],
    ["Not looking good", "Flags the day you picked when the point has rain, heavy snow (about 1″ an hour), gusts of 30 mph or more, or avalanche danger High or Extreme. Facts only; never says a slope or trail is OK or not."],
    ["Source", `${OD}.`]] });
  const ttip = info({ what: "Resorts", rows: [["Resorts", "New snow at each resort's middle elevation from the models, est. Not the resort's own report. Base and top: the next 24 hours."]] });
  const sortBtn = `<button type="button" class="sortbtn" data-sortgeo="1"${m.sorted ? ' aria-pressed="true"' : ""}>${m.sorted ? "Sorted by distance · Clear" : "Sort by distance"}</button>`;
  const toggle = mode === "ski" ? `<div class="list-tog"><div class="seg2" role="group" aria-label="Show areas or resorts"><button type="button" data-list="areas" aria-pressed="${view === "areas"}">Areas</button><button type="button" data-list="resorts" aria-pressed="${view === "resorts"}">Resorts</button></div>${ttip.btn}</div>${ttip.panel}` : "";
  const grp = (name, items, cls = "") => `<div class="pgrp"><h3 class="pgrp-h" id="g-${slug(name)}">${esc(name)}</h3><ul${cls ? ` class="${cls}"` : ""} aria-labelledby="g-${slug(name)}">${items}</ul></div>`;
  const body = view === "resorts"
    ? (m.resortGroups || []).map((g) => grp(g.name, g.rows.map(resortRow).join(""), "res-ul")).join("")
    : m.groups.map((g) => grp(g.name, g.rows.map((r) => row(r, m.pending)).join(""))).join("");
  return `<section class="places" aria-labelledby="h-places">
    <div class="places-top"><div class="sec-h places-h"><h2 id="h-places">All places</h2>${sortBtn}${tip.btn}</div>${tip.panel}
    <p class="best-def">${view === "resorts" ? "Every resort, most new snow first. Middle elevation, est." : "Every area's forecast, not ranked."}</p>
    ${toggle}
    ${mode === "ski" && m.earlySeason ? '<p class="early">Early season: most snow stations show under 12″ of snow.</p>' : ""}
    <p class="list-note"${o.liveOutside ? ' aria-hidden="true"' : ' role="status"'}>${esc(o.geoMsg || "")}</p></div>
    ${body}
    ${mode === "ski" && view === "areas" ? '<p class="list-note">BC has no measured snow or avalanche data here.</p>' : ""}
  </section>`;
}

// The page footer: the mock's reading note, v2's data credits (Mock vs spec 9).
export function footer() {
  return `<h2>How to read this</h2>
    <p>Big numbers are NBM where it covers, else the middle of the weather models. "est." means computed, not measured. Picks and Best compare weather only. Check the avalanche center before going into avalanche terrain.</p>
    ${CREDITS}
    ${DISCLAIMER}`;
}

/* ---------- the place view ---------- */
// The avalanche block (Ski, mock round 4): the only place the danger colors appear.
export function avyBlock(v) {
  const av = v.aval, h = href(av?.url);
  if (!av) return '<div class="avy avy-none"><p><b>No avalanche center covers this area.</b></p></div>';
  // The map layers are still loading (architect ruling, Task 11 review): never "unavailable" before they answer.
  if (av.state === "loading") return `<div class="avy avy-none"><p><b>Loading avalanche rating</b> · ${esc(av.c)}</p></div>`;
  const link = h ? `<a href="${h}" target="_blank" rel="noopener">Read the ${esc(av.c === "AvCan" ? "Avalanche Canada" : av.c)} forecast</a>` : "";
  if (av.c === "AvCan") return `<div class="avy avy-none"><p><b>Avalanche Canada forecast</b> · linked, not shown here.</p>${link ? `<p>${link}</p>` : ""}</div>`;
  const rated = Number.isInteger(av.l) && av.l >= 1 && av.l <= 5;
  const bands = rated ? v.avyBands || null : null;
  const zone = av.zone ? ` · ${esc(av.zone)}` : "";
  const more = link ? `<p>${link}</p>` : "";
  // Rated, but no per-band detail (no zone product: COAA, IPAC; a stale or missing NWAC product): the overall rating, in the
  // words the landing flag and the pill use (architect ruling, Task 10 review I1).
  if (rated && !bands) return `<div class="avy avy-none"><p><b>${esc(av.c)} ${av.l} ${DANGER(av.l)}</b>${zone}</p>${more}</div>`;
  if (!bands) {
    if (av.state === "unavailable") return `<div class="avy avy-none"><p><b>Avalanche rating unavailable</b> · ${esc(av.c)}</p>${more}</div>`;
    const word = av.state === "off-season" ? "is off-season" : av.state === "expired" ? "rating has expired" : "No avalanche rating posted yet this season";
    return `<div class="avy avy-none"><p><b>${av.state === "off-season" || av.state === "expired" ? `${esc(av.c)} ${word}` : word}</b> · ${esc(av.c)} ${esc(av.zone || "")}</p>${more}</div>`;
  }
  const rows = bands.map(([b, l]) => `<li class="avy-b"><span class="avy-n d${esc(l)}" aria-hidden="true">${esc(l)}</span><span class="avy-w"><b>${esc(l)} ${DANGER(l)}</b><span>${esc(b)}</span></span></li>`).join("");
  return `<div class="avy"><p class="avy-h"><b>Avalanche danger today</b><span>${esc(av.c)} · ${esc(av.zone || "")}</span></p><ul class="avy-list" aria-label="Avalanche danger by elevation band">${rows}</ul>${link ? `<p>${link}</p>` : ""}</div>`;
}

// The dialog's header parts, each an HTML string for its slot in index.html. Every string field is HTML, already escaped,
// title and sub included: Task 11 writes them as markup, never as plain text (a name with "&" would show "&amp;").
// v: place.placeView(...). o: { id (area id), star (bool), tab }. Also returns tab (the shown tab, Overview when the mode
// lacks the asked one), avyHidden (bool) and labelledBy (the panel's aria-labelledby).
export function placeHeader(v, o = {}) {
  const tab = v.tabs.some(([k]) => k === o.tab) ? o.tab : "forecast";
  return {
    tab,
    mode: v.modes.map((x) => `<button type="button" data-pvmode="${esc(x.id)}" aria-pressed="${x.on}"${x.disabled ? ` disabled aria-label="${esc(x.ariaLabel)}"` : ""}>${esc(x.label)}</button>`).join(""),
    title: esc(v.title),
    pill: v.mode === "ski" || v.aval?.state === "loading" ? "" : pill(v.aval),
    avy: v.mode === "ski" ? avyBlock(v) : "",
    avyHidden: v.mode !== "ski",
    star: star({ id: o.id, name: v.title, star: !!o.star }),
    sub: esc(v.sub),
    tabs: v.tabs.map(([k, t]) => `<button type="button" role="tab" class="tab" id="tab-${esc(k)}" aria-selected="${k === tab}" aria-controls="pv-panel" tabindex="${k === tab ? 0 : -1}" data-tab="${esc(k)}">${esc(t)}</button>`).join(""),
    labelledBy: `tab-${tab}`,
  };
}

// The tap for one-line detail rows (mock round 4). open: whether the panel shows.
function detailBtn(id, text, open) {
  return `<button type="button" class="dline" data-detail="${esc(id)}" aria-expanded="${open}" aria-controls="dl-${esc(id)}"><span>${text}</span><span class="dline-t">${open ? "Hide" : "Details"}</span></button>`;
}
const detailPanel = (id, body, open) => `<div class="dpanel" id="dl-${esc(id)}"${open ? "" : " hidden"}>${body}</div>`;

// Hike: the snow line block above At a glance (mock snowLineBlock). L: placeView().snowLine.
export function snowLineBlock(L) {
  if (!L) return "";
  if (L.ft == null) return `<div class="snowline"><p><b>Snow line: no recent reading</b> from ${esc(L.station)} SNOTEL. Check trip reports before going up high.</p></div>`;
  const at = esc(L.at), hiFt = fmtNum(L.highFt), r100 = (x) => Math.round(x / 100) * 100;
  if (lineUnknown(L)) return `<div class="snowline"><p class="sl-h"><b>Snow up high not known</b> <span class="est">(est.)</span></p>
    <p>${esc(L.station)} SNOTEL (${fmtNum(L.stElev)} ft) is bare, but it sits ${fmtNum(L.highFt - L.stElev)} ft below ${at} (${hiFt} ft), so it can't say whether snow lies up there. Check recent trip reports before going high.</p>
    <p class="sub">Bare station plus forecast snow level about ${fmtNum(r100(L.snowLevel ?? 0))} ft would put the line near ${fmtNum(L.ft)} ft; older snow above the station isn't measured. An estimate, not a trail report.</p></div>`;
  const above = lineAbove(L);
  const lvl = L.snowLevel != null ? ` Forecast snow level ${L.snowLevel <= 0 ? "to the valley floor" : `about ${fmtNum(r100(L.snowLevel))} ft`} (${esc(L.from)}).` : "";
  return `<div class="snowline${above ? " is-above" : ""}"><p class="sl-h"><b>Snow on trail likely above about ${fmtNum(L.ft)} ft</b> <span class="est">(est.)</span></p>
    <p>${above ? `${at} (${hiFt} ft) is above it: snowshoes and winter skills.` : `${at} (${hiFt} ft) is likely below it. Patches can linger in shade and on north slopes.`}${L.drop != null ? ` The line may drop to about ${fmtNum(L.drop)} ft with the next storm.` : ""}</p>
    <p class="sub">From ${esc(L.station)} SNOTEL (${fmtNum(L.stElev)} ft${fin(L.mi) ? `, ${esc(L.mi)} mi` : ""}): ${esc(L.depth)}″ on the ground ${esc(L.asOf || "")}.${lvl} One station and a model: an estimate, not a trail report.</p></div>`;
}

// At a glance (round 11): one card per other tab, each opens its tab.
export function glanceCards(v) {
  if (!v.glance.length) return "";
  const card = (c) => {
    let inner = `<span class="pc-b">${esc(c.body)}</span>`;
    if (c.tab === "snow" && c.extra) {
      const bars = c.extra.bars ? `<span class="srow-sk">${miniBars(five({ bars: c.extra.bars, barsNA: c.extra.barsNA, aria: c.extra.aria }))}</span>` : "";
      inner = `<span class="pc-b"><span class="pc-big">${esc(c.extra.big)}</span>${esc(c.extra.sub)}</span>${bars}`;
    } else if (c.tab === "cams" && c.extra?.cam) {
      const h = href(c.extra.cam.url);
      const tile = h ? `<span class="pc-tile pc-cam"><img src="${h}" alt="${esc(c.extra.cam.alt)}" loading="lazy" referrerpolicy="no-referrer"></span>` : `<span class="pc-tile">${CAM_ICON}</span>`;
      inner = `${tile}<span class="pc-b">${esc(c.body)}</span>`;
    }
    return `<button type="button" class="pcard" data-goto="${esc(c.tab)}" aria-label="${esc(c.ariaLabel)}"><span class="pc-t">${esc(c.title)}</span>${inner}<span class="pc-f" aria-hidden="true">${esc(c.title)} ›</span></button>`;
  };
  return `<section class="pv-sec" aria-labelledby="h-glance"><h3 id="h-glance">At a glance</h3><div class="pcards" style="--pn:${Math.min(v.glance.length, 4)}">${v.glance.map(card).join("")}</div></section>`;
}

// Next 7 days (mock sevenDay): Best and Good marks, the night line, the definition, the Best line. st.day: the open day.
export function sevenDay(v, st = {}) {
  const w = v.week, mode = v.mode;
  if (!w.days.length) return `<section class="pv-sec" aria-labelledby="h-d7"><h3 id="h-d7">Next 7 days</h3><div class="pv-card"><p>${status(v.pending)}</p></div></section>`;
  const PART = { AM: "morning", PM: "afternoon", Night: "night" };
  const amt = (a) => (a && a.value != null ? a : null);
  const rows = w.days.map((d) => {
    const open = st.day === d.ymd, pid = esc(`d7-${d.ymd}`);
    const what = d.parts.map((p) => PART[p.part]).filter(Boolean);
    const say = what.length > 1 ? `${what.slice(0, -1).join(", ")} and ${what[what.length - 1]}` : what[0] || "";
    const aria = `${d.ariaLabel}${say ? ` ${open ? "Hide" : "Show"} ${say}.` : ""}`;
    const parts = d.parts.map((p) => {
      const a = amt(p.amount);
      return `<div><span class="pn">${esc(p.part)}</span>${wxIcon(p.key)}<span class="pt">${deg(p.t)}</span><span class="pp">${a ? `${esc(a.value)}${a.unit ? ` ${esc(a.unit)}` : ""}` : ""}</span></div>`;
    }).join("");
    const gst = fin(d.gust) ? `<span class="gust">Gusts ${esc(d.gust)} mph</span>` : "";
    // A day shows its high and low; Tonight (no high) shows the night's low alone.
    const a = amt(d.amount), temps = d.hi != null ? `<b>${deg(d.hi)}</b><span>${deg(d.lo)}</span>` : d.lo != null ? `<b>${deg(d.lo)}</b>` : "";
    return `<li><button type="button" class="d7-btn${d.isBest ? " is-best" : ""}" data-day="${esc(d.ymd)}" aria-expanded="${open}" aria-controls="${pid}" aria-label="${esc(aria)}">${wxIcon(d.key, false, d.keyLabel)}
        <span class="d7-d" aria-hidden="true"><span class="dn">${esc(d.label)}${CHEV}</span>${d.isBest ? '<span class="best">Best</span>' : d.isGood ? '<span class="good">Good</span>' : ""}<span class="lab">${esc(d.keyLabel || NA)}${d.tags.map((t) => `<span class="tagp">${esc(t)}</span>`).join("")}</span>${d.early ? '<span class="ear">Early look</span>' : ""}${gst}${d.night ? `<span class="d7-note">${esc(d.night)}</span>` : ""}</span>
        <span class="d7-t" aria-hidden="true">${temps}</span>
        <span class="d7-p" aria-hidden="true">${a ? `<b class="${esc(a.cls)}">${esc(a.value)}</b><small>${esc(a.unit)}</small>` : ""}</span></button>
      <div class="d7-x" id="${pid}"${open ? "" : " hidden"}>${parts || '<p class="sub">No periods left today.</p>'}</div></li>`;
  }).join("");
  const early = w.days.filter((d) => d.early).map((d) => d.label);
  const note = early.length ? `<p class="early"><b>Early look.</b> The models disagree on ${esc(early.join(", "))}, so treat ${early.length > 1 ? "those days" : "that day"} as a rough guess.</p>` : "";
  const tip = info({ what: "the 7-day forecast", rows: [
    ...(w.at ? [["Where", `At ${esc(w.at)}, this area's ${mode === "ski" ? "middle backcountry point" : "high point"}.`]] : []),
    ["Day", "8 AM to 5 PM, the hours Best reads. The icon, high, low and amounts use the same hours. Snow and rain are each model's water split by temperature (snow at 34 °F and below), est. The Night line is the evening and night after."],
    ["Good", "Another day that also qualifies for Best: dry, or snowing with no rain."],
    ["Best", "Best: the driest day, then the sunniest. Snowing beats raining. Rain at this elevation never gets Best. Compares weather only and never says a slope or trail is safe."],
    ...(mode === "ski" ? [["Powder", "Powder: 6″ or more of new snow by 10 AM, no rain."], ["Bluebird", "Bluebird: mostly clear and dry after 2″ or more of new snow. Often a higher avalanche day."]] : []),
    ["Models", "NBM where it covers, else the middle model. HRRR, HRDPS and NAM for 2 days, then ECMWF, GFS and ICON."],
    ["Source", `${OD}.`]] });
  const bl = w.bestLine ? `<p class="why d7-why" role="status"><b>${esc(w.bestLine.head)}</b>${w.bestLine.text ? ` ${esc(w.bestLine.text)}` : ""}</p>` : "";
  return `<section class="pv-sec" aria-labelledby="h-d7"><div class="sec-h"><h3 id="h-d7" style="font-family:var(--display);font-weight:600;font-size:20px">Next 7 days</h3>${tip.btn}</div>${tip.panel}
    <div class="pv-card"><p class="frow-l"><span>${w.at ? `at ${esc(w.at)} · ` : ""}tap a day for morning, afternoon, night</span></p><p class="best-def">${esc(w.def)}</p>${bl}<ul class="d7">${rows}</ul></div>${note}</section>`;
}

// The Weather window section, directly under Next 7 days (Question 2). None when no day has a window.
export function windowSec(v) {
  if (!v.windowStrips.length) return "";
  const t = info({ what: "the weather window", rows: [["Source", esc(String(v.windowTip).replace(/^Source: /, ""))]] });
  return `<section class="pv-sec" aria-labelledby="h-win"><div class="sec-h"><h3 id="h-win">Weather window</h3>${t.btn}</div>${t.panel}<div class="pv-card"><p class="best-def">${esc(v.windowDef)}</p><div class="hstrips">${v.windowStrips.map(hourStrip).join("")}</div>${hourLegend()}</div></section>`;
}

// The area's resorts (Ski Overview, mock resortsSec).
export function resortsSec(v) {
  if (v.mode !== "ski" || !v.resorts.length) return "";
  const band = (b, k) => (b ? `<span>${k} ${fmtNum(b.ft)} ft: <b>${b.snow == null ? NA : `${esc(fmtIn(b.snow))}″`}</b></span>` : "");
  const rows = v.resorts.map((r) => {
    const na = r.n24Text === NA;
    return `<div class="res-row"><div><p class="res-name">${esc(r.name)}</p><p class="res-el">${esc(r.sub)}</p></div><div class="res-n"><b class="${r.n24Text === "0" ? "zero" : ""}">${esc(r.n24Text)}${na ? "" : "″"}</b><span>next 24 h, mid</span></div>
      <div class="res-bands">${band(r.base, "Base")}${band(r.top, "Top")}${r.bars ? `<span class="srow-sk" style="margin-left:auto">${miniBars({ bars: r.bars, barsNA: r.barsNA, aria: r.aria })}<span class="sk-l">7 days</span></span>` : ""}</div></div>`;
  }).join("");
  return `<section class="pv-sec"><h3>Resorts</h3><div class="pv-card">${rows}<p class="sub">New snow, est., from the forecast at each resort's base, middle and top. Not the resort's own report.</p></div></section>`;
}

// Backcountry (Ski Overview, mock backcountrySec, windLine, snowLine24). st: { id, detail: Set }.
export function backcountrySec(v, st = {}) {
  const bc = v.backcountry;
  if (!bc) return '<section class="pv-sec"><h3>Backcountry</h3><div class="pv-card"><p class="sub">No backcountry zone is set up for this area.</p></div></section>';
  const on = (id) => !!st.detail?.has?.(id);
  let wind = "", snow = "";
  if (bc.wind) {
    const id = `wind-${st.id || "area"}`;
    const cells = bc.wind.cells.map((c) => `<div><span class="b">${esc(c.day)} ${esc(c.part)}</span><span class="r">${c.mph == null ? NA : `${esc(c.dir)} ${esc(c.mph)} <small>mph</small>`}</span></div>`).join("");
    wind = `<div class="dwrap">${detailBtn(id, `<b>Ridgetop wind</b> ${esc(bc.wind.text)}`, on(id))}${detailPanel(id, `<p class="sub">${esc(bc.wind.note)}</p><div class="wind">${cells}</div>`, on(id))}</div>`;
  }
  if (bc.snow24) {
    const id = `snow-${st.id || "area"}`;
    snow = `<div class="dwrap">${detailBtn(id, `<b>New snow next 24 h:</b> ${esc(bc.snow24.text)}`, on(id))}${detailPanel(id, `${snowBands({ bands: bc.snow24.bands })}<p class="sub">${esc(bc.snow24.heights)}</p>`, on(id))}</div>`;
  }
  const stand = bc.standInNote ? `<p class="sub">${esc(bc.standInNote)}</p>` : "";
  return `<section class="pv-sec"><h3>Backcountry</h3><div class="pv-card">${wind}${snow}${stand}</div></section>`;
}

// High and trailhead (Hike Overview).
function highSec(v) {
  const z = v.hikeZ;
  if (!z || !z.days) return `<section class="pv-sec"><h3>High and trailhead</h3><div class="pv-card"><p>${status(v.pending)}</p></div></section>`;
  const tm = z.tomorrow;
  const tmLine = tm ? `<div class="line"><span class="k">Tomorrow</span><span class="v"><b>${esc(tm.day)}</b> ${deg(tm.hi)} / ${deg(tm.lo)}F up high ${gust(tm.gust)}</span></div>` : "";
  return `<section class="pv-sec"><h3>High and trailhead</h3><div class="pv-card">${hikeRows(z)}<div class="lines">${tmLine}</div></div></section>`;
}

/* ---------- clouds in plain words, with a drawing (mock round 4) ---------- */
function cloudSvg(c) {
  const [A, B] = c.pts;
  const W = 260, H = 112;
  const lowFt = Math.floor((Math.min(B ? B.ft : A.ft, c.base ?? A.ft) - 1500) / 1000) * 1000;
  const topCap = A.ft + 4000;
  const hiFt = Math.ceil(Math.min(Math.max(A.ft + 1500, c.top ?? 0), topCap) / 1000) * 1000;
  const y = (ft) => Math.round(H - 6 - ((Math.min(Math.max(ft, lowFt), hiFt) - lowFt) / (hiFt - lowFt)) * (H - 22));
  const px = 170, tx = 70;
  const mtn = `M0 ${H} L0 ${y(lowFt + (hiFt - lowFt) * 0.08)} L${tx} ${B ? y(B.ft) : y(lowFt + 800)} L${px} ${y(A.ft)} L${W} ${y(lowFt + (hiFt - lowFt) * 0.25)} L${W} ${H} Z`;
  let band = "";
  if (c.base != null || c.top != null || c.lowDeck) {
    const yt = c.top == null ? 4 : y(c.top), yb = c.base == null ? H : y(c.base);
    band = `<rect x="0" y="${yt}" width="${W}" height="${Math.max(3, yb - yt)}" class="cl-band"/>`;
  }
  const hiCl = c.high ? `<rect x="0" y="0" width="${W}" height="6" class="cl-high"/>` : "";
  // labels stay inside the drawing: the trailhead's starts at the left edge, the summit's ends at the right edge when long
  const lab = (p, x, below) => {
    const t = `${p.name} ${fmtNum(p.ft)} ft`, w = t.length * 6.6;
    const [tx2, anc] = below ? [4, "start"] : x + w / 2 > W - 4 ? [W - 4, "end"] : [x, "middle"];
    return `<circle cx="${x}" cy="${y(p.ft)}" r="4" class="cl-pt"/><text x="${tx2}" y="${below ? Math.min(H - 4, y(p.ft) + 16) : Math.max(12, y(p.ft) - 8)}" text-anchor="${anc}" class="cl-tx">${esc(t)}</text>`;
  };
  return `<svg class="cl-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(cloudSentence(c))}"><path d="${mtn}" class="cl-mtn"/>${band}${hiCl}${lab(A, px, false)}${B ? lab(B, tx, true) : ""}</svg>`;
}
export function plainClouds(clouds, n = 4) {
  const cs = (clouds || []).slice(0, n);
  if (!cs.length) return '<p class="sub">No cloud data for this place right now.</p>';
  return `<div class="cl-grid">${cs.map((c) => `<figure class="cl-fig"><figcaption>${esc(cloudSentence(c))}</figcaption>${cloudSvg(c)}</figure>`).join("")}</div>
    <p class="sub">A model read (${esc([...new Set(cs.map((c) => c.model))].join(", "))}), est. Heights rounded to 500 ft; the models only see cloud between pressure levels, so edges are rough. Check the cams.</p>`;
}

/* ---------- cams (live images, the v2 page's cam markup) ---------- */
function camFig(c, at) {
  const h = href(c.url);
  if (!h) return "";
  const meta = [esc(c.where), c.night ? "dark now" : at ? `loaded ${esc(at)}` : ""].filter(Boolean).join("<br>");
  return `<figure class="cam"><a href="${h}" target="_blank" rel="noopener" aria-label="${esc(`Open ${c.area} ${c.where} full size`)}"><img src="${h}" alt="${esc(c.alt)}" loading="lazy" referrerpolicy="no-referrer"></a><figcaption><span class="area">${esc(c.area)}</span><br><span class="meta">${meta}</span></figcaption></figure>`;
}

/* ---------- tab bodies ---------- */
// v: place.placeView(...). tab: a tab id. st: { id (area id), elev, day, detail: Set, cloudDetail, camsAt }.
export function tabBody(v, tab, st = {}) {
  const t = v.tabs.some(([k]) => k === tab) ? tab : "forecast";
  if (t === "forecast") {
    const part = { glance: () => glanceCards(v), week: () => sevenDay(v, st), window: () => windowSec(v), resorts: () => resortsSec(v),
      backcountry: () => backcountrySec(v, st), snowLine: () => snowLineBlock(v.snowLine), high: () => highSec(v) };
    return v.overview.map((k) => part[k]?.() ?? "").join("");
  }
  if (t === "elevation") return `<section class="pv-sec"><div class="pv-card">${elevSection({ id: st.id || "", elev: v.spots.length ? v.spots : null }, st.elev)}</div></section>`;
  if (t === "clouds") {
    const z = v.mode === "ski" && v.skiZ ? v.skiZ : v.hikeZ;
    const line = !z ? "" : z === v.skiZ ? condLine(z)
      : z.tomorrow ? `<div class="cond"><p>${verdict(`${z.tomorrow.day} AM`, z.tomorrow.am)}${verdict(`${z.tomorrow.day} PM`, z.tomorrow.pm)}</p></div>` : "";
    const open = !!st.cloudDetail;
    const detail = z?.cloudChart ? `<button type="button" class="more" data-clouddetail="1" aria-expanded="${open}" aria-controls="cl-detail">${open ? "Hide model detail" : "Model detail"}${CHEV.replace(' class="chev"', "")}</button>
      <div class="pv-card" id="cl-detail"${open ? "" : " hidden"}>${line}${cloudChart(z)}</div>` : "";
    return `<section class="pv-sec"><h3>Clouds, next 2 days</h3><div class="pv-card">${plainClouds(v.clouds)}</div>${detail}</section>`;
  }
  if (t === "snow") {
    const z = v.skiZ;
    if (!z) return '<p class="sub">No snow forecast for this place.</p>';
    return `<section class="pv-sec"><div class="pv-card"><p class="frow-l"><span><b>New snow</b> · at ${esc(z.atRole)} ${esc(z.at)}</span></p>${trio(z)}${strip(z, true)}</div>
      <div class="pv-card"><p class="frow-l"><span><b>By band</b> · next 24 h</span></p>${snowBands(z)}${z.ratio ? `<p class="sub">Water ratio ${esc(z.ratio)}</p>` : ""}${z.snotelNote ? `<p class="sub">${esc(z.snotelNote)}</p>` : ""}</div></section>`;
  }
  // cams
  const figs = v.cams.map((c) => camFig(c, st.camsAt)).filter(Boolean);   // a cam whose URL is not https shows nothing
  if (!figs.length) return '<section class="pv-sec"><div class="pv-card"><p>No camera covers this area yet.</p></div></section>';
  return `<section class="pv-sec"><div class="now-cams">${figs.join("")}</div></section>`;
}
