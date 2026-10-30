// page/engine/parse.js
// Normalizes Open-Meteo responses: array or object; suffixed keys for several models, unsuffixed for one.
export function parseForecast(json, models, vars) {
  const locs = Array.isArray(json) ? json : [json];
  return locs.map((l) => {
    const h = l.hourly || {}, hu = l.hourly_units || {};
    const series = {}, units = {};
    for (const v of vars) {
      series[v] = {};
      for (const m of models) {
        const key = models.length === 1 ? v : `${v}_${m}`;
        if (Array.isArray(h[key])) {
          series[v][m] = h[key];
          if (units[v] == null && hu[key] != null) units[v] = hu[key];
        }
      }
    }
    return { time: h.time || [], utcOffset: l.utc_offset_seconds ?? 0, series, units };
  });
}
