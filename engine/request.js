// page/engine/request.js
import { PROFILES, BUDGET, weight } from "./models.js";

const BASE = "https://api.open-meteo.com/v1/forecast";

export function forecastUrl(points, p) {
  const parts = [
    `latitude=${points.map((x) => x.lat.toFixed(5)).join(",")}`,
    `longitude=${points.map((x) => x.lon.toFixed(5)).join(",")}`,
    `elevation=${points.map((x) => Math.round(x.elev_ft / 3.28084)).join(",")}`,
    `hourly=${p.hourly.join(",")}`,
    `models=${p.models.join(",")}`,
    `forecast_days=${p.days}`,
    "timezone=auto",
    "temperature_unit=fahrenheit",
    "precipitation_unit=inch",
    "wind_speed_unit=mph",
  ];
  return `${BASE}?${parts.join("&")}`;
}

export function planRequests(points, profileName) {
  const p = PROFILES[profileName];
  const per = weight(1, p.days, p.hourly.length, p.models.length);
  const maxLoc = Math.max(1, Math.floor(BUDGET / per));
  const out = [];
  for (let i = 0; i < points.length; i += maxLoc) {
    const chunk = points.slice(i, i + maxLoc);
    out.push({ url: forecastUrl(chunk, p), points: chunk, weight: weight(chunk.length, p.days, p.hourly.length, p.models.length) });
  }
  return out;
}
