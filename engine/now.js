// page/engine/now.js
// "Now": a real station temperature when one is close and fresh, else the model's current hour.
import { NBM, HRRR, HRDPS, NAM } from "./models.js";

const WMO = {
  0: ["clear", "sun"], 1: ["mostly clear", "sun"], 2: ["partly cloudy", "cloud"], 3: ["cloudy", "cloud"],
  45: ["fog", "fog"], 48: ["fog", "fog"],
  51: ["drizzle", "rain"], 53: ["drizzle", "rain"], 55: ["drizzle", "rain"], 56: ["freezing drizzle", "rain"], 57: ["freezing drizzle", "rain"],
  61: ["light rain", "rain"], 63: ["rain", "rain"], 65: ["heavy rain", "rain"], 66: ["freezing rain", "rain"], 67: ["freezing rain", "rain"],
  71: ["light snow", "snow"], 73: ["snow", "snow"], 75: ["heavy snow", "snow"], 77: ["snow grains", "snow"],
  80: ["showers", "rain"], 81: ["showers", "rain"], 82: ["heavy showers", "rain"], 85: ["snow showers", "snow"], 86: ["heavy snow showers", "snow"],
  95: ["thunderstorm", "storm"], 96: ["thunderstorm", "storm"], 99: ["thunderstorm", "storm"],
};

export function conditionFromCode(code) {
  const w = WMO[code];
  return w ? { word: w[0], icon: w[1] } : { word: "", icon: "cloud" };
}

export function modelNow(loc, idx) {
  for (const m of [NBM, HRRR, HRDPS, NAM]) {
    const T = loc.series.temperature_2m?.[m]?.[idx];
    if (T == null) continue;
    return { source: "model", model: m, tempF: T, ...conditionFromCode(loc.series.weather_code?.[m]?.[idx]) };
  }
  return null;
}

export function stationNow(station, anchorElevFt, nowMs, tzHours = -8) {
  if (!station || !station.latest || !Number.isFinite(station.latest.tobs)) return null;
  if (!(Number.isFinite(station.mi) && station.mi <= 3) || !(Number.isFinite(station.elev_ft) && Math.abs(station.elev_ft - anchorElevFt) <= 800)) return null;
  const [d, t] = String(station.latest.date || "").split(" ");
  const ms = Date.parse(`${d}T${t}:00Z`) - tzHours * 3600000;
  const ageMin = Math.round((nowMs - ms) / 60000);
  if (!Number.isFinite(ageMin) || ageMin < 0 || ageMin > 120) return null;
  return { source: "station", station: station.name, elev_ft: station.elev_ft, mi: station.mi, ageMin, tempF: station.latest.tobs };
}

export function nowReading(stationReading, modelReading) {
  if (stationReading) return { ...stationReading, word: modelReading?.word ?? "", icon: modelReading?.icon ?? "cloud" };
  return modelReading;
}
