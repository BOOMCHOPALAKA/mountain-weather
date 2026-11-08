// page/engine/window.js
// The weather window (Scott, 2026-11-06): the first stretch of hours when conditions stay open. Rain and snow close it at
// the earliest model. Wind closes it on one gust source per day, HRRR when it covers the whole day and NBM otherwise,
// because ECMWF and ICON run 10 m gusts far too high on mountain cells (Rainier, 2026-11-07: 34 to 93 mph against HRRR 14
// to 16). Rules come from a profile per activity; Ski and Hike share one today. A profile's hours may pass 24, so an
// overnight activity (camping) fits later.
import { slr } from "../engine.js";
import { HRRR, NBM } from "./models.js";
import { addDays, median, nowIndex } from "./forecast.js";
import { span, hourOf } from "./hours.js";
import { modelSet } from "./best.js";

// Starting numbers Scott approved 2026-11-06, to tune after a week of use.
const DAY = { fromH: 6, toH: 22, rainIn: 0.02, heavySnowIn: 1, snowWindIn: 0.1, snowWindMph: 25, gustMph: 30, minHours: 3, minModels: 2, days: 3 };
export const WINDOW = { ski: DAY, hike: DAY };
// When models give different reasons for the same hour, rain wins: it matters most (Scott, 2026-11-06).
const REASONS = ["rain", "heavy snow", "snow and wind"];
const fin = (x) => typeof x === "number" && Number.isFinite(x);

export function profile(mode) {
  const p = WINDOW[mode];
  if (!p) throw new Error(`unknown activity: ${mode}`);
  return p;
}

// The day's one gust source, chosen once so a handoff never opens or closes a window by itself: HRRR when it covers every
// hour, else NBM when it does, else "median" (the day's models, hour by hour), else null (no wind data). Gusts are the
// preceding hour's maximum (Open-Meteo docs), so the hour that starts at i reads index i + 1, like precipitation. 10 m, est.
export function gustSource(loc, idx, models) {
  const G = loc.series.wind_gusts_10m ?? {};
  const covers = (m) => idx.every((i) => fin(G[m]?.[i + 1]));
  for (const m of [HRRR, NBM]) if (covers(m)) return m;
  return models.some((m) => idx.some((i) => fin(G[m]?.[i + 1]))) ? "median" : null;
}

export function gustAt(loc, i, src, models) {
  const G = loc.series.wind_gusts_10m ?? {};
  if (src === "median") { const xs = models.map((m) => G[m]?.[i + 1]).filter(fin); return xs.length ? median(xs) : null; }
  return src && fin(G[src]?.[i + 1]) ? G[src][i + 1] : null;
}

// Why model m's precipitation closes the hour that starts at index i, given that hour's gust: "rain", "heavy snow",
// "snow and wind", null (open), or undefined (no data). Precipitation is the preceding hour's sum, so it reads i + 1,
// with the temperature at the end of that hour.
export function precipCloser(loc, m, i, p, gust) {
  const P = loc.series.precipitation?.[m]?.[i + 1], T = loc.series.temperature_2m?.[m]?.[i + 1];
  if (!fin(P) || !fin(T)) return undefined;
  const k = slr(T), snow = k == null ? 0 : P * k, rain = k == null ? P : 0;
  if (rain >= p.rainIn) return "rain";
  if (snow >= p.heavySnowIn) return "heavy snow";
  if (snow >= p.snowWindIn && fin(gust) && gust >= p.snowWindMph) return "snow and wind";
  return null;
}

