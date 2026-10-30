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

const CLOUD_VARS = ["cloud_cover_low", "cloud_cover_high", "freezing_level_height",
  ...LEVELS.map((p) => `cloud_cover_${p}hPa`), ...LEVELS.map((p) => `geopotential_height_${p}hPa`)];

export const PROFILES = {
  glance: { days: 8, models: [NBM, HRRR, HRDPS, NAM, ECMWF, GFS, ICON],
            hourly: ["temperature_2m", "precipitation", "weather_code", "wind_gusts_10m"] },
  clouds: { days: 6, models: [HRRR, HRDPS, GFS, ICON], hourly: CLOUD_VARS },
  detail: { days: 8, models: [NBM, HRRR, HRDPS, NAM, ECMWF, GFS, ICON],
            hourly: ["temperature_2m", "precipitation", "weather_code", "wind_speed_10m", "wind_direction_10m", "wind_gusts_10m"] },
};

export const BUDGET = 300;

export function weight(nLoc, days, nVars, nModels) {
  // Open-Meteo blog formula with a 14-day floor (the floor is unverified, so assume it applies).
  return nLoc * (Math.max(days, 14) / 14) * ((nVars * nModels) / 10);
}
