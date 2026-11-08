// page/engine/models.js
// Model ids, lead-time sets and request profiles. Verified against Open-Meteo 2026-10-29.
export const NBM = "ncep_nbm_conus";
export const HRRR = "ncep_hrrr_conus";
export const HRDPS = "gem_hrdps_continental";
export const NAM = "ncep_nam_conus";
export const ECMWF = "ecmwf_ifs";
export const GFS = "gfs_seamless";
export const ICON = "icon_seamless";

export const SHORT = [NBM, HRRR, HRDPS, NAM];      // 0-48 h, mesoscale plus the NWS blend
export const MEDIUM = [NBM, ECMWF, GFS, ICON];     // days 3-7
export const CLOUD_SHORT = [HRRR, HRDPS];          // pressure-level clouds, 0-48 h
export const CLOUD_LONG = [GFS];
export const FREEZE_SHORT = [HRRR, ICON];          // freezing level, 0-48 h
export const FREEZE_LONG = [GFS, ICON];

export const LABEL = { [NBM]: "NBM", [HRRR]: "HRRR", [HRDPS]: "HRDPS", [NAM]: "NAM", [ECMWF]: "ECMWF", [GFS]: "GFS", [ICON]: "ICON" };
export const LEVELS = [850, 800, 750, 700, 650, 600];
export const WIND_LEVELS = [850, 800, 700];        // low to high. ICON has no 750 hPa wind

const CLOUD_VARS = ["cloud_cover_low", "cloud_cover_high", "freezing_level_height",
  ...LEVELS.map((p) => `cloud_cover_${p}hPa`), ...LEVELS.map((p) => `geopotential_height_${p}hPa`)];

export const PROFILES = {
  glance: { days: 8, models: [NBM, HRRR, HRDPS, NAM, ECMWF, GFS, ICON],
            hourly: ["temperature_2m", "precipitation", "weather_code", "wind_gusts_10m"] },
  clouds: { days: 6, models: [HRRR, HRDPS, GFS, ICON], hourly: CLOUD_VARS },
  detail: { days: 8, models: [NBM, HRRR, HRDPS, NAM, ECMWF, GFS, ICON],
            hourly: ["temperature_2m", "precipitation", "weather_code", "wind_speed_10m", "wind_direction_10m", "wind_gusts_10m"] },
  // v3 landing, Hike: freezing level only, for each area's snow line (Plan 2). 0.2 weight per point.
  freeze: { days: 3, models: FREEZE_SHORT, hourly: ["freezing_level_height"] },
  // v3 Resorts view and resort rows: next 24 h snow at each resort's Base and Top. 0.8 weight per point.
  bands: { days: 2, models: SHORT, hourly: ["temperature_2m", "precipitation"] },
  aloft: { days: 6, models: [HRRR, GFS, ICON],     // HRDPS left out: flat across levels on 2026-11-01
           hourly: WIND_LEVELS.flatMap((p) => [`wind_speed_${p}hPa`, `wind_direction_${p}hPa`, `geopotential_height_${p}hPa`]) },
};

export const BUDGET = 300;

export function weight(nLoc, days, nVars, nModels) {
  // Open-Meteo blog formula with a 14-day floor (the floor is unverified, so assume it applies).
  return nLoc * (Math.max(days, 14) / 14) * ((nVars * nModels) / 10);
}