// One day's window at one point. null when the day is past the profile's days, has no hour still ahead, or has no model
// with data. Otherwise:
//   { ymd, open: false, why, hours }   no stretch of minHours open hours; why = what closes the first closed hour
//   { ymd, open: true, from, to, late, rest, why, also, spread, stayOpen, models, gust, hours }
//     from, to  hours from midnight on ymd (6 = 6 AM, 22 = 10 PM, 25 = 1 AM the next day); to = when it closes
//     late      true when it opens after the first hour still ahead
//     rest      true when it is today and starts at the first hour still ahead, after the span's own start
//     why       what closes it, or null when it runs to the end of the span
//     also      the hour a later open stretch of minHours or more starts, or null
//     spread    for a rain or snow close: hours between the earliest and latest model that close (0 under 2 closes)
//     stayOpen  for a rain or snow close: how many models stay open to the end of the span
//     models    how many models speak for the day's rain and snow
//     gust      the day's gust source: a model id, "median", or null (no wind data, so wind cannot close it)
//     hours     [{ h, open, why, n, g }] for the hour strip (n = models speaking for rain and snow; g = the day's gust source
//               at that hour, or null)
// The window is the earliest open stretch of minHours or more (Scott, 2026-11-06: "prob morning... esp in winter").
// A short stretch at the end of today still counts when nothing closes it.
export function weatherWindow(loc, ymd, nowMs, mode = "ski") {
  const p = profile(mode), n = nowIndex(loc, nowMs);
  if (n < 0 || ymd > addDays(loc.time[n].slice(0, 10), p.days - 1)) return null;
  const all = span(loc, ymd, p.fromH, p.toH);
  const idx = all.filter((i) => i > n);
  if (!idx.length) return null;
  const ms = modelSet(loc, idx, nowMs, p.minModels);
  if (!ms.length) return null;
  const src = gustSource(loc, idx, ms);
  const hours = closeHours(loc, idx, ms, src, p, ymd);
  const strip = hours.map(({ h, open, why, g }) => ({ h, open, why, n: ms.length, g: fin(g) ? g : null }));
  const runs = [];   // open stretches as [first, last] positions in hours
  for (let k = 0; k < hours.length; k++) {
    if (!hours[k].open) continue;
    let e = k;
    while (e + 1 < hours.length && hours[e + 1].open && hours[e + 1].i === hours[e].i + 1) e++;
    runs.push([k, e]);
    k = e;
  }
  const long = runs.filter(([a, e]) => e - a + 1 >= p.minHours);
  const pick = long[0] ?? (hours.every((x) => x.open) ? runs[0] : null);
  if (!pick) return { ymd, open: false, why: hours.find((x) => !x.open)?.why ?? null, hours: strip };
  const [a, b] = pick, next = hours[b + 1] ?? null, why = next ? next.why : null;
  const later = long.find(([x]) => x > b);
  // For a rain or snow close, each model's own first close from the window's start.
  let spread = 0, stayOpen = 0;
  if (why && why !== "gusts") {
    const closes = [];
    for (const m of ms) {
      const k = hours.slice(a).findIndex((x) => precipCloser(loc, m, x.i, p, x.g));
      if (k < 0) stayOpen++; else closes.push(hours[a + k].h);
    }
    spread = closes.length >= 2 ? Math.max(...closes) - Math.min(...closes) : 0;
  }
  return {
    ymd, open: true, from: hours[a].h, to: next ? next.h : hours[b].h + 1, late: a > 0,
    rest: a === 0 && idx[0] !== all[0], why, also: later ? hours[later[0]].h : null,
    spread, stayOpen, models: ms.length, gust: src, hours: strip,
  };
}

// The window's closers on each hour that starts at an index in idx: { i, h, g, open, why }. Rain wins over the other
// precipitation reasons; a gust close applies only when precipitation leaves the hour open. h counts from midnight on ymd.
function closeHours(loc, idx, ms, src, p, ymd) {
  return idx.map((i) => {
    const g = gustAt(loc, i, src, ms), whys = ms.map((m) => precipCloser(loc, m, i, p, g));
    const why = REASONS.find((r) => whys.includes(r)) ?? (fin(g) && g >= p.gustMph ? "gusts" : null);
    return { i, h: hourOf(loc, ymd, i), g, open: !why, why };
  });
}

// The next p.days days from today's date at the point (today first). Entries are null for a day with no hour ahead.
export function windowsFor(loc, nowMs, mode = "ski") {
  const p = profile(mode), n = nowIndex(loc, nowMs);
  if (n < 0) return [];
  const ymd0 = loc.time[n].slice(0, 10);
  return Array.from({ length: p.days }, (_, d) => weatherWindow(loc, addDays(ymd0, d), nowMs, mode));
}

// Also the place view's hour strip text (page/place.js).
export const clock = (h) => { const x = ((h % 24) + 24) % 24; return x === 0 ? "midnight" : x === 12 ? "noon" : `${x % 12} ${x < 12 ? "AM" : "PM"}`; };

// The page's words: "Until about 7 PM, then rain. Models differ by 2 hours." The word "open" never describes the window,
// because a reader can take it for a resort's hours (Scott, 2026-11-07: "good weather window"). The TLDR copies the digest's
// window text, which tldrWindow below writes.
export function windowWords(w, mode = "ski") {
  if (!w) return null;
  if (!w.open) return w.why ? `No weather window: ${w.why}` : "No weather window";
  const p = profile(mode);
  const head = w.why
    ? (w.late ? `From ${clock(w.from)} to about ${clock(w.to)}, then ${w.why}` : `Until about ${clock(w.to)}, then ${w.why}`)
    : (w.late ? `Good weather window from ${clock(w.from)} through ${clock(w.to)}` : w.rest ? `Good weather window the rest of the day, through ${clock(w.to)}` : `Good weather window all day, through ${clock(w.to)}`);
  const tail = [];
  if (w.models < p.minModels) tail.push("One model");
  else if (w.why && w.why !== "gusts") {
    if (w.spread >= 1) tail.push(`Models differ by ${w.spread} hour${w.spread === 1 ? "" : "s"}`);
    if (w.stayOpen > 0) tail.push(`${w.stayOpen === 1 ? "One model keeps" : `${w.stayOpen} models keep`} the window through ${clock(p.toH)}`);
  }
  if (w.also != null) tail.push(`Another window from ${clock(w.also)}`);
  if (w.gust == null) tail.push("No wind data");
  return [head, ...tail].join(". ") + ".";
}

