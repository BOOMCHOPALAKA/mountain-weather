// page/engine/regions.js
// Region roll-ups, the top-three strip and the default mode.
export function regionNext24(areas) {
  const v = areas.filter((a) => a.n24);
  if (!v.length) return null;
  const out = {
    lo: Math.min(...v.map((a) => a.n24.lo)),
    hi: Math.max(...v.map((a) => a.n24.hi)),
    total: v.length,
    snowCount: v.filter((a) => a.n24.precip.type === "snow").length,
    rainCount: v.filter((a) => a.n24.precip.type === "rain").length,
  };
  const snowy = v.filter((a) => a.n24.precip.type === "snow");
  if (snowy.length) {
    out.snowMin = Math.min(...snowy.map((a) => a.n24.precip.value));
    out.snowMax = Math.max(...snowy.map((a) => a.n24.precip.value));
    out.snowAboveFt = Math.floor(Math.min(...snowy.map((a) => a.elev_ft)) / 500) * 500;
  }
  return out;
}

export function topThree(items, mode) {
  if (mode === "ski") {
    return items
      .filter((x) => x.n24 && x.n24.precip.type === "snow")
      .sort((a, b) => b.n24.precip.value - a.n24.precip.value || b.n24.precip.max - a.n24.precip.max)
      .slice(0, 3);
  }
  return items
    .filter((x) => x.elev_ft >= 4000 && x.tomorrow)
    .sort((a, b) => a.tomorrow.water - b.tomorrow.water || a.tomorrow.gust - b.tomorrow.gust)
    .slice(0, 3);
}

export function defaultMode({ avalancheInSeason = false, resortSnow24 = [], resortDepths = [] } = {}) {
  if (avalancheInSeason) return "ski";
  if (resortSnow24.some((v) => v >= 1)) return "ski";
  if (resortDepths.some((v) => v > 0)) return "ski";
  return "hike";
}
