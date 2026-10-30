// page/engine/snotel.js
// SNOTEL (NRCS AWDB). Mirrors scripts/snotel.py storms() exactly, including half-up rounding.
const AWDB = "https://wcc.sc.egov.usda.gov/awdbRestApi/services/v1/data";

export function snotelUrl(triplets, duration, beginDate, endDate, elements) {
  return `${AWDB}?stationTriplets=${triplets.join(",")}&elements=${elements.join(",")}&duration=${duration}`
    + `&beginDate=${beginDate.replaceAll(" ", "%20")}&endDate=${endDate.replaceAll(" ", "%20")}&periodRef=END`;
}

export function parseSnotel(raw) {
  const out = {};
  for (const st of raw || []) {
    const by = {};
    for (const el of st.data || []) {
      const code = el.stationElement.elementCode.toLowerCase();
      for (const v of el.values || []) {
        by[v.date] ??= { date: v.date, snwd: null, wteq: null, tobs: null };
        by[v.date][code] = v.value ?? null;
      }
    }
    out[st.stationTriplet] = Object.keys(by).sort().map((d) => by[d]);
  }
  return out;
}

export function storms(rows) {
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1], b = rows[i];
    if (a.snwd == null || b.snwd == null) continue;
    const nw = Math.max(b.snwd - a.snwd, 0);
    const water = a.wteq != null && b.wteq != null ? Math.round((b.wteq - a.wteq) * 10) / 10 : null;
    const slr = nw >= 1 && water && water >= 0.1 ? Math.floor(nw / water + 0.5) : null;
    out.push({ date: b.date, depth: b.snwd, new: nw, water, slr });
  }
  return out;
}

export function latestHourly(rows) {
  const r = [...rows].reverse().find((x) => x.tobs != null);
  return r ? { date: r.date, tobs: r.tobs, snwd: r.snwd ?? null } : null;
}