// The short form for area rows and pick cards (Design Direction, "Every level"): "good weather window till ~4 PM".
// Lowercase, so the page can lead with "Best Sat, ". lead: "good weather window" where it fits on one line at 390 px,
// "weather window" where it does not (Scott, 2026-11-07). The long form is windowWords.
export const WINDOW_LEAD = { long: "good weather window", short: "weather window" };
export function windowShort(w, lead = WINDOW_LEAD.long) {
  if (!w) return null;
  if (!w.open) return w.why ? `no weather window: ${w.why}` : "no weather window";
  if (w.why) return w.late ? `${lead} ${clock(w.from)} to ~${clock(w.to)}` : `${lead} till ~${clock(w.to)}`;
  return w.late ? `${lead} from ${clock(w.from)}` : w.rest ? `${lead} the rest of the day` : `${lead} all day`;
}

// The TLDR's window (Plan 3): the digest carries these fields and the text the writer copies, and tldr/check.mjs verifies
// the text against the fields. Only a day the window reaches and that opens; null otherwise. from and to are clock words
// ("9 AM", "noon", "4 PM"); until is what closes it (rain, heavy snow, snow and wind, gusts) or null when it runs to 10 PM.
export function tldrWindow(w) {
  if (!w || !w.open) return null;
  const from = clock(w.from), to = clock(w.to), until = w.why ?? null;
  const text = until
    ? (w.late ? `good weather window from ${from} to about ${to}, then ${until}` : `good weather window until about ${to}, then ${until}`)
    : (w.late ? `good weather window from ${from} through ${to}` : w.rest ? `good weather window the rest of the day, through ${to}` : `good weather window all day, through ${to}`);
  return { from, to, until, late: !!w.late, text };
}

// Not looking good (round 10, Lisa's "flagged in my face what I can't do"), by the window's own hourly rules, so a row's
// flag and its window line can never disagree: the window cannot open for minHours (3) inside the span, 8 AM to 5 PM for a
// day (the page passes the Now and Later today spans for those). Reasons are what closes those hours, rain first; a gust
// close carries the top gust. w: a weatherWindow result. [] when the span is fine, has no hours left, or there is no window
// (null: past the window's days or no data).
export const FLAG_SPAN = { fromH: 8, toH: 17 };
export function dayFlags(w, mode = "ski", span = FLAG_SPAN) {
  if (!w) return [];
  return flagReasons(w.hours.filter((x) => x.h >= span.fromH && x.h < span.toH), profile(mode));
}

// Not looking good for any stretch of hours (hour-start indices, in order), by exactly the window's closers: the same
// model set, the stretch's one gust source and the same reasons. For Now and Later today at any hour, including the night
// hours the window's 6 AM to 10 PM span leaves out (architect ruling, 2026-11-06). Same rule and shape as dayFlags.
export function stretchClose(loc, idx, nowMs, mode = "ski") {
  const p = profile(mode), ii = idx.filter((i) => i >= 0 && i + 1 < loc.time.length);
  if (!ii.length) return [];
  const ms = modelSet(loc, ii, nowMs, p.minModels);
  if (!ms.length) return [];
  return flagReasons(closeHours(loc, ii, ms, gustSource(loc, ii, ms), p, loc.time[ii[0]].slice(0, 10)), p);
}

// [] when the hours are all open or hold an open run of minHours; else what closes them, rain first, then the top gust.
function flagReasons(day, p) {
  if (!day.length || day.every((x) => x.open)) return [];
  let run = 0, best = 0;
  day.forEach((x, k) => { run = x.open ? (k > 0 && day[k - 1].open && day[k - 1].h === x.h - 1 ? run + 1 : 1) : 0; best = Math.max(best, run); });
  if (best >= p.minHours) return [];
  const shut = day.filter((x) => !x.open);
  const out = REASONS.filter((r) => shut.some((x) => x.why === r));
  const gs = shut.filter((x) => x.why === "gusts" && fin(x.g)).map((x) => x.g);
  if (gs.length) out.push(`gusts to ${Math.round(Math.max(...gs))} mph`);
  return out;
}
