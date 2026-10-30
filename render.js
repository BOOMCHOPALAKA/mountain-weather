// page/render.js
// The approved mock's render functions, fed by vm.js objects. Pure: data in, HTML string out.
// Every string that comes from the network or places.json is escaped here. A missing value prints "–", never a number.
import { fmtNum, UNAVAILABLE } from "./vm.js";
import { DANGER_NAMES } from "./engine/avalanche.js";

/* ===================== atoms ===================== */
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const fin = (x) => typeof x === "number" && Number.isFinite(x);
let uid = 0;
const nid = (p) => `${p}-${++uid}`;
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const href = (u) => (typeof u === "string" && /^https:\/\//.test(u) ? esc(u) : null);
const slug = (s) => String(s).replace(/[^A-Za-z0-9_-]/g, "_");
const num = (x) => (fin(x) ? String(Math.round(x)) : "–");
const deg = (x) => (fin(x) ? `${Math.round(x)}°` : "–");
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
    return wrap(`<span class="pill"><i class="sw d${a.l}"></i><span class="c">${esc(a.c)}</span> ${a.l} ${DANGER(a.l)}</span>`,
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
const CHEV = '<svg class="chev" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 6l5 5 5-5" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>';

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
const chip = (c) => (GLYPH[c] ? `<span class="chip ${c}">${GLYPH[c]}${CONDWORD[c]}</span>` : '<span class="chip">–</span>');
const statusLine = (z) => `<p class="empty">${z?.status === "loading" ? "Loading" : UNAVAILABLE}</p>`;

/* ===================== molecules ===================== */
export function trio(z, mini = false) {
  const cells = (z.trio || []).map(([w, n, r]) => {
    const none = n == null || n === "–";
    const dim = none || n === 0 || n === "<1";
    return `<div class="${dim ? "dim" : ""}"><span class="w">Next ${esc(w)}</span><span class="big">${none ? "–" : esc(n)}${none ? "" : '<span class="u">″</span>'}</span><span class="rng">${r && r !== "–" ? `${esc(r)}″` : "–"}</span></div>`;
  }).join("");
  return `<div class="trio${mini ? " mini" : ""}">${cells}</div>`;
}

const LEGEND_FULL = '<span><i class="lg m"></i>Measured</span> <span><i class="lg f"></i>Forecast</span> <span><i class="lg r"></i>Range</span> <span><i class="lg e"></i>ECMWF</span> <span><i class="lg t"></i>Under 3 models</span> <span><i class="lg x"></i>Not posted</span>';
export const LEGEND_TOP = '<span><i class="lg m"></i>Measured</span><span><i class="lg f"></i>Forecast</span><span><i class="lg r"></i>Range</span><span><i class="lg x"></i>Not posted</span>';

// Day 0 is today's column; after 17:00 local it is labeled "Tonight" (z.cloudsDay is the vm's 17:00 flag).
export const day0Label = (z) => (z.cloudsDay === "tomorrow" ? "Tonight" : "Today");
function pastLabels(z) {
  const i = DOW.indexOf(z.glance?.days?.[0]);
  return [3, 2, 1].map((k) => (i < 0 ? "–" : DOW[(i - k + 7) % 7]));
}
const fwdLabels = (z) => Array.from({ length: 7 }, (_, i) => (i === 0 ? day0Label(z) : z.glance?.days?.[i] || "–"));

export function strip(z, full = false) {
  const max = 18, H = 84; // inches on the stake, px of plot
  const y = (v) => Math.round((Math.min(Math.max(v, 0), max) / max) * H);
  const gl = [6, 12, 18].map((v) => `<span class="gl" style="bottom:${y(v)}px"></span>`).join("");
  const scale = `<div class="scale" aria-hidden="true">${[0, 6, 12, 18].map((v) => `<span style="bottom:${y(v)}px">${v}${v ? "″" : ""}</span>`).join("")}${Array.from({ length: 10 }, (_, i) => i * 2).map((v) => `<i class="${v % 6 === 0 ? "maj" : ""}" style="bottom:${y(v)}px"></i>`).join("")}</div>`;
  const noStation = !Array.isArray(z.measured) || !!z.snotelError || !!z.snotelPending;   // no hatching: hatched means "not posted"
  const meas = noStation ? [null, null, null] : z.measured;
  const mcols = meas.map((v) => (!fin(v)
    ? `<div class="col">${gl}${noStation ? "" : '<span class="bar miss"></span>'}<span class="val mutedv" style="bottom:4px">–</span></div>`
    : `<div class="col">${gl}${v > 0 ? `<span class="bar m" style="height:${y(v)}px"></span>` : ""}<span class="val" style="bottom:${y(v) + 3}px">${v}</span></div>`)).join("");
  // After 23:00 no hours of today remain: day 0 is dropped, not shown as "–", and the last column stays empty.
  const gone = !!z.day0Gone;
  const fcAll = z.fc || Array(7).fill([null, null, null, null, 1]);
  const fc = gone ? fcAll.slice(1) : fcAll;
  const fcols = fc.map(([m, lo, hi, ec, thin]) => {
    if (!fin(m)) return `<div class="col">${gl}<span class="val mutedv" style="bottom:4px">–</span></div>`;
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
  const at = esc(z.at || "–");
  const stTxt = z.snotelPending ? "Loading the SNOTEL station." : z.snotelError ? `${esc(z.station || "The SNOTEL station")} didn't load this time. Tap Refresh.` : noStation ? "No SNOTEL station for this place." : `${esc(z.station)}, ${esc(z.stElev)} (NRCS SNOTEL)${z.through ? `, through ${esc(z.through)}` : ", nothing posted in the last 3 days"}. SNOTEL posts a day late; a grey hatched day has not posted.`;
  const t = info({ what: "snow totals and bars", rows: [
    ["Totals", `New snow at ${at}, estimated. Each model's water × a temperature snow ratio. Big number = NBM where it covers, else the middle model; small = lowest to highest.`],
    ["Measured", stTxt],
    ["Forecast", `Big-number model at ${at}, hatched up to the highest model. ${gone ? "No hours of today remain, so the bars start tomorrow." : `${fwd[0]} counts only the hours left today.`}${full ? " Black tick = ECMWF (from day 3; days 1-2 use the short-range models). Dashed bars have fewer than 3 models." : " The ECMWF tick and the dashed bars show under More, Snow."}`],
    ["Legend", `<span class="legend">${LEGEND_FULL}</span>`],
    ["Source", `${OD}: NBM, HRRR, HRDPS and NAM for the first two days; NBM, ECMWF, GFS and ICON after. NRCS SNOTEL.`],
    ["Fresh", `Forecast pulled ${fresh(z)}.`],
  ] });
  const aria = `Snow by day at ${z.at || "unknown elevation"}. Measured ${past.map((d, i) => `${d} ${fin(meas[i]) ? `${meas[i]} inches` : "no report"}`).join(", ")}. Forecast ${fwd.map((d, i) => `${d} ${fin(fc[i]?.[0]) ? `${fc[i][0]} inches` : "no data"}`).join(", ")}.`;
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

export function snowLevelLine(z) {
  const sm = (z.snowLevelModels || []).map(esc).join(", ");
  const t = info({ what: "snow level", src: `${OD}: HRRR and ICON freezing level.`, how: `Freezing level minus 1,000 ft, during the hours with precipitation in the next 24 h. One number when the models agree within 500 ft, otherwise a range.${sm ? ` Models with precipitation: ${sm}.` : ""}`, fresh: `Pulled ${fresh(z)}.` });
  return `<div class="line"><span class="k">Snow level${t.btn}</span><span class="v">${esc(z.snowLevel)} <span class="est">(est.)</span></span></div>${t.panel}`;
}

export function avalBands(z) {
  const a = z.aval || {};
  const t = info({ what: "avalanche danger", src: `${esc(a.c)} via avalanche.org.`, how: "The center's own rating for each elevation band. Not changed by this page.", fresh: "Shown only while the center's forecast is current." });
  const h = href(a.url);
  return `<div class="aval2"><p class="aval2-h"><span class="kk">Avalanche today</span><span>${h ? `<a href="${h}" target="_blank" rel="noopener">${esc(a.c)} forecast</a>` : `${esc(a.c)} forecast`}${t.btn}</span></p>${t.panel}
    <div class="aval2-row">${z.avalBands.map(([b, l]) => `<div class="ab d-${l}"><span class="b">${esc(b)}</span><span class="r">${l} ${DANGER(l)}</span></div>`).join("")}</div></div>`;
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
    return `<div class="dcell"><span class="dl${i === 0 ? " now" : ""}">${esc(d)}</span>${chip(c)}<span class="hl"><b>${deg(hi)}</b> ${deg(lo)}</span>${cband(lv, z.summit)}<span class="cword">${esc(word || "–")}</span><span class="snowamt${snow ? "" : " none"}">${snow ? `${sn}″` : "0"}</span></div>`;
  };
  const ariaDay = ([d, c, hi, lo, sn, , word]) => `${d} ${CONDWORD[c] || "no data"}, high ${num(hi)}, low ${num(lo)}${GLYPH[c] && fin(sn) && sn >= 1 ? `, ${sn} inches snow` : ""}, clouds ${word || "no data"}`;
  const hiLabel = `<b>High</b> · ${esc(fmtNum(z.high?.[1]))} ft · ${esc(z.high?.[0])}`;
  const top = `<p class="frow-l"><span>${hiLabel}</span>${t.btn}</p>${t.panel}
    <div class="days" role="img" aria-label="${esc(`Next 5 days at ${fmtNum(z.summit)} ft: ${days.map(ariaDay).join("; ")}`)}">${days.map(cell).join("")}</div>`;
  if (!z.th || !z.thDays) return `<div class="strip hk">${top}</div>`;
  const thCells = z.thDays.map(([c, hi, lo]) => `<div class="dcell">${chip(c)}<span class="hl"><b>${deg(hi)}</b> ${deg(lo)}</span></div>`).join("");
  const thAria = `Trailhead, ${fmtNum(z.th[1])} ft: ${z.thDays.map(([c, hi, lo], i) => `${days[i]?.[0] || ""} ${CONDWORD[c] || "no data"}, high ${num(hi)}, low ${num(lo)}`).join("; ")}`;
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
  return `<div class="cchart" role="img" aria-label="${esc(`Cloud cover by height, every 3 hours for 48 hours, from ${ms.map((m) => m.label).join(" and ")}. Summit ${fmtNum(ch.summit)} ft.`)}">
      <span></span>${heads.join("")}
      <div class="ylab">${yl.map((l) => `<span>${esc(l)}</span>`).join("")}</div>${grids.join("")}
      <span></span>${xls.join("")}
    </div>
    <div class="cleg"><span><i class="c0"></i>Clear</span><span><i class="c1"></i>Some</span><span><i class="c2"></i>Mostly</span><span><i class="c3"></i>Cloud</span><span><i class="sl"></i>Summit ${esc(fmtNum(ch.summit))} ft</span><span><i class="cn"></i>No data</span></div>
    <p class="sub">Heights in feet are the models' pressure levels (850 to 600 hPa), the middle of the 48 hours. "Low" is the model's low-cloud layer. The levels only show "at or below" and "between," never an exact base or top.</p>`;
}

export function snowBands(z) {
  const max = 20, w = (v) => (Math.min(Math.max(v, 0), max) / max) * 100;
  const rows = (z.bands || []).map(([n, e, m, lo, hi]) => `<div class="bandrow"><span class="k"><b>${esc(n)}</b>${esc(e)}</span><span class="htrack"><span class="hf" style="width:${w(m)}%"></span>${hi > m ? `<span class="hr" style="left:${w(m)}%;width:${w(hi) - w(m)}%"></span>` : ""}</span><span class="v">${m}″ <small>${lo === hi ? lo : `${lo}–${hi}`}</small></span></div>`).join("");
  return `${rows ? `<div class="bands">${rows}</div>` : '<p class="sub">No per-band snow forecast right now.</p>'}
    <p class="sub">Next 24 h, NBM where it covers, else the middle model, with the range.${z.ratio ? ` Water ratio ${esc(z.ratio)}` : ""}</p>
    ${z.snotelNote ? `<p class="sub">${esc(z.snotelNote)}</p>` : ""}`;
}

const CAM_SRC = [[/nps\.gov/, "NPS"], [/wsdot\.wa\.gov/, "WSDOT"], [/hcc\.net/, "Hood Canal Communications"]];
const camSource = (u) => (CAM_SRC.find(([re]) => re.test(u || "")) || [null, "the camera owner"])[1];
function camFigure(c, z) {
  const h = href(c.url);
  if (!h) return "";
  return `<figure class="cam"><a href="${h}" target="_blank" rel="noopener"><img src="${h}" alt="${esc(c.alt)}" loading="lazy" referrerpolicy="no-referrer"></a><figcaption class="meta">${esc(c.where)} · ${c.night ? "dark now" : `loaded ${fresh(z)}`}</figcaption></figure>`;
}

function avalBody(z) {
  const a = z.aval;
  const h = href(a?.url);
  const who = a?.c === "AvCan" ? "Avalanche Canada" : a?.c;
  const full = a?.name && a.name !== a.c ? ` (${esc(a.name)})` : "";
  const link = h ? `<p class="sub"><a href="${h}" target="_blank" rel="noopener">Read ${esc(who)}'s forecast</a>${full} before going into avalanche terrain.</p>` : "";
  if (z.avalBands) return `<p>${esc(a.c)}: ${z.avalBands.map(([b, l]) => `${esc(b)}: ${l} ${DANGER(l)}`).join(" · ")}</p>${link}`;
  if (!a) return '<p>No avalanche center forecasts this area.</p>';
  if (a.c === "AvCan") return `<p>Avalanche Canada forecasts are linked, not shown here.</p>${link}`;
  if (Number.isInteger(a.l) && a.l >= 1) return `<p>${esc(a.c)}: highest rating today, ${a.l} ${DANGER(a.l)}.</p>${link}`;
  if (a.state === "expired") return `<p>${esc(a.c)} rating expired, check the center.</p>${link}`;
  if (a.state === "off-season") return `<p>${esc(a.c)} is off-season. Forecasts start when the season starts.</p>${link}`;
  if (a.state === "unavailable") return `<p>The ${esc(a.c)} rating didn't load.</p>${link}`;
  return `<p>${esc(a.c)} has no rating for this zone today.</p>${link}`;
}

// st: { more: bool, secs: { Name: bool } } from the app's session state.
export function moreBlock(z, mode, st = {}) {
  const pid = `more-${slug(z.id)}`;
  const open = !!st.more;
  const secs = st.secs || {};
  const isOpen = (name, dflt) => (name in secs ? !!secs[name] : dflt);
  const sec = (name, body, dflt, note = "") => `<details data-sec="${name}" data-place="${esc(z.id)}"${isOpen(name, dflt) ? " open" : ""}><summary>${name}${note ? `<span class="sum-note">${note}</span>` : ""}</summary><div class="sec">${body}</div></details>`;
  const cams = z.cams || [];
  const nowBody = cams.length ? `<div class="now-cams">${cams.map((c) => camFigure(c, z)).join("")}</div>` : '<p class="sub">No camera covers this area.</p>';
  const rows = z.fcRows || [];
  const fcBody = `<p class="sub">Stands for ${esc(z.standsFor || z.sub || z.name)}</p>${rows.length ? `<div class="fc-rows">${rows.map((r) => `<div class="fc-row"><span class="k">${esc(r.k)}</span><span>${esc(r.text)}${r.split ? ' <span class="tag">SPLIT</span>' : ""}${r.models ? `<br><span class="models">${esc(r.models)} (water, in)</span>` : ""}</span></div>`).join("")}</div>` : `<p>${UNAVAILABLE}</p>`}`;
  const hasSnow = mode !== "hike";
  const camSrcs = [...new Set(cams.map((c) => camSource(c.url)))];
  const srcBody = `<ul class="src-list">
      <li>Forecast, clouds, snow level: ${OD} (${CC})</li>
      ${hasSnow ? `<li>Measured snow: NRCS SNOTEL${z.station ? `, ${esc(z.station)}` : ", no station for this place"}</li>` : ""}
      <li>Avalanche: ${z.aval?.c === "AvCan" ? '<a href="https://avalanche.ca/" target="_blank" rel="noopener">Avalanche Canada</a>, linked only' : z.aval ? `<a href="https://avalanche.org/" target="_blank" rel="noopener">avalanche.org</a>, ${esc(z.aval.c)}` : "no center for this area"}</li>
      ${camSrcs.length ? `<li>Cams: ${camSrcs.map(esc).join(", ")}</li>` : ""}
    </ul>`;
  const body = [
    sec("Now", nowBody, false, cams.length ? `${cams.length} cam${cams.length === 1 ? "" : "s"}` : ""),
    sec("Forecast", fcBody, mode === "hike", "24 h, 48 h"),
    sec("Clouds", z.cloudChart ? cloudChart(z) : '<p class="sub">No cloud data for this place right now.</p>', true, "48 h by height"),
    hasSnow ? sec("Snow", strip(z, true) + snowBands(z), true, "by elevation") : "",
    sec("Avalanche", avalBody(z), false),
    sec("Sources", srcBody, false),
  ].join("");
  return `<button type="button" class="more" data-more="${esc(z.id)}" aria-expanded="${open}" aria-controls="${pid}">${open ? "Less" : "More"}<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 6l5 5 5-5" fill="none" stroke="currentColor" stroke-width="1.8"/></svg></button>
    <div class="more-panel" id="${pid}"${open ? "" : " hidden"}>${body}</div>`;
}

/* ===================== organisms ===================== */
const bcNote = (z) => (z.aval?.c === "AvCan" ? '<p class="small muted">No measured snow or avalanche data for BC.</p>' : "");
export function skiFace(z, mode, st) {
  if (z.status === "loading" && z.noData) return statusLine(z);
  if (z.noData) return `${statusLine({ status: "error" })}${bcNote(z)}${moreBlock(z, mode, st)}`;
  if (z.empty) return `<p class="empty">No snow forecast next 7 days</p>${bcNote(z)}${condLine(z)}${moreBlock(z, mode, st)}`;
  return `${trio(z)}${strip(z)}${bcNote(z)}${condLine(z)}${mode === "backcountry" && z.avalBands ? avalBands(z) : ""}${moreBlock(z, mode, st)}`;
}
export function skiCard(z, mode, st) {
  const head = `<div class="card-head"><div class="ttl"><h3>${esc(z.name)}</h3></div><div class="acts">${mode === "backcountry" && z.avalBands ? "" : pill(z.aval)}${star(z)}</div>${z.sub ? `<p class="places">${esc(z.sub)}</p>` : ""}<p class="elev">${esc(z.elev)}</p></div>`;
  return `<article class="card" data-name="${esc(String(z.name).toLowerCase())}" id="pin-${slug(z.id)}" tabindex="-1">${head}${skiFace(z, mode, st)}</article>`;
}
export function hikeFace(z, st) {
  if (!z.days) return `${statusLine(z)}${z.status === "loading" ? "" : moreBlock(z, "hike", st)}`;
  const tm = z.tomorrow;
  const tmLine = tm ? `<div class="line"><span class="k">Tomorrow</span><span class="v"><b>${esc(tm.day)}</b> ${deg(tm.hi)} / ${deg(tm.lo)}F up high ${gust(tm.gust)}<br>${verdict("AM", tm.am)} ${verdict("PM", tm.pm)} <span class="est">model</span></span></div>` : "";
  return `${hikeRows(z)}<div class="lines">${tmLine}${z.snowLevel ? snowLevelLine(z) : ""}</div>${moreBlock(z, "hike", st)}`;
}
export function hikeCard(z, st, h = "h3") {
  return `<article class="card" data-name="${esc(String(z.name).toLowerCase())}" id="pin-${slug(z.id)}" tabindex="-1"><div class="card-head"><div class="ttl"><${h}>${esc(z.name)}</${h}></div><div class="acts">${star(z)}</div><p class="places">${esc(z.sub)}</p></div>
    ${hikeFace(z, st)}</article>`;
}
// The body of an expanded row (the card without its title, which the row already shows).
export function skiRowBody(z, mode, st) {
  return `<div class="crow-acts">${mode === "backcountry" && z.avalBands ? "<span></span>" : pill(z.aval) || "<span></span>"}${star(z)}</div>${mode === "backcountry" ? `<p class="elev">${esc(z.elev)}</p>${z.sub ? `<p class="elev">${esc(z.sub)}</p>` : ""}` : ""}${skiFace(z, mode, st)}`;
}
export function areaRowBody(z, st) {
  return `<div class="crow-acts"><span></span>${star(z)}</div>${hikeFace(z, st)}`;
}

/* 7 bars, one per day from today. 4 px wide, 28 px max (12 in = full). 0 = a 2 px stub; no data = no bar. */
export function miniBars(z) {
  const g = z.glance || {}, H = 28, max = 12;
  const bars = (g.bars || []).map((n, i) => (g.barsNA?.[i] ? '<i style="height:0"></i>' : `<i style="height:${n > 0 ? Math.max(4, Math.round((Math.min(n, max) / max) * H)) : 2}px"></i>`)).join("");
  return `<span class="mbars" role="img" aria-label="${esc(g.aria || "Snow forecast unavailable")}">${bars}</span>`;
}
const rowState = (z) => (z.status === "loading" ? "Loading" : "No data");
function skiGlance(z, gid) {
  const g = z.glance || {};
  if (g.unavailable) return `<span class="srow-g" id="${gid}"><span class="small muted">${rowState(z)}</span></span>`;
  const zero = g.n24Text === "0";
  const vh = g.n24Text === "<1" ? "under 1" : esc(g.n24Text);
  return `<span class="srow-g srow-sk" id="${gid}"><span class="vh">Next 24 hours: ${vh} inches of snow, est.</span>${miniBars(z)}<span class="sk-24" aria-hidden="true"><b class="sk-n${zero ? " zero" : ""}">${esc(g.n24Text)}″</b><span class="sk-l">24 h</span></span></span>`;
}
function rowShell(z, t, g, gid, o) {
  const name = esc(String(z.name).toLowerCase());
  if (o.starred) {
    return `<li class="srow-li" data-place="${esc(z.id)}" data-name="${name}"><div class="srow is-star"><span class="srow-t">${t}</span>${g}<button type="button" class="srow-jump" data-jump="pin-${slug(z.id)}" aria-label="${esc(z.name)} is starred. Go to its card in Starred."><span aria-hidden="true">↑ Starred</span></button></div></li>`;
  }
  const pid = `body-${slug(z.id)}`;
  return `<li class="srow-li" data-place="${esc(z.id)}" data-name="${name}"><div class="srow"><button type="button" class="srow-btn" data-row="${esc(z.id)}" aria-expanded="${!!o.open}" aria-controls="${pid}" aria-describedby="${gid}">${t}</button>${g}${CHEV}</div><div class="srow-body" id="${pid}"${o.open ? "" : " hidden"}></div></li>`;
}
// o: { starred, open }
export function skiRow(z, mode, o = {}) {
  const gid = `g-${slug(z.id)}`;
  const name = mode === "backcountry" ? String(z.name).replace(/^Olympics: /, "") : z.name;
  const t = `<span class="srow-n">${esc(name)}</span><span class="srow-s">${esc(String(z.elev || "").replace(/ · Mid [\d,]+/, ""))}</span>`;
  return rowShell(z, t, skiGlance(z, gid), gid, o);
}
export function areaGlance(z, gid) {
  const n = z.glance || {};
  if (n.unavailable) return `<span class="srow-g" id="${gid}"><span class="small muted">${rowState(z)}</span></span>`;
  const amt = n.c === "snow" ? ` · <b>${num(n.sn)}″</b>` : n.c === "wet" && n.rain ? ` · ${esc(n.rain)}″` : "";
  return `<span class="srow-g" id="${gid}"><span class="vh">Next 24 h at ${esc(fmtNum(z.rank?.elev_ft))} ft:</span>${chip(n.c)}<span class="g-hl">${deg(n.hi)}/${deg(n.lo)}${amt}</span></span>`;
}
export function areaRow(z, o = {}) {
  const gid = `g-${slug(z.id)}`;
  const t = `<span class="srow-n">${esc(z.name)}</span><span class="srow-s">${esc(z.sub)}</span>`;
  return rowShell(z, t, areaGlance(z, gid), gid, o);
}

export function regionGlance(r) {
  const now = r.now, nx = r.next;
  const st = now?.source === "station";
  const where = st
    ? `Now: temperature measured at ${esc(now.station)} SNOTEL${fin(now.elev_ft) ? `, ${esc(fmtNum(now.elev_ft))} ft` : ""}, ${esc(now.ageMin)} min before the page loaded; the sky word is the model's. Next 24 h spans every ${esc(r.noun)} in this region.`
    : `Now is the model's current hour at ${esc(r.spot)}. Next 24 h spans every ${esc(r.noun)} in this region.`;
  const tip = info({ what: "where Now and Next 24 h come from", rows: [["Where", where], ["Source", `${OD}${st ? "; NRCS SNOTEL" : ""}.`], ["Fresh", `Fetched ${fresh(r)}`]] });
  const pending = r.status === "loading" ? "Loading" : UNAVAILABLE;
  const nowV = now
    ? `${now.w ? `<span class="gi ${esc(now.c)}">${GLYPH[now.c] || ""}</span>` : ""}<span class="g-t">${deg(now.t)}</span><span class="g-w">${esc(now.w)}</span><span class="g-m">${st ? `SNOTEL, ${esc(now.ageMin)} min ago` : "model"}</span>`
    : `<span class="g-w muted">${pending}</span>`;
  const nextV = nx
    ? `<span class="g-r">${num(nx.lo)}–${num(nx.hi)}°</span><span class="g-p">${nx.p}</span>`
    : `<span class="g-p muted">${pending}</span>`;
  return `<div class="glance"><div class="g-now"><span class="g-kr g-kr-at"><span class="g-k">Now</span><span class="g-atw"><span class="g-at">at ${esc(r.spot)}</span>${tip.btn}</span></span><span class="g-v">${nowV}</span></div><div class="g-next"><span class="g-k">Next 24 h</span><span class="g-v">${nextV}</span></div></div>${tip.panel}`;
}
function rangePill(p) {
  if (!p) return "";
  const h = href(p.url);
  const inner = `<span class="pill"><i class="sw d${p.lo}"></i><i class="sw d${p.hi}"></i><span class="c">${esc(p.c)}</span> ${p.lo}–${p.hi}</span>`;
  const label = `${p.c} avalanche forecast: zones in this region range from ${p.lo} ${DANGER(p.lo)} to ${p.hi} ${DANGER(p.hi)}`;
  return `<div class="rgn-av"><span class="g-k">Avalanche</span>${h ? `<a class="pill-link" href="${h}" target="_blank" rel="noopener" aria-label="${esc(label)}">${inner}</a>` : inner}</div>`;
}
// The region header (button, glance, line, pill). o: { open, mode }
export function regionRow(r, o = {}) {
  const bid = `rgn-${slug(o.mode || r.noun)}-${slug(r.id)}`;
  return `<div class="rgn-row"><h3 class="rgn-h"><button type="button" class="rgn-btn" data-rgn="${esc(r.id)}" aria-expanded="${!!o.open}" aria-controls="${bid}"><span class="rgn-top"><span class="rgn-n">${esc(r.name)}</span><span class="rgn-c">${esc(r.count)}</span></span>${CHEV}</button></h3>${regionGlance(r)}${r.line ? `<p class="rgn-g">${esc(r.line)}</p>` : ""}${o.mode === "backcountry" ? rangePill(r.pill) : ""}</div>`;
}
function regionShell(r, rowsHtml, o, label) {
  const bid = `rgn-${slug(o.mode || r.noun)}-${slug(r.id)}`;
  return `<section class="rgn" data-region="${esc(r.id)}">${regionRow(r, o)}<div class="rgn-body" id="${bid}"${o.open ? "" : " hidden"}><ul class="srows" aria-label="${esc(label)}">${rowsHtml}</ul></div></section>`;
}
// rows: the rendered row <li>s. o: { open, mode }
export const skiRegion = (r, rowsHtml, o = {}) => regionShell(r, rowsHtml, o, `${r.noun === "resort" ? "Resorts" : "Zones"} in ${r.name}`);
export const hikeRegion = (r, rowsHtml, o = {}) => regionShell(r, rowsHtml, { ...o, mode: "hike" }, `Areas in ${r.name}`);

// t: vm.top3Z output. progress: { done, total } of the view's glance points.
export function top3Panel(t, mode, progress = null) {
  const hid = `h-t3-${slug(mode)}`;
  const loading = progress && progress.done < progress.total;
  const rows = (t?.rows || []).map((r, i) => `<li><span class="rank">${i + 1}</span><span><span class="t3-name">${esc(r.name)}</span><br><span class="small muted">${esc(r.at)}</span></span><span class="t3-num">${esc(r.num)}<small>${esc(r.small)}</small></span><span class="t3-flags">${r.aval ? pill(r.aval) : r.verdict ? verdict("Clouds", r.verdict) : ""}${gust(r.gust)}</span></li>`).join("");
  // t.partial: some places didn't load, so the ranking covers only the rest. Said above the list, never dropped.
  const partial = t?.partial ? `<p class="t3-foot t3-partial">${esc(t.partial)} Tap Refresh.</p>` : "";
  const body = loading
    ? `<p class="t3-foot">Loading ${progress.done} of ${progress.total}</p>`
    : rows ? `${partial}<ol>${rows}</ol><p class="t3-foot">${esc(t.foot)}</p>` : `<p class="t3-foot">${esc(t?.empty || "No forecast yet.")}</p>${partial}`;
  const title = t?.title || (mode === "hike" ? "Driest tomorrow" : "Most snow, next 24 h");
  return `<section class="top3-sec" aria-labelledby="${hid}"><div class="sec-h"><h2 id="${hid}">${esc(title)}</h2></div><div class="top3">${body}</div></section>`;
}

// cams: vm.camsForPage output (sun up only). None: no section.
export function camsStrip(cams, at) {
  if (!cams || !cams.length) return "";
  const srcs = [...new Set(cams.map((c) => camSource(c.url)))].join(", ");
  const tip = info({ what: "cams", src: `${esc(srcs)}.`, how: "The time burned into each frame is when it was taken. \"Loaded\" is when your browser fetched it. Low cams see the valley, not the summit. Cams in the dark are hidden.", fresh: `Fetched ${esc(at)}.` });
  const figs = cams.map((c) => {
    const h = href(c.url);
    return h ? `<figure class="cam"><a href="${h}" target="_blank" rel="noopener" aria-label="${esc(`Open ${c.area} ${c.where} full size`)}"><img src="${h}" alt="${esc(c.alt)}" referrerpolicy="no-referrer"></a><figcaption><span class="area">${esc(c.area)}</span><br><span class="meta">${esc(c.where)}<br>loaded ${esc(at)}</span></figcaption></figure>` : "";
  }).join("");
  return `<section aria-labelledby="h-cams"><div class="sec-h"><h2 id="h-cams">Cams right now</h2>${tip.btn}</div>${tip.panel}<div class="cams" tabindex="0" aria-label="Cameras, scroll sideways">${figs}</div></section>`;
}

// brief: { text, at } for one mode, already checked fresh by the app; null hides it.
export function briefSection(brief, mode) {
  if (!brief || typeof brief.text !== "string" || !brief.text.trim()) return "";
  return `<section class="brief" aria-labelledby="h-brief"><div class="sec-h"><h2 id="h-brief">TLDR</h2><span class="small muted">AI summary · ${esc(brief.atText)}</span></div><div class="brief-card"><p class="brief-t">${esc(brief.text)}</p><p class="brief-n">Written by AI from the forecast, cams and avalanche centers. Compares weather only; check the avalanche forecast before choosing terrain.</p></div></section>`;
}

export function footer() {
  return `
    <h2>How to read this</h2>
    <p>Big numbers are NBM where it covers, else the middle of the weather models; the small numbers are the lowest and highest. "est." means computed, not measured. Dark bars are snow a station measured; blue bars are forecast. Cloud lines are a model read, so check the cams.</p>
    <p class="lead">Built entirely on free, public data.</p>
    <ul>
      <li>${OD} (${CC}): forecasts, cloud levels, freezing level</li>
      <li><a href="https://www.nrcs.usda.gov/resources/data-and-reports/snow-and-water-interactive-map" target="_blank" rel="noopener">NRCS SNOTEL</a> (USDA): measured snow depth and temperature</li>
      <li><a href="https://avalanche.org/" target="_blank" rel="noopener">avalanche.org</a>: <a href="https://nwac.us/avalanche-forecast/" target="_blank" rel="noopener">NWAC</a>, <a href="https://www.coavalanche.org/" target="_blank" rel="noopener">Central Oregon Avalanche Center</a> and <a href="https://www.idahopanhandleavalanche.org/" target="_blank" rel="noopener">Idaho Panhandle Avalanche Center</a> ratings</li>
      <li><a href="https://avalanche.ca/forecasts" target="_blank" rel="noopener">Avalanche Canada</a>: linked, not shown</li>
      <li>Cams: <a href="https://www.nps.gov/mora/learn/photosmultimedia/webcams.htm" target="_blank" rel="noopener">NPS Mount Rainier</a>, <a href="https://wsdot.com/travel/real-time/cameras" target="_blank" rel="noopener">WSDOT</a>, <a href="https://www.hcc.net/" target="_blank" rel="noopener">Hood Canal Communications</a></li>
    </ul>
    <p class="disc">Not an official forecast. Check the avalanche center before going into avalanche terrain.</p>`;
}
