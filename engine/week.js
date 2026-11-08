// page/engine/week.js
// Which slot or day the weather closes (Plan 2 final review I1). The one rule the landing (page/guide.js), the place view
// (page/place.js) and Plan 3's digest share, so a row, its place view and the TLDR name the same Best and Good days.
// Closed: the weather window never opens, or any weather reason applies to that slot or day (rain, heavy snow, snow and
// wind, gusts). Inside the window's days (profile(mode).days) the reasons come from the window's hourly rules, 8 AM to
// 5 PM (window.js dayFlags); Now and Later today use the window's closers on their own hours, at any time of day
// (window.js stretchClose); later days use the 8 AM to 5 PM numbers (best.js metricFlags). best.js rank, areaBest and
// goodDays skip closed entries. Avalanche and thin-snow reasons are not weather: they display only and never close
// (architect rulings, 2026-11-06).
import { metricFlags } from "./best.js";
import { weatherWindow, dayFlags, stretchClose, FLAG_SPAN } from "./window.js";
import { dayCard } from "./daycard.js";
import { nowIndex, addDays } from "./forecast.js";

const isLoc = (l) => !!l && Array.isArray(l.time) && !!l.series;

// One slot or day at a loc. ymd: its local date. m: the day's 8 AM to 5 PM numbers (best.js dayMetrics), read only past
// the window's days. idx: the hour-start indices of a Now or Later today slot; then the reasons come from those hours.
// Returns { w, reasons, closed }; w is the day's weatherWindow (null past the window's days or with no hour ahead).
export function slotClose(loc, ymd, nowMs, mode, { m = null, idx = null } = {}) {
  const w = weatherWindow(loc, ymd, nowMs, mode);
  const reasons = idx != null ? stretchClose(loc, idx, nowMs, mode) : w ? dayFlags(w, mode, FLAG_SPAN) : metricFlags(m);
  return { w, reasons, closed: (!!w && w.open === false) || reasons.length > 0 };
}

// An area's week at its ranking loc: 7 days from the loc's local date, today first, in the shape best.js areaBest and
// goodDays read. [{ ymd, offset, m, early, closed, reasons, w, card }]; m is the day card's daytime numbers (today: only
// the hours ahead, null from 4 PM). [] when the loc has no data or now is outside its hours.
export function weekEntries(loc, nowMs, mode) {
  const n = isLoc(loc) ? nowIndex(loc, nowMs) : -1;
  if (n < 0) return [];
  const ymd0 = loc.time[n].slice(0, 10);
  return Array.from({ length: 7 }, (_, d) => {
    const ymd = addDays(ymd0, d), card = dayCard(loc, ymd, d, nowMs);
    const { w, reasons, closed } = slotClose(loc, ymd, nowMs, mode, { m: card.day });
    return { ymd, offset: d, m: card.day, early: card.early, closed, reasons, w, card };
  });
}
