// page/engine/avalanche.js
// avalanche.org map layer and per-zone product. Ratings are shown with the center named and linked (Scott, 2026-10-29).
const API = "https://api.avalanche.org/v2/public";

export const DANGER_NAMES = { 1: "Low", 2: "Moderate", 3: "Considerable", 4: "High", 5: "Extreme" };

export const mapLayerUrl = (center) => `${API}/products/map-layer/${center}`;
export const productUrl = (center, zone) => `${API}/product?type=forecast&center_id=${center}&zone_id=${zone}`;

const https = (u) => (typeof u === "string" && u.startsWith("https://") ? u : null);

export function parseMapLayer(json) {
  const out = {};
  for (const f of json?.features || []) {
    const p = f.properties || {};
    out[f.id] = {
      zone: f.id, name: p.name, center_id: p.center_id, center: p.center,
      level: typeof p.danger_level === "number" ? p.danger_level : -1,
      danger: p.danger, off_season: !!p.off_season,
      link: https(p.link) || https(p.center_link),
      end_date: typeof p.end_date === "string" ? p.end_date : null,   // local wall time in `timezone`, e.g. 2026-11-21T02:30:00
      timezone: typeof p.timezone === "string" ? p.timezone : null,
    };
  }
  return out;
}

export function parseProduct(json) {
  if (!json || json.product_type !== "forecast" || !Array.isArray(json.danger) || !json.danger.length) return { bands: null, published: null, problems: [] };
  const cur = json.danger.find((d) => d.valid_day === "current") || json.danger[0];
  return {
    bands: { below: cur.lower, near: cur.middle, above: cur.upper },
    published: json.published_time || null,
    problems: (json.forecast_avalanche_problems || []).map((p) => ({ name: p.name, likelihood: p.likelihood, location: p.location || [] })),
  };
}
