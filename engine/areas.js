// page/engine/areas.js
// The v3 area list (places.json "areas", built by scripts/build_places.py). Which place speaks for an area in each activity,
// which points the landing loads (program R7: the selected activity only) and which a place view loads. Pure: no fetch, no DOM.
// A stand-in place reuses another place's points; each point carries the key of the place it came from, so the data
// loaded once for "sc_adams:High" serves both the Hike area and the Ski stand-in.

export const MODES = ["ski", "hike"];
export const ptKey = (placeId, role) => `${placeId}:${role}`;
const withKeys = (place) => ({ ...place, points: place.points.map((p) => ({ ...p, key: p.key ?? ptKey(place.id, p.role) })) });
const role = (place, r) => place?.points.find((p) => p.role === r) || null;

export function areaIndex(P) {
  const places = Object.fromEntries(P.places.map((p) => [p.id, withKeys(p)]));
  const areas = P.areas.map((a) => ({ ...a }));
  return { areas, byArea: Object.fromEntries(areas.map((a) => [a.id, a])), places };
}

// Ski: the NWAC zone; else the main hike place as a backcountry stand-in (Trailhead as Base, High as Top, read at Top);
// else the first resort. The stand-in keeps the hike place's id in standIn.
export function skiPlace(area, places) {
  if (area.bc) return places[area.bc] || null;
  const h = places[area.hike[0]];
  if (h) {
    const th = role(h, "Trailhead"), hi = role(h, "High");
    return { ...h, id: `${h.id}__bc`, mode: "backcountry", glance: "Top", standIn: h.id,
      points: [th && { ...th, role: "Base" }, hi && { ...hi, role: "Top" }].filter(Boolean) };
  }
  return area.resorts.length ? places[area.resorts[0]] || null : null;
}

// Hike: the main hike place; else the zone as a stand-in (Mid as High, Base as Trailhead). Areas outside Washington: none.
export function hikePlace(area, places) {
  if (area.far) return null;
  if (area.hike.length) return places[area.hike[0]] || null;
  const z = places[area.bc];
  if (!z) return null;
  const mid = role(z, "Mid"), base = role(z, "Base");
  return { ...z, id: `${z.id}__hike`, mode: "hike", glance: "High", standIn: z.id,
    points: [mid && { ...mid, role: "High" }, base && { ...base, role: "Trailhead" }].filter(Boolean) };
}

export const placeFor = (area, mode, places) => (mode === "ski" ? skiPlace(area, places) : hikePlace(area, places));

// The point an area is ranked and shown at: Ski at its place's glance point, Hike at the high point. null when none.
export function rankPoint(area, mode, places) {
  const p = placeFor(area, mode, places);
  return p ? role(p, mode === "ski" ? p.glance : "High") : null;
}

export const areasFor = (areas, mode) => (mode === "ski" ? areas : areas.filter((a) => !a.far));
const uniq = (pts) => [...new Map(pts.filter(Boolean).map((p) => [p.key, p])).values()];

// R7: the landing loads glance at each area's ranking point for the selected activity only. Hike adds the freezing
// level at the same points for the snow line.
export function landingPoints(areas, mode, places) {
  return uniq(areasFor(areas, mode).map((a) => rankPoint(a, mode, places)));
}

// Where an area is, for Sort by distance (mock round 13): its Ski ranking point, the same point in either activity.
export function areaPoint(area, places) {
  const p = rankPoint(area, "ski", places);
  return p ? { lat: p.lat, lon: p.lon } : null;
}

// Resort rows (the Resorts view and a place view's Resorts section): glance at Mid for the next 24 h and the 7-day bars,
// bands (temperature and precipitation, short models, 2 days) at Base and Top for their next 24 h.
export function resortPoints(ids, places) {
  const rs = ids.map((id) => places[id]).filter(Boolean);
  return { mids: uniq(rs.map((r) => role(r, "Mid"))), bands: uniq(rs.flatMap((r) => [role(r, "Base"), role(r, "Top")])) };
}
export const allResorts = (areas) => [...new Set(areas.flatMap((a) => a.resorts))];

// A place view: detail, clouds and aloft at every spot (the zone or stand-in and the main hike place, so the Elevation tab
// shows both), and the area's resort rows.
export function placePoints(area, places) {
  const spots = uniq([skiPlace(area, places), hikePlace(area, places)].flatMap((p) => p?.points || []));
  return { spots, ...resortPoints(area.resorts, places) };
}
