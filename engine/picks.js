// page/engine/picks.js
// The TLDR's thresholds and the resort calendar. The numbers are starting points Scott approved 2026-10-30, not published
// thresholds. Plan 3 (2026-11-07): Best comes from best.js through guide.js bestAhead, so niceDay, skyWord, bestSkiDay,
// stationSpeaks and snowQuality are gone. stormIn: Snow coming shows at 3 in or more over 5 days. baseIn: thin snow (guide.js).
// hotF: the v2 hike Top 3 (regions.js topThree, still read by the digest's modes); the v3 Best has no heat rule.
const fin = (x) => typeof x === "number" && Number.isFinite(x);
export const PICK = { stormIn: 3, hotF: 85, baseIn: 12 };

// Too hot to call the best hiking weather. June to September only. t: { ymd, hi }.
export function tooHot(t) {
  const m = Number(String(t?.ymd ?? "").slice(5, 7));
  return m >= 6 && m <= 9 && fin(t?.hi) && t.hi > PICK.hotF;
}
// places.json has no open dates, so this is a calendar stand-in for resorts running: November 15 to April 30. Change the dates here.
export const resortSeason = (ymd) => { const md = String(ymd ?? "").slice(5, 10); return md >= "11-15" || md <= "04-30"; };
