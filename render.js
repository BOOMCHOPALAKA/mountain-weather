// page/render.js
// The approved mock's render functions, fed by vm.js objects. Pure: data in, HTML string out.
// Every string that comes from the network or places.json is escaped here. A missing value prints "n/a" (vm.js NA), never a
// number and never a dash (Plan 3).
import { fmtNum, UNAVAILABLE, NA } from "./vm.js";
import { DANGER_NAMES } from "./engine/avalanche.js";

/* ===================== atoms ===================== */
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const fin = (x) => typeof x === "number" && Number.isFinite(x);
let uid = 0;
const nid = (p) => `${p}-${++uid}`;
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const href = (u) => (typeof u === "string" && /^https:\/\//.test(u) ? esc(u) : null);
const slug = (s) => String(s).replace(/[^A-Za-z0-9_-]/g, "_");
const num = (x) => (fin(x) ? String(Math.round(x)) : NA);
const deg = (x) => (fin(x) ? `${Math.round(x)}°` : NA);
const fresh = (z) => esc(z?.fresh || "not yet");
const DANGER = (l) => DANGER_NAMES[l] || "";

export const OD = 'Weather data by <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo.com</a>';
const CC = '<a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>';
export { UNAVAILABLE };

export function info(tip) {
  const tid = nid("tip");
  const rows = tip.rows || [["Source", tip.src], ["Method", tip.how], ["Fresh", tip.fresh]];
  return {
    btn: `<button type="button" class="info" aria-expanded="false" aria-controls="${tid}" aria-label="About ${esc(tip.what)}"><span aria-hidden="true">i</span></button>`,
    panel: `<div class="tip" id="${tid}" hidden><dl>${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join("")}</dl></div>`,
  };
}

// a: { c, l, url, state } from vm.avalFor, or null.
export function pill(a) {
  if (!a) return "";
  const h = href(a.url);
  const tt = a.name && a.name !== a.c ? ` title="${esc(a.name)}"` : "";   // the full center name on hover
  const wrap = (inner, label) => (h
    ? `<a class="pill-link" href="${h}" target="_blank" rel="noopener"${tt} aria-label="${esc(a.name && a.name !== a.c ? `${a.name}, ${label}` : label)}">${inner}</a>`
    : `<span class="pill-link"${tt}>${inner}</span>`);
  if (a.c === "AvCan") {
    return wrap('<span class="pill"><span class="c">Avalanche Canada</span> forecast</span>', "Avalanche Canada forecast, opens avalanche.ca");
  }
  if (Number.isInteger(a.l) && a.l >= 1 && a.l <= 5) {
    // v3 mock round 4: no danger color in the pill; the place view's avalanche block is the only place the colors appear
    return wrap(`<span class="pill"><span class="c">${esc(a.c)}</span> ${a.l} ${DANGER(a.l)}</span>`,
      `${a.c} avalanche forecast: ${a.l} ${DANGER(a.l)}`);
  }
  // l -1: the state says why there is no rating. A feed that failed is never called off-season.
  const word = a.state === "off-season" ? "off-season" : a.state === "unavailable" ? "rating unavailable" : a.state === "expired" ? "rating expired" : "no rating today";
  return wrap(`<span class="pill"><span class="c">${esc(a.c)}</span> ${word}</span>`, `${a.c} avalanche forecast: ${word}`);
}

export const gust = (g) => (fin(g) && g >= 35
  ? `<span class="gust"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5 15 14H1z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M8 6v4M8 11.6v.8" stroke="currentColor" stroke-width="1.6"/></svg>Gusts ${Math.round(g)} mph</span>`
  : "");

export const star = (z) => `<button type="button" class="star" data-star="${esc(z.id)}" aria-pressed="${z.star ? "true" : "false"}" aria-label="Star ${esc(z.name)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4-4.7-4.4 6.4-.8z"/></svg></button>`;

// Real verdict texts ("cloud above you (models differ on height)") are longer than the mock's; .verdict.wrap lets them wrap.
// v: [word, text] from vm.wordFor. Words: above, below, in, between, under, clear, split, none.
export function verdict(label, v) {
  const [w, t] = Array.isArray(v) ? v : ["none", "no cloud data"];
  return w === "split"
    ? `<span class="verdict wrap"><b>${esc(label)}</b><span class="split">${esc(t)}</span></span>`
    : `<span class="verdict wrap"><b>${esc(label)}</b><i class="vd ${slug(w)}" aria-hidden="true"></i>${esc(t)}</span>`;
}
const GLYPH = {
  dry: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="3.2" fill="currentColor"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.4 1.4M11.6 11.6 13 13M3 13l1.4-1.4M11.6 4.4 13 3" stroke="currentColor" stroke-width="1.4"/></svg>',
  wet: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5C6 5 4 7.3 4 10a4 4 0 0 0 8 0c0-2.7-2-5-4-8.5z" fill="currentColor"/></svg>',
  snow: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1v14M2 4.5l12 7M2 11.5l12-7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  cloudy: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 12.5h7.2a3 3 0 0 0 .3-6 4 4 0 0 0-7.6.9 2.6 2.6 0 0 0 .1 5.1z" fill="currentColor"/></svg>',
};
const CONDWORD = { dry: "Dry", wet: "Wet", snow: "Snow", cloudy: "Cloudy" };
const chip = (c) => (GLYPH[c] ? `<span class="chip ${c}">${GLYPH[c]}${CONDWORD[c]}</span>` : `<span class="chip">${NA}</span>`);

/* ===================== molecules ===================== */
export function trio(z, mini = false) {
  const cells = (z.trio || []).map(([w, n, r]) => {
    const none = n == null || n === NA;
    const dim = none || n === 0 || n === "<1";
    return `<div class="${dim ? "dim" : ""}"><span class="w">Next ${esc(w)}</span><span class="big">${none ? NA : esc(n)}${none ? "" : '<span class="u">″</span>'}</span><span class="rng">${r && r !== NA ? `${esc(r)}″` : NA}</span></div>`;
  }).join("");
  return `<div class="trio${mini ? " mini" : ""}">${cells}</div>`;
}

const LEGEND_FULL = '<span><i class="lg m"></i>Measured</span> <span><i class="lg f"></i>Forecast</span> <span><i class="lg r"></i>Range</span> <span><i class="lg e"></i>ECMWF</span> <span><i class="lg t"></i>Under 3 models</span> <span><i class="lg x"></i>Not posted</span>';

// Day 0 is today's column; after 17:00 local it is labeled "Tonight" (z.cloudsDay is the vm's 17:00 flag).
export const day0Label = (z) => (z.cloudsDay === "tomorrow" ? "Tonight" : "Today");
function pastLabels(z) {
  const i = DOW.indexOf(z.glance?.days?.[0]);
  return [3, 2, 1].map((k) => (i < 0 ? "" : DOW[(i - k + 7) % 7]));
}
const fwdLabels = (z) => Array.from({ length: 7 }, (_, i) => (i === 0 ? day0Label(z) : z.glance?.days?.[i] || ""));

export function strip(z, full = false) {
  const max = 18, H = 84; // inches on the stake, px of plot
  const y = (v) => Math.round((Math.min(Math.max(v, 0), max) / max) * H);
  const gl = [6, 12, 18].map((v) => `<span class="gl" style="bottom:${y(v)}px"></span>`).join("");
  const scale = `<div class="scale" aria-hidden="true">${[0, 6, 12, 18].map((v) => `<span style="bottom:${y(v)}px">${v}${v ? "″" : ""}</span>`).join("")}${Array.from({ length: 10 }, (_, i) => i * 2).map((v) => `<i class="${v % 6 === 0 ? "maj" : ""}" style="bottom:${y(v)}px"></i>`).join("")}</div>`;
  const noStation = !Array.isArray(z.measured) || !!z.snotelError || !!z.snotelPending;   // no hatching: hatched means "not posted"
  const meas = noStation ? [null, null, null] : z.measured;
  const mcols = meas.map((v) => (!fin(v)
    ? `<div class="col">${gl}${noStation ? "" : '<span class="bar miss"></span>'}<span class="val mutedv" style="bottom:4px">${NA}</span></div>`
    : `<div class="col">${gl}${v > 0 ? `<span class="bar m" style="height:${y(v)}px"></span>` : ""}<span class="val" style="bottom:${y(v) + 3}px">${v}</span></div>`)).join("");
  // After 23:00 no hours of today remain: day 0 is dropped, not shown as missing, and the last column stays empty.
  const gone = !!z.day0Gone;
  const fcAll = z.fc || Array(7).fill([null, null, null, null, 1]);
  const fc = gone ? fcAll.slice(1) : fcAll;
  const fcols = fc.map(([m, lo, hi, ec, thin]) => {
    if (!fin(m)) return `<div class="col">${gl}<span class="val mutedv" style="bottom:4px">${NA}</span></div>`;
    const h = fin(hi) ? hi : m;
    const rng = h > m ? `<span class="bar rng" style="bottom:${y(m)}px;height:${y(h) - y(m)}px"></span>` : "";
    const bar = m > 0 ? `<span class="bar f${full && thin ? " thin" : ""}" style="height:${y(m)}px"></span>` : "";
    const e = full && fin(ec) && h > 0 ? `<span class="ec" style="bottom:${y(ec)}px" title="ECMWF ${ec}″"></span>` : "";
    const top = full && fin(ec) ? Math.max(h, ec) : h;
    return `<div class="col">${gl}${rng}${bar}${e}<span class="val${m === 0 ? " mutedv" : ""}" style="bottom:${y(top) + 4}px">${m}</span></div>`;
  }).join("") + (gone ? `<div class="col" aria-hidden="true">${gl}</div>` : "");
  const past = pastLabels(z), fwd = gone ? fwdLabels(z).slice(1) : fwdLabels(z);
  const days = ['<span></span>', ...past.map((d) => `<span class="day">${esc(d)}</span>`),
    gone ? `<span></span><span class="day">${esc(fwd[0])}</span>`
      : `<span class="day now" style="grid-column:span 2;text-align:right;white-space:nowrap">${fwd[0]}</span>`,
    ...fwd.slice(1).map((d) => `<span class="day">${esc(d)}</span>`), gone ? "<span></span>" : ""].join("");
  const at = esc(z.at || NA);
  const stTxt = z.snotelPending ? "Loading the SNOTEL station." : z.snotelError ? `${esc(z.station || "The SNOTEL station")} didn't load this time. Tap Refresh.` : noStation ? "No SNOTEL station for this place." : `${esc(z.station)}, ${esc(z.stElev)} (NRCS SNOTEL)${z.through ? `, through ${esc(z.through)}` : ", nothing posted in the last 3 days"}. SNOTEL posts a day late; a grey hatched day has not posted.`;
  const t = info({ what: "snow totals and bars", rows: [
    ["Totals", `New snow at ${at}, estimated. Each model's water × a temperature snow ratio. Big number = NBM where it covers, else the middle model; small = lowest to highest.`],
    ["Measured", stTxt],
    ["Forecast", `Big-number model at ${at}, hatched up to the highest model. ${gone ? "No hours of today remain, so the bars start tomorrow." : `${fwd[0]} counts only the hours left today.`}${full ? " Black tick = ECMWF (from day 3; days 1-2 use the short-range models). Dashed bars have fewer than 3 models." : " The ECMWF tick and the dashed bars show under More, Snow."}`],
    ["Legend", `<span class="legend">${LEGEND_FULL}</span>`],
    ["Source", `${OD}: NBM, HRRR, HRDPS and NAM for the first two days; NBM, ECMWF, GFS and ICON after. NRCS SNOTEL.`],
    ["Fresh", `Forecast pulled ${fresh(z)}.`],
  ] });
  const aria = `Snow by day at ${z.at && z.at !== NA ? z.at : "unknown elevation"}. Measured ${past.map((d, i) => `${d} ${fin(meas[i]) ? `${meas[i]} inches` : "no report"}`).join(", ")}. Forecast ${fwd.map((d, i) => `${d} ${fin(fc[i]?.[0]) ? `${fc[i][0]} inches` : "no data"}`).join(", ")}.`;
  return `<div class="strip">
    <div class="plot">
      <span></span><span class="grp-l" style="grid-column:span 4">Measured</span><span class="grp-l" style="grid-column:span 6">Forecast, est.</span><span class="grp-i">${t.btn}</span>
      <div class="plot-in" role="img" aria-label="${esc(aria)}" style="display:contents">${scale}${mcols}<div class="todayline" aria-hidden="true"></div>${fcols}
      ${days}</div>
    </div>${t.panel}
    ${full ? `<div class="cap"><span>${z.snotelPending ? "Measured snow loading" : z.snotelError ? "Measured snow didn't load" : noStation ? "No measured snow here" : `Measured at ${esc(z.station)}, ${esc(z.stElev)}${z.through ? `, through ${esc(z.through)}` : ""}`} · new snow at ${at}, est.</span></div><div class="legend" aria-hidden="true">${LEGEND_FULL}</div>` : ""}
  </div>`;
}

/* one merged line: snow level (when snowing) · cloud verdict AM · PM */
export function condLine(z) {
  const tm = z.cloudsDay === "tomorrow";
  const sm = (z.snowLevelModels || []).map(esc).join(", ");
  const t = info({ what: "snow level and clouds", rows: [
    ["Snow level", `HRRR and ICON freezing level minus 1,000 ft, in the hours with precipitation, next 24 h. One number when they agree within 500 ft, otherwise a range. Estimated.${sm ? ` Models with precipitation: ${sm}.` : ""}`],
    ["Clouds", `HRRR and HRDPS cloud cover by pressure level (850 to 600 hPa) plus low cloud, compared against ${esc(fmtNum(z.summit))} ft. GFS when those have no data. ${tm ? "After 5 PM these are tomorrow's." : "Today's, 8 to 11 AM and noon to 5 PM."} A model read, not observed. Check the cams.`],
    ["Source", `${OD}.`],
    ["Fresh", `Pulled ${fresh(z)}.`],
  ] });
  const sl = z.snowLevel ? `<span class="ci"><span class="kk">Snow level</span><b>${esc(z.snowLevel)}</b> <span class="est">(est.)</span></span>` : "";
  const c = z.clouds || [null, null];
  return `<div class="cond"><p>${sl}${verdict(tm ? "Tomorrow AM" : "AM", c[0])}${verdict(tm ? "Tomorrow PM" : "PM", c[1])}${t.btn}</p>${t.panel}</div>`;
}

// Approximate standard-atmosphere heights of the low layer and 850-600 hPa, for drawing only.
const LEVELS = [2000, 4700, 6300, 8000, 9700, 11600, 13500, 15000];
const cls = (p) => (!fin(p) ? "cn" : p >= 80 ? "c3" : p >= 50 ? "c2" : p >= 20 ? "c1" : "c0");
export function cband(levels, summit) {
  const span = LEVELS[LEVELS.length - 1] - LEVELS[0];
  const lv = Array.isArray(levels) ? levels : Array(7).fill(null);
  const segs = lv.map((pct, i) => `<i class="${cls(pct)}" style="height:${((LEVELS[i + 1] - LEVELS[i]) / span) * 100}%"></i>`).join("");
  const sm = fin(summit) ? `<span class="sm" style="bottom:${((Math.min(Math.max(summit, LEVELS[0]), 14800) - LEVELS[0]) / span) * 100}%"></span>` : "";
  return `<span class="cband" aria-hidden="true">${segs}${sm}</span>`;
}

/* hike: two labeled forecast rows, High and Trailhead. Cloud word = vm days[i][6], never recomputed here. */
export function hikeRows(z) {
  const days = z.days || [];
  const src = (z.cloudSrc || []).map((s, i) => `${esc(days[i]?.[0] || "")}: ${esc(s || "no cloud data")}`).join(" · ");
  const t = info({ what: "forecast rows", rows: [
    ["Rows", "High = a high point in this area. Trailhead = a common trailhead. They stand for the area's high and low band and can sit on different trails."],
    ["Read it", `Chip = the day's main condition. High and low in °F${z.day0Note ? `; the first day is ${esc(z.day0Note)}` : ""}. The bar is cloud cover from about 2,000 ft (bottom) to 15,000 ft (top) at approximate level heights; darker means more cloud, hatched means no data; the black mark is the high point. The word under it says where that point sits: above the cloud, in it, under it, between layers, low cloud below, or clear.`],
    ["Clouds by day", src || "no cloud data"],
    ["Source", `${OD}: temps, precipitation, cloud by level.`],
    ["Fresh", `Pulled ${fresh(z)}.`],
  ] });
  const cell = ([d, c, hi, lo, sn, lv, word], i) => {
    const ok = !!GLYPH[c];
    const snow = ok && fin(sn) && sn >= 1;
    return `<div class="dcell"><span class="dl${i === 0 ? " now" : ""}">${esc(d)}</span>${chip(c)}<span class="hl"><b>${deg(hi)}</b> ${deg(lo)}</span>${cband(lv, z.summit)}<span class="cword">${esc(word || NA)}</span><span class="snowamt${snow ? "" : " none"}">${snow ? `${sn}″` : "0"}</span></div>`;
  };
  // Spoken text says "no data" where the screen prints n/a (a screen reader reads "n/a" as "n slash a").
  const said = (x) => (fin(x) ? String(Math.round(x)) : "no data");
  const ariaDay = ([d, c, hi, lo, sn, , word]) => `${d} ${CONDWORD[c] || "no data"}, high ${said(hi)}, low ${said(lo)}${GLYPH[c] && fin(sn) && sn >= 1 ? `, ${sn} inches snow` : ""}, clouds ${word || "no data"}`;
  const hiLabel = `<b>High</b> · ${esc(fmtNum(z.high?.[1]))} ft · ${esc(z.high?.[0])}`;
  const top = `<p class="frow-l"><span>${hiLabel}</span>${t.btn}</p>${t.panel}
    <div class="days" role="img" aria-label="${esc(`Next 5 days at ${fin(z.summit) ? `${fmtNum(z.summit)} ft` : "a height with no data"}: ${days.map(ariaDay).join("; ")}`)}">${days.map(cell).join("")}</div>`;
  if (!z.th || !z.thDays) return `<div class="strip hk">${top}</div>`;
  const thCells = z.thDays.map(([c, hi, lo]) => `<div class="dcell">${chip(c)}<span class="hl"><b>${deg(hi)}</b> ${deg(lo)}</span></div>`).join("");
  const thAria = `Trailhead, ${fin(z.th[1]) ? `${fmtNum(z.th[1])} ft` : "a height with no data"}: ${z.thDays.map(([c, hi, lo], i) => `${days[i]?.[0] || ""} ${CONDWORD[c] || "no data"}, high ${said(hi)}, low ${said(lo)}`).join("; ")}`;
  return `<div class="strip hk">${top}
    <p class="frow-l th"><span><b>Trailhead</b> · ${esc(fmtNum(z.th[1]))} ft · ${esc(z.th[0])}</span></p>
    <div class="days th" role="img" aria-label="${esc(thAria)}">${thCells}</div></div>`;
}

/* clouds chart: z.cloudChart from the vm, rows top to bottom 600..850 hPa then low */
function summitPct(summit, rowsFt) {
  const h = (rowsFt || []).slice(0, 6);
  if (!fin(summit) || h.length < 6 || !h.every(fin)) return null;
  if (summit >= h[0]) return 0;
  for (let i = 0; i < 5; i++) {
    if (summit <= h[i] && summit >= h[i + 1]) return ((i + 0.5 + (h[i] - summit) / (h[i] - h[i + 1])) / 7) * 100;
  }
  return (6 / 7) * 100;   // below the 850 hPa height: the top edge of the Low row
}
export function cloudChart(z) {
  const ch = z.cloudChart;
  const cols = ch.cols || 16;
  const sy = summitPct(ch.summit, ch.rowsFt);
  const grid = (m) => {
    const cells = m.grid.map((row) => row.map((p) => `<i class="${cls(p)}"></i>`).join("")).join("");
    const end = fin(m.endCol) ? `<span class="end" style="left:${(m.endCol / cols) * 100}%"></span>` : "";
    return `<div class="cgrid">${cells}${sy != null ? `<span class="summit" style="top:${sy}%"></span>` : ""}${end}</div>`;
  };
  const xl = `<div class="xlab">${(ch.xlab || []).map((x) => {
    const p = (x.col / cols) * 100;
    return p > 80 ? `<span style="right:0">${esc(x.label)}</span>` : `<span style="left:${p}%">${esc(x.label)}</span>`;
  }).join("")}</div>`;
  const ms = ch.models.slice(0, 2);
  const heads = ms.map((m) => `<span class="mh">${esc(m.label)}${fin(m.endCol) ? ` <span>to ~${m.endCol * 3} h</span>` : ""}</span>`);
  while (heads.length < 2) heads.push("<span></span>");
  const grids = ms.map(grid);
  while (grids.length < 2) grids.push("<span></span>");
  const xls = ms.map(() => xl);
  while (xls.length < 2) xls.push("<span></span>");
  const yl = (ch.rowsFt || []).map((f, i) => (i === 6 ? "Low" : fin(f) ? fmtNum(f) : ["600", "650", "700", "750", "800", "850"][i] + " hPa"));
  return `<div class="cchart" role="img" aria-label="${esc(`Cloud cover by height, every 3 hours for 48 hours, from ${ms.map((m) => m.label).join(" and ")}. ${fin(ch.summit) ? `Summit ${fmtNum(ch.summit)} ft.` : ""}`)}">
      <span></span>${heads.join("")}
      <div class="ylab">${yl.map((l) => `<span>${esc(l)}</span>`).join("")}</div>${grids.join("")}
      <span></span>${xls.join("")}
    </div>
    <div class="cleg"><span><i class="c0"></i>Clear</span><span><i class="c1"></i>Some</span><span><i class="c2"></i>Mostly</span><span><i class="c3"></i>Cloud</span><span><i class="sl"></i>Summit ${esc(fmtNum(ch.summit))} ft</span><span><i class="cn"></i>No data</span></div>
    <p class="sub">Heights in feet are the models' pressure levels (850 to 600 hPa), the middle of the 48 hours. "Low" is the model's low-cloud layer. The levels only show "at or below" and "between," never an exact base or top.</p>`;
}

// The bands only (v3 mock): the v3 Snow tab and the Backcountry detail set their own notes around it.
export function snowBands(z) {
  const max = 20, w = (v) => (Math.min(Math.max(v, 0), max) / max) * 100;
  const rows = (z.bands || []).map(([n, e, m, lo, hi]) => `<div class="bandrow"><span class="k"><b>${esc(n)}</b>${esc(e)}</span><span class="htrack"><span class="hf" style="width:${w(m)}%"></span>${hi > m ? `<span class="hr" style="left:${w(m)}%;width:${w(hi) - w(m)}%"></span>` : ""}</span><span class="v">${m}″ <small>${lo === hi ? lo : `${lo} to ${hi}`}</small></span></div>`).join("");
  return rows ? `<div class="bands">${rows}</div>` : '<p class="sub">No per-band snow forecast right now.</p>';
}
/* forecast by elevation: one table per spot, one showing at a time */
const cellSnow = (v) => (v == null ? NA : v < 0.5 ? "0" : v < 1 ? "&lt;1" : String(Math.round(v)));
const cellRain = (v) => (v == null ? NA : v < 0.005 ? "0" : v.toFixed(2));
const cellNum = (v) => (v == null ? NA : String(Math.round(v)));
function elevTable(s) {
  const P = s.periods;
  const days = [];
  for (const p of P) { if (days.length && days[days.length - 1][0] === p.day) days[days.length - 1][1]++; else days.push([p.day, 1]); }
  const row = (k, fn) => `<tr><th scope="row">${k}</th>${P.map((p) => `<td>${fn(p)}</td>`).join("")}</tr>`;
  const anySurface = P.some((p) => p.wind?.from === "surface");
  return `<div class="elev-wrap" tabindex="0" role="region" aria-label="Forecast at ${esc(s.name || s.ft)}"><table class="elev-t">
    <thead><tr><th scope="col"></th>${days.map(([d, n]) => `<th scope="col" colspan="${n}">${esc(d)}</th>`).join("")}</tr>
    <tr><th scope="col"></th>${P.map((p) => `<th scope="col">${esc(p.part)}</th>`).join("")}</tr></thead>
    <tbody>${row("Sky", (p) => chip(p.cond))}${row("Snow, in", (p) => cellSnow(p.snow))}${row("Rain, in", (p) => cellRain(p.rain))}${row("High, °F", (p) => cellNum(p.hi))}${row("Low, °F", (p) => cellNum(p.lo))}${row("Wind, mph", (p) => (p.wind ? `${p.wind.dir} ${Math.round(p.wind.mph)}` : NA))}${anySurface ? row("Gust, mph", (p) => cellNum(p.gust)) : ""}${row("Freezing level, ft", (p) => (p.freezeFt == null ? NA : p.freezeFt.toLocaleString("en-US")))}</tbody>
  </table></div>`;
}
export function elevSection(z, picked) {
  const spots = z.elev;
  if (!spots) return '<p class="sub">No forecast by elevation right now.</p>';
  const cur = spots.some((s) => s.role === picked) ? picked : spots[0].role;
  const t = info({ what: "forecast by elevation", src: "Open-Meteo: NBM, HRRR, HRDPS, NAM, ECMWF, GFS, ICON.",
    how: "Each row is the forecast at that spot's own coordinate. Temperature is set to the spot's elevation. Snow is each model's water times a temperature snow ratio. Wind above the 850 hPa height (about 5,000 ft) comes from pressure levels (HRRR, GFS, ICON).",
    fresh: "Updates with the card, up to 30 minutes old." });
  return `<div class="elev-sec"><p class="frow-l"><span>Pick a spot</span>${t.btn}</p>${t.panel}
    <div class="elev-chips" role="group" aria-label="Spot">${spots.map((s) => `<button type="button" class="elev-chip" data-place="${esc(z.id)}" data-elev="${esc(s.role)}" aria-pressed="${s.role === cur}">${s.name ? `${esc(s.name)} <small>${esc(s.ft)}</small>` : esc(s.ft)}</button>`).join("")}</div>
    ${spots.map((s) => `<div class="elev-spot" data-spot="${esc(s.role)}"${s.role === cur ? "" : " hidden"}>${elevTable(s)}</div>`).join("")}
    <p class="sub">Spots close together can share a model cell, so rain and clouds can match. Temperature, snow and wind change with height. Wind up high is free air, so expect less in sheltered terrain.</p></div>`;
}

/* 7 bars, one per day from today. 4 px wide, 28 px max (12 in = full). 0 = a 2 px stub; no data = no bar. */
export function miniBars(z) {
  const g = z.glance || {}, H = 28, max = 12;
  const bars = (g.bars || []).map((n, i) => (g.barsNA?.[i] ? '<i style="height:0"></i>' : `<i style="height:${n > 0 ? Math.max(4, Math.round((Math.min(n, max) / max) * H)) : 2}px"></i>`)).join("");
  return `<span class="mbars" role="img" aria-label="${esc(g.aria || "Snow forecast unavailable")}">${bars}</span>`;
}
// Each pick reads on its own line when it starts a sentence.
const PICK_START = /(?<=[.!?])\s+(?=Snow coming:|Best ski day:|Best hike day:)/;
// The drift line (guide.js briefDrift): the page's live Best no longer matches the TLDR's, so the card says so first.
export function driftText(drift, mode, atText) {
  const now = drift.name ? `Best ${mode} day is now ${drift.name} on ${drift.day}.` : `The page no longer names a Best ${mode} day.`;
  return `Forecast changed since ${atText}. ${now}`;
}
// brief: { text, atText, drift } for one mode, already checked fresh by the app; null hides it.
export function briefSection(brief, mode) {
  if (!brief || typeof brief.text !== "string" || !brief.text.trim()) return "";
  const paras = brief.text.trim().split(PICK_START).map((t) => `<p class="brief-t">${esc(t)}</p>`).join("");
  const drift = brief.drift ? `<p class="brief-d" role="status">${esc(driftText(brief.drift, mode, brief.atText))}</p>` : "";
  return `<section class="brief" aria-labelledby="h-brief"><div class="sec-h"><h2 id="h-brief">TLDR</h2><span class="small muted">AI summary · ${esc(brief.atText)}</span></div><div class="brief-card">${drift}${paras}<p class="brief-n">Written by AI from the forecast, cams and avalanche centers. Compares weather only; check the avalanche forecast before choosing terrain.</p></div></section>`;
}

// The data credits (spec "Data and attribution"), read by the page footer (page/ui.js).
export const CREDITS = `<p class="lead">Built entirely on free, public data.</p>
    <ul>
      <li>${OD} (${CC}): forecasts, cloud levels, freezing level</li>
      <li><a href="https://www.nrcs.usda.gov/resources/data-and-reports/snow-and-water-interactive-map" target="_blank" rel="noopener">NRCS SNOTEL</a> (USDA): measured snow depth and temperature</li>
      <li><a href="https://avalanche.org/" target="_blank" rel="noopener">avalanche.org</a>: <a href="https://nwac.us/avalanche-forecast/" target="_blank" rel="noopener">NWAC</a>, <a href="https://www.coavalanche.org/" target="_blank" rel="noopener">Central Oregon Avalanche Center</a> and <a href="https://www.idahopanhandleavalanche.org/" target="_blank" rel="noopener">Idaho Panhandle Avalanche Center</a> ratings</li>
      <li><a href="https://avalanche.ca/forecasts" target="_blank" rel="noopener">Avalanche Canada</a>: linked, not shown</li>
      <li>Cams: <a href="https://www.nps.gov/mora/learn/photosmultimedia/webcams.htm" target="_blank" rel="noopener">NPS Mount Rainier</a>, <a href="https://wsdot.com/travel/real-time/cameras" target="_blank" rel="noopener">WSDOT</a>, <a href="https://www.hcc.net/" target="_blank" rel="noopener">Hood Canal Communications</a></li>
    </ul>`;
export const DISCLAIMER = '<p class="disc">Not an official forecast. Check the avalanche center before going into avalanche terrain.</p>';
