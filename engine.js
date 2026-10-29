// page/engine.js
// Pure math shared with scripts/ski.py and scripts/wx.py. Pinned by tests/fixtures/engine.json.
// Change a rule here and in Python together, then run both suites.

export function slr(tF) {
  // Snow-to-liquid ratio from temperature (F). null = rain. Heuristic, not a published method.
  if (tF >= 35) return null;
  if (tF >= 33) return 5;
  if (tF >= 30) return 8;
  if (tF >= 24) return 11;
  if (tF >= 15) return 15;
  return 18;
}

export function snowFromHourly(temps, precip) {
  // Model snowfall fields are never used. Snow = water x slr(temp), hour by hour.
  let s = 0;
  for (let i = 0; i < precip.length; i++) {
    const p = precip[i], t = temps[i];
    if (p == null || t == null || p <= 0) continue;
    const r = slr(t);
    if (r != null) s += p * r;
  }
  return s;
}

export function wetness(prs) {
  // A 0.00-0.04 spread is noise, not a split.
  const lo = Math.min(...prs), hi = Math.max(...prs);
  if (hi < 0.05) return "dry";
  if (lo > 0.10) return `wet ${lo.toFixed(2)}-${hi.toFixed(2)}"`;
  return `SPLIT ${lo.toFixed(2)}-${hi.toFixed(2)}"`;
}

export function deck(lo, c8, elevFt) {
  // 850 hPa (~5,000 ft) discriminates in-deck from above-deck.
  if (lo < 20 && c8 < 20) return "clear at and below summit";
  if (lo > 55 && c8 < 20 && elevFt > 5000) return `LEAN UNDERCAST: deck below, ${elevFt} ft likely above it`;
  if (lo > 55 && c8 > 55) return "socked in at summit level";
  return `mixed (low ${Math.round(lo)}%, 850 ${Math.round(c8)}%)`;
}

export function trendWord(prs, snowMax) {
  // Days 3+: a word, never a number.
  let w = Math.max(...prs) < 0.05 ? "dry" : Math.min(...prs) > 0.10 ? "wet" : "maybe";
  if (snowMax > 0.3) w += " (snow)";
  return w;
}

export function fullWindow(vals, idx) {
  return idx.every((i) => vals && vals[i] != null);
}
