#!/usr/bin/env node
// tldr/check.mjs
// The gate between an AI-written TLDR and the public page. Rejects anything the digest does not support.
//
//   node tldr/check.mjs <digest.json> <brief.json> [--places <places.json>]
//
// Prints OK and exits 0, or prints one line per violation, "<field>: <rule>: <detail>", and exits 1.
// A false reject costs one retry. A false pass puts a wrong forecast in front of skiers, so every
// ambiguous case below is decided in favour of rejecting.
//
// Rules: at (1), shape (2), numbers (3), places (4), avalanche (5), advice (6), markup. Spec: tldr/prompt.md.
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const MAX_CHARS = 320;
const MAX_SENTENCES = 3;
const AT_WINDOW_MS = 15 * 60 * 1000;
const DANGER_WORDS = ["Low", "Moderate", "Considerable", "High", "Extreme"];
// Lowercase "considerable" and "extreme" are always danger words. Lowercase "moderate", "high" and "low" are weather
// ("high pressure") unless the sentence is talking about avalanche danger.
const ALWAYS_DANGER_LC = ["considerable", "extreme"];
const MAYBE_DANGER_LC = ["moderate", "high", "low"];
const DANGER_CONTEXT = /(?<![A-Za-z0-9])(avalanche|danger|rating|rated|risk)(?![A-Za-z0-9])/i;
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December",
  "Jan", "Feb", "Mar", "Apr", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const OTHER_ALLOWED = ["NWAC", "COAA", "IPAC", "Avalanche", "Canada", "NBM", "HRRR", "ECMWF", "GFS", "ICON", "HRDPS", "NAM", "SNOTEL", "AM", "PM", "TLDR"];
// One-word compass pieces are not place names ("East of the Cascades"). "Cascades" alone is a range, not a zone.
const DIRECTIONS = new Set(["East", "West", "North", "South", "Central", "Upper", "Lower"]);
// All-caps words of two or more letters must be one of these. "BAKER" is a place name in the wrong case, not an acronym.
const ACRONYMS = new Set(["NWAC", "COAA", "IPAC", "NBM", "HRRR", "ECMWF", "GFS", "ICON", "HRDPS", "NAM", "SNOTEL", "AM", "PM", "TLDR", "BC"]);
// A contrast word between a place and its danger word means the rating may describe somewhere else.
const CONTRAST = /(?<![A-Za-z])(while|but|whereas|except|elsewhere)(?![A-Za-z])/i;
const ALLOWED_WORDS = new Set([...DAYS, ...MONTHS, ...OTHER_ALLOWED, ...DANGER_WORDS, ...DIRECTIONS, "Cascades"]);
// Ordinary words that also appear inside a place name ("Snow Lake", "Hoh Rain Forest", "The Brothers", "Mt Baker Ski Area").
// A sentence may start with one of these on its own. Anywhere else, a capitalized token of a place name must sit inside a full name.
const PLAIN_STARTERS = new Set(["Rain", "Snow", "Cold", "The", "Dry", "Wind", "Winds", "Windy", "Gusts", "Clear", "Clouds", "Cloud", "Fog", "Warm",
  "Heavy", "Light", "Showers", "West", "East", "North", "South", "Ski", "Mountain", "Most", "Summit", "Valley", "Great", "Southern"]);

// Case-insensitive, whole word or phrase. Inflections are listed because the prompt bans "any form of the sentence".
const BANNED = [
  "safe", "safely", "safer", "safest", "unsafe", "should", "recommend", "recommends", "recommended", "recommending", "recommendation", "recommendations",
  "avoid", "avoids", "avoided", "avoiding", "go ski", "go skiing", "go hike", "go hiking", "best bet", "must", "guarantee", "guarantees", "guaranteed",
  "perfect", "perfectly",
];
// Spelled-out numbers dodge the digit check, so they are rejected too. "one" is left out: "one system" is ordinary prose.
const NUMBER_WORDS = ["two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen",
  "sixteen", "seventeen", "eighteen", "nineteen", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety", "hundred", "thousand", "dozen"];

// Avalanche talk without the five danger words. No sentence may use a numeric danger level. STRONG_LOOSE words only ever describe
// hazard, so they are rejected in any sentence that touches avalanche terrain (AVAL_CONTEXT). WEAK_LOOSE words are ordinary weather
// prose too ("little new snow", "minor wind on the upper slopes"), so they are rejected only in a sentence that is about avalanche
// danger itself (AVAL_STRICT). The only legal avalanche vocabulary is the center name plus the digest's word, or an exact state phrase
// (STATE_PHRASES) that the digest backs.
const AVAL_CONTEXT = /(?<![A-Za-z0-9])(avalanche|danger[a-z]*|hazard|ratings?|rated|rates|risk|conditions?|slopes?|snowpack|terrain|stability)(?![A-Za-z0-9])/i;
const AVAL_STRICT = /(?<![A-Za-z0-9])(avalanche|danger[a-z]*|hazard|snowpack|stability)(?![A-Za-z0-9])/i;
const STRONG_LOOSE = ["stable", "unstable", "dangerous", "no danger", "severe", "benign", "manageable", "favorable", "unfavorable", "tricky",
  "touchy", "reactive", "sketchy", "hazardous", "deadly", "high-risk", "low-risk"];
const WEAK_LOOSE = ["minimal", "minor", "little", "limited", "elevated", "serious", "significant"];
// "level 4", "levels 4", "4 of 5", "4/5", "4 out of 5". A snow level such as "level 2,500 ft" is an elevation, not a rating.
const LEVEL_NUMBER = [
  /(?<![A-Za-z0-9])levels?\s*[1-5](?![\d]|[,.]\d)/i,
  /(?<![\d])[0-5]\s*(?:of|out\s+of|\/)\s*5(?![\d]|[,.]\d)/i,
];
const CENTERS = ["NWAC", "COAA", "IPAC"];
// What a sentence may claim about a center, mapped to the avalanche[].state that backs it.
const STATE_PHRASES = [
  { state: "off-season", re: /(?<![A-Za-z0-9])off[- ]?season(?![A-Za-z0-9])/i, label: "off-season" },
  { state: "no-rating", re: /(?<![A-Za-z0-9])no\s+ratings?(?![A-Za-z0-9])/i, label: "no rating" },
  { state: "expired", re: /(?<![A-Za-z0-9])expired(?![A-Za-z0-9])/i, label: "expired" },
  { state: "unavailable", re: /(?<![A-Za-z0-9])unavailable(?![A-Za-z0-9])/i, label: "unavailable" },
];

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Whole word: not glued to a letter or digit on either side. Works for names that end in punctuation, like "St.".
const wholeRe = (s, flags = "g") => new RegExp(`(?<![A-Za-z0-9])${esc(s)}(?![A-Za-z0-9])`, flags);
const hasWhole = (text, s) => wholeRe(s, "").test(text);
const MASK = "\u0000";
const cap = (w) => w[0].toUpperCase() + w.slice(1);

/* ---------- known names ---------- */
// Every name a writer could use for a place, from places.json: region titles, place titles, each comma-separated piece of a
// subtitle, every point name and every SNOTEL station name. A bare compass word ("East") is not a name.
export function knownNamesFrom(P) {
  const out = new Set();
  const add = (x) => { if (typeof x === "string" && x.trim() && !DIRECTIONS.has(x.trim())) out.add(x.trim()); };
  for (const list of Object.values(P?.regions || {})) for (const r of list || []) add(r?.title);
  for (const p of P?.places || []) {
    add(p?.title);
    String(p?.subtitle || "").split(",").forEach(add);
    (p?.points || []).forEach((x) => add(x?.name));
    (p?.snotel || []).forEach((x) => add(x?.name));
  }
  return [...out];
}

/* ---------- text helpers ---------- */
// A sentence ends at . ! ? followed by whitespace and a capital letter, or at the end of the text.
// A period after Mt, St or est ("Mount St. Helens", "5-9 in est.") does not end one. A period inside "1.5" never does.
export function splitSentences(text) {
  const out = [];
  let start = 0;
  const re = /([.!?])(\s+)(?=[A-Z])/g;
  let m;
  const push = (s, e) => {
    const raw = text.slice(s, e);
    const lead = raw.length - raw.trimStart().length;
    const t = raw.trim();
    if (t) out.push({ start: s + lead, end: s + lead + t.length, text: t });
  };
  while ((m = re.exec(text))) {
    if (m[1] === ".") {
      const w = /([A-Za-z]+)$/.exec(text.slice(0, m.index));
      if (w && /^(Mt|St|est)$/.test(w[1])) continue;
    }
    push(start, m.index + 1);
    start = m.index + m[0].length;
  }
  push(start, text.length);
  return out;
}
const sentenceAt = (sents, pos) => {
  for (let i = 0; i < sents.length; i++) if (pos < sents[i].end) return Math.max(i, 0);
  return sents.length - 1;
};

// Any Unicode decimal digit (full-width, Arabic-Indic, ...) becomes its ASCII digit.
function asciiDigits(s) {
  return s.replace(/\p{Nd}/gu, (c) => {
    const cp = c.codePointAt(0);
    let z = cp;
    while (/\p{Nd}/u.test(String.fromCodePoint(z - 1))) z--;
    return String((cp - z) % 10);
  });
}
const VULGAR_FRACTION = /[¼-¾⅐-⅟↉⁄]/;

// Find every name in text, longest first, so "Stevens Pass East" is not also counted as "Stevens Pass".
// Multi-word names match in any case ("mt baker"); one-word names match case-sensitively.
// Matched spans are blanked in `masked` so a shorter name cannot match inside them again.
function findNames(text, names) {
  const sorted = [...new Set(names)].sort((a, b) => b.length - a.length || (a < b ? -1 : 1));
  let masked = text;
  const hits = [];
  for (const name of sorted) {
    const re = wholeRe(name, /\s/.test(name) ? "gi" : "g");
    let m;
    const here = masked;
    while ((m = re.exec(here))) {
      hits.push({ name, start: m.index, end: m.index + name.length });
      masked = masked.slice(0, m.index) + MASK.repeat(name.length) + masked.slice(m.index + name.length);
    }
  }
  hits.sort((a, b) => a.start - b.start);
  return { hits, masked };
}

/* ---------- rule 1: at ---------- */
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
// Epoch ms for an ISO 8601 string with an offset, or null when it is not one (including impossible dates like Feb 30).
export function parseIso(s) {
  if (typeof s !== "string") return null;
  const m = ISO_RE.exec(s);
  if (!m) return null;
  const [y, mo, d, h, mi, se = "0"] = m.slice(1, 7).map(Number);
  if (mo < 1 || mo > 12 || h > 23 || mi > 59 || se > 59) return null;
  if (d < 1 || d > new Date(Date.UTC(y, mo, 0)).getUTCDate()) return null;
  if (m[7] !== "Z") { const [oh, om] = m[7].slice(1).split(":").map(Number); if (oh > 23 || om > 59) return null; }
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? ms : null;
}
function checkAt(digest, brief, out) {
  const base = parseIso(digest?.at);
  if (base === null) { out.push("at: at: digest.at is missing or not ISO 8601 with an offset"); return; }
  if (typeof brief?.at !== "string") { out.push("at: at: brief.at is missing"); return; }
  const t = parseIso(brief.at);
  if (t === null) { out.push(`at: at: "${brief.at}" is not ISO 8601 with an offset`); return; }
  const min = Math.round(Math.abs(t - base) / 60000);
  if (Math.abs(t - base) > AT_WINDOW_MS) out.push(`at: at: ${brief.at} is ${min} minutes from the digest time ${digest.at} (limit 15)`);
}

/* ---------- one pass over a text ---------- */
// Everything the rules share: the normalized text, its sentences, and every name found in it.
// Normalizing: NFKC (full-width letters and digits), any other decimal digit to ASCII, and "Mt." to "Mt".
function analyze(raw, digest, known) {
  const fraction = VULGAR_FRACTION.test(raw);
  const text = asciiDigits(raw.normalize("NFKC")).replace(/\bMt\./g, "Mt");
  const index = digest.place_index && typeof digest.place_index === "object" && !Array.isArray(digest.place_index) ? digest.place_index : {};
  const keys = Object.keys(index);
  const missing = new Set(Array.isArray(digest.missing) ? digest.missing.filter((x) => typeof x === "string") : []);
  const ambiguous = new Set(Array.isArray(digest.ambiguous) ? digest.ambiguous.filter((x) => typeof x === "string") : []);
  const aval = Array.isArray(digest.avalanche) ? digest.avalanche.filter((a) => a && typeof a === "object") : [];
  const zoneNames = aval.map((a) => a.zone).filter((z) => typeof z === "string" && z);
  const knownSet = new Set(known);
  // Place names, missing names and zone names are all matched as full spans. Only the first three can be a violation by themselves.
  const names = [...knownSet, ...keys, ...missing, ...ambiguous, ...zoneNames];
  const tokens = new Set(names.flatMap((n) => n.match(/[A-Za-z]+/g) || []).filter((w) => !DIRECTIONS.has(w)));
  const { hits, masked } = findNames(text, names);
  return { raw, text, fraction, sents: splitSentences(text), hits, masked, index, keys, missing, ambiguous, aval, knownSet, tokens };
}

/* ---------- rule 3: numbers ---------- */
function digestNumbers(digest) {
  return (Array.isArray(digest?.numbers) ? digest.numbers : []).filter((n) => typeof n === "number" && Number.isFinite(n));
}
const AFTER_YEAR_UNIT = /^\s?(ft\b|feet\b|foot\b|'|in\b|inch|″|"|mph\b|%|°|mi\b|miles?\b|cm\b|mm\b|m\b)/i;
const MONTH_RE = "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sept?(?:ember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";
const BEFORE_MONTH = new RegExp(`(?<![A-Za-z])${MONTH_RE}\\.?\\s+(?:\\d{1,2}(?:st|nd|rd|th)?,?\\s+)?$`);
const AFTER_MONTH = new RegExp(`^\\s+(?:\\d{1,2}\\s+)?${MONTH_RE}(?![A-Za-z])`);
// Directly after a number: "4k", or a metric unit. The digest speaks feet, inches, mph and degrees F.
const K_SUFFIX = /^\s?[kK](?![A-Za-z])/;
const METRIC_UNIT = /^(\s?(?:m|km|cm|mm|meters?|metres?|kilometers?|kilometres?)(?![A-Za-z0-9])|\s?°\s?[Cc](?![A-Za-z])|\s?C(?![A-Za-z]))/i;
function checkNumbers(field, a, digest, nums, out) {
  if (a.fraction) out.push(`${field}: numbers: fractions such as ½ are not allowed; write the number the digest shows`);
  // Clock times and "6 AM" / "6-9 PM" (hours 1-12) are not forecast numbers. Blank them first.
  const t = a.masked
    .replace(/(?<![\d.:])(?:[01]?\d|2[0-3]):[0-5]\d(?![\d:])/g, (s) => " ".repeat(s.length))
    .replace(/(?<![\d.])(?:1[0-2]|[1-9])(?:\s?[-–]\s?(?:1[0-2]|[1-9]))?\s?(?:AM|PM)\b/gi, (s) => " ".repeat(s.length));
  const digestYear = /^\d{4}/.test(digest?.at || "") ? Number(digest.at.slice(0, 4)) : null;
  const seen = new Set();
  const re = /\d[\d,]*(\.\d+)?/g;
  let m;
  while ((m = re.exec(t))) {
    const raw = m[0];
    const clean = raw.replaceAll(",", "");
    let x = Number(clean);
    if (!Number.isFinite(x)) continue;
    const after = t.slice(m.index + raw.length);
    if (K_SUFFIX.test(after) || METRIC_UNIT.test(after)) {
      const msg = `${field}: numbers: ${raw} is followed by k or a metric unit; use the feet, inches, mph and degrees F the digest shows`;
      if (!seen.has(msg)) { seen.add(msg); out.push(msg); }
      continue;
    }
    // A year is a bare 4-digit token beside a month name and within one of the digest's own year. "2000 ft" and "2,000" are elevations.
    if (/^(19|20)\d{2}$/.test(raw) && !AFTER_YEAR_UNIT.test(after) && digestYear !== null && Math.abs(x - digestYear) <= 1
      && (BEFORE_MONTH.test(t.slice(0, m.index)) || AFTER_MONTH.test(after))) continue;
    // A minus sign counts when nothing numeric precedes it ("-3" but not the dash in "8-14").
    const prev = t[m.index - 1], prev2 = t[m.index - 2];
    if ((prev === "-" || prev === "−") && (prev2 === undefined || /[\s(]/.test(prev2))) x = -x;
    const ok = Math.abs(x) < 100
      ? nums.some((n) => Math.abs(n) < 100 && Math.abs(n - x) <= 1)
      : nums.includes(x);
    if (!ok && !seen.has(raw)) {
      seen.add(raw);
      out.push(`${field}: numbers: ${raw} is not in the digest's numbers${Math.abs(x) < 100 ? " (within 1)" : " (exact match needed at 100 or more)"}`);
    }
  }
  const words = new Set();
  for (const w of NUMBER_WORDS) if (wholeRe(w, "i").test(a.masked)) words.add(w);
  for (const w of words) out.push(`${field}: numbers: spelled-out number "${w}"; write the digits from the digest`);
}

/* ---------- rules 4 and 5: places and avalanche ---------- */
function checkPlacesAndAvalanche(field, a, out) {
  const { text, sents, hits, masked, index, missing, ambiguous, aval, knownSet, tokens } = a;
  const byKey = new Map(aval.filter((z) => typeof z.key === "string").map((z) => [z.key, z]));

  // Rule 4a: a name the digest does not carry. A zone name that is neither a place nor a known name only covers its span.
  const said = new Set();
  for (const h of hits) {
    if (said.has(h.name)) continue;
    if (missing.has(h.name)) out.push(`${field}: places: "${h.name}" is listed under missing in the digest; leave it out`), said.add(h.name);
    else if (ambiguous.has(h.name)) out.push(`${field}: places: "${h.name}" is listed under ambiguous in the digest; leave it out`), said.add(h.name);
    else if (!Object.hasOwn(index, h.name) && knownSet.has(h.name)) out.push(`${field}: places: "${h.name}" is not in the digest's places`), said.add(h.name);
  }

  // Rule 4b: every capitalized word left after the full names are blanked. A token of a place or zone name is a partial name
  // ("Baker", "Stevens", "Snoqualmie") wherever it sits. Anything else mid-sentence must be an allowed word.
  const starts = new Set(sents.map((s) => s.start));
  const said4b = new Set();
  for (const [w] of masked.matchAll(/(?<![A-Za-z0-9])[A-Z]{2,}(?![A-Za-z0-9])/g)) {
    if (ACRONYMS.has(w) || said4b.has(w)) continue;
    said4b.add(w);
    out.push(`${field}: places: unknown all-caps word "${w}"; only NWAC, COAA, IPAC, model names and the like may be in capitals`);
  }
  // A compass word glued to a name ("Mt Baker North", "Lower Mt Baker") names an area the digest does not have. A compass word
  // that begins or ends a longer name is already inside that name's blanked span and is not seen here.
  for (const h of hits) {
    const before = /(North|South|East|West|Upper|Lower|Central)\s+$/.exec(masked.slice(0, h.start));
    const after = /^\s+(North|South|East|West|Upper|Lower|Central)(?![A-Za-z0-9])/.exec(masked.slice(h.end));
    for (const c of [before?.[1], after?.[1]].filter(Boolean)) {
      const id = `${c}|${h.name}`;
      if (said4b.has(id)) continue;
      said4b.add(id);
      out.push(`${field}: places: compass word "${c}" beside "${h.name}"; use the full name from the digest's places`);
    }
  }
  const capRe = /(?<![A-Za-z0-9'’])[A-Z][A-Za-z]*(?:['’][A-Za-z]+)?/g;
  let m;
  while ((m = capRe.exec(masked))) {
    const w = m[0].replace(/['’][A-Za-z]+$/, "");
    if (said4b.has(w) || ALLOWED_WORDS.has(w) || /^[A-Z]{2,}$/.test(w)) continue;
    const atStart = starts.has(m.index);
    if (tokens.has(w)) {
      if (atStart && PLAIN_STARTERS.has(w)) continue;
      said4b.add(w);
      out.push(`${field}: places: partial place name "${w}"; use the full name from the digest's places`);
    } else if (!atStart) {
      said4b.add(w);
      out.push(`${field}: places: unknown name "${w}"; it is not part of any place in the digest`);
    }
  }

  // Rule 5. Zones resolve only through place_index -> avalanche[].key, never by matching a zone name.
  const placed = hits
    .filter((h) => Object.hasOwn(index, h.name))
    .map((h) => ({ ...h, s: sentenceAt(sents, h.start), entry: index[h.name] == null ? null : byKey.get(index[h.name]) || null }));
  const has = (i, w) => i >= 0 && i < sents.length && hasWhole(sents[i].text, w);

  // 5a: a named place in a rated zone carries its center and word together, in its own sentence (5b rejects a danger word
  // in a sentence with no place, so a word in the next sentence cannot satisfy this).
  const checkedA = new Set();
  for (const p of placed) {
    if (!p.entry || p.entry.state !== "rated") continue;
    const id = `${p.name}@${p.s}`;
    if (checkedA.has(id)) continue;
    checkedA.add(id);
    const { center, word } = p.entry;
    if (typeof word !== "string" || typeof center !== "string") { out.push(`${field}: avalanche: the digest rates ${p.name}'s zone without a center or word`); continue; }
    const ok = [p.s, p.s + 1].some((i) => has(i, center) && has(i, word));
    if (!ok) out.push(`${field}: avalanche: ${p.name} is rated ${word} by ${center} today; name "${center}" and "${word}" in its own sentence`);
  }

  // 5b: a danger word belongs to the closest place named before it in its own sentence, or, when none comes before it, to the
  // first place named after it in that sentence. A sentence that names no place cannot carry a rating. That place's zone must be
  // rated with exactly that word, nothing contrasting may sit between them, and a place mention takes one danger word.
  const dangers = [];
  const capDanger = new RegExp(`(?<![A-Za-z0-9])(${DANGER_WORDS.join("|")})(?![A-Za-z0-9])`, "g");
  while ((m = capDanger.exec(masked))) dangers.push({ word: m[1], pos: m.index });
  const lcDanger = new RegExp(`(?<![A-Za-z0-9])(${[...ALWAYS_DANGER_LC, ...MAYBE_DANGER_LC].join("|")})(?![A-Za-z0-9])`, "g");
  while ((m = lcDanger.exec(masked))) {
    const w = m[1];
    if (ALWAYS_DANGER_LC.includes(w) || DANGER_CONTEXT.test(sents[sentenceAt(sents, m.index)]?.text ?? text)) dangers.push({ word: cap(w), pos: m.index });
  }
  dangers.sort((x, y) => x.pos - y.pos);
  const taken = new Set();
  for (const d of dangers) {
    const si = sentenceAt(sents, d.pos);
    const inSentence = placed.filter((p) => p.s === si);
    const att = inSentence.filter((p) => p.end <= d.pos).pop() || inSentence.find((p) => p.start >= d.pos);
    if (!att) { out.push(`${field}: avalanche: "${d.word}" has no place named in its sentence`); continue; }
    const [lo, hi] = att.end <= d.pos ? [att.end, d.pos] : [d.pos, att.start];
    const why = [];
    if (!(att.entry && att.entry.state === "rated" && att.entry.word === d.word)) why.push(`"${d.word}" is not the rating of the place it follows (${att.name})`);
    if (CONTRAST.test(masked.slice(lo, hi))) why.push(`"${d.word}" is separated from ${att.name} by a contrast word`);
    if (taken.has(att.start)) why.push(`${att.name} already has a danger word in this mention`);
    taken.add(att.start);
    for (const w of why) out.push(`${field}: avalanche: ${w}`);
  }
}

/* ---------- rule 5c: avalanche claims made without a danger word ---------- */
function checkLooseAvalanche(field, a, out) {
  for (const re of LEVEL_NUMBER) {
    const m = re.exec(a.text);
    if (m) out.push(`${field}: avalanche: "${m[0].trim()}" is a danger level number; use the center name and the danger word from the digest, never a level`);
  }
  const bad = new Set();
  const has = (text, w) => new RegExp(`(?<![A-Za-z0-9])${w.split(" ").map(esc).join("\\s+")}(?![A-Za-z0-9])`, "i").test(text);
  for (const s of a.sents) {
    if (AVAL_CONTEXT.test(s.text)) for (const w of STRONG_LOOSE) if (has(s.text, w)) bad.add(w);
    if (AVAL_STRICT.test(s.text)) for (const w of WEAK_LOOSE) if (has(s.text, w)) bad.add(w);
  }
  for (const w of bad) out.push(`${field}: avalanche: "${w}" describes avalanche conditions in words the digest does not carry; use only the center name and its danger word, or the state ("off-season", "no rating", "expired", "unavailable")`);

  // A state phrase must match a real state. Each state phrase attaches to the closest center named before it in its sentence, else the
  // first center after it, and that center needs an entry in that state. "no rating(s)" is also true of an off-season center
  // ("NWAC is off-season with no ratings yet"). With no center in the sentence, any entry in that state will do.
  const statesOf = (c) => [...new Set(a.aval.filter((z) => z.center === c).map((z) => z.state))];
  const ok = (st, p) => st.includes(p.state) || (p.state === "no-rating" && st.includes("off-season"));
  const said = new Set();
  const fail = (msg) => { if (!said.has(msg)) { said.add(msg); out.push(`${field}: avalanche: ${msg}`); } };
  for (const s of a.sents) {
    const centers = [];
    for (const c of CENTERS) for (const m of s.text.matchAll(wholeRe(c, "gi"))) centers.push({ c, at: m.index });
    centers.sort((x, y) => x.at - y.at);
    for (const p of STATE_PHRASES) {
      for (const m of s.text.matchAll(new RegExp(p.re.source, "gi"))) {
        // "expired" and "unavailable" are ordinary words; they only describe avalanche data in an avalanche sentence.
        if (["expired", "unavailable"].includes(p.state) && !centers.length && !AVAL_CONTEXT.test(s.text)) continue;
        if (!centers.length) {
          if (!a.aval.some((z) => ok([z.state], p))) fail(`"${p.label}" is not a state the digest shows; say exactly the state the digest shows`);
          continue;
        }
        const before = centers.filter((x) => x.at < m.index);
        const c = (before.length ? before[before.length - 1] : centers[0]).c;
        const st = statesOf(c);
        if (!ok(st, p)) fail(`${c} is not ${p.label} in the digest (its state is ${st.join(", ") || "not listed"}); say exactly the state the digest shows, one center per clause: "NWAC is off-season and COAA has no rating posted"`);
      }
    }
  }
}

/* ---------- rule 6: advice ---------- */
function checkAdvice(field, text, out) {
  const found = new Set();
  for (const b of BANNED) {
    const re = new RegExp(`(?<![A-Za-z0-9])${b.split(" ").map(esc).join("\\s+")}(?![A-Za-z0-9])`, "i");
    if (re.test(text)) found.add(b);
  }
  for (const b of found) out.push(`${field}: advice: "${b}" is banned; compare the weather, do not tell the reader what to do`);
}

/* ---------- markup ---------- */
function checkMarkup(field, text, out) {
  for (const bad of ["<", ">", "http", "www"]) if (text.toLowerCase().includes(bad)) out.push(`${field}: markup: "${bad}" is not allowed in the text`);
}

/* ---------- the check ---------- */
// check(digest, brief, knownNames) -> array of violation lines. Empty means the brief passes.
export function check(digest, brief, knownNames = []) {
  const out = [];
  if (!digest || typeof digest !== "object" || Array.isArray(digest)) return ["digest: shape: digest.json is not a JSON object"];
  if (!brief || typeof brief !== "object" || Array.isArray(brief)) return ["brief: shape: brief.json is not a JSON object"];
  const known = [...knownNames].filter((x) => typeof x === "string" && x && !DIRECTIONS.has(x));
  const nums = digestNumbers(digest);

  checkAt(digest, brief, out);

  for (const field of ["ski", "hike"]) {
    const text = brief[field];
    if (typeof text !== "string" || !text.trim()) { out.push(`${field}: shape: must be a non-empty string`); continue; }
    // Everything runs even after a shape failure, so the writer sees every problem in one pass.
    const a = analyze(text, digest, known);
    const n = a.sents.length;
    if (n < 1 || n > MAX_SENTENCES) out.push(`${field}: shape: ${n} sentences; need 1 to ${MAX_SENTENCES}`);
    if (text.length > MAX_CHARS) out.push(`${field}: shape: ${text.length} characters; limit ${MAX_CHARS}`);
    checkMarkup(field, a.text, out);
    checkNumbers(field, a, digest, nums, out);
    checkPlacesAndAvalanche(field, a, out);
    checkLooseAvalanche(field, a, out);
    checkAdvice(field, a.text, out);
  }
  return [...new Set(out)];
}

/* ---------- CLI ---------- */
function readJson(file, label) {
  let raw;
  try { raw = fs.readFileSync(file, "utf8"); } catch (e) { return { err: `${label}: read: cannot read ${file} (${e.code || e.message})` }; }
  try { return { value: JSON.parse(raw) }; } catch (e) { return { err: `${label}: json: ${file} is not valid JSON (${String(e.message).split("\n")[0]})` }; }
}
// --places wins; otherwise places.json beside tldr/ (deploy layout), then data/places.json (skill repo layout).
function defaultPlacesPath() {
  for (const rel of ["../places.json", "../data/places.json"]) {
    const p = fileURLToPath(new URL(rel, import.meta.url));
    if (fs.existsSync(p)) return p;
  }
  return null;
}
export function main(argv) {
  const args = [...argv];
  let placesArg = null;
  const pi = args.indexOf("--places");
  if (pi >= 0) { placesArg = args[pi + 1] ?? null; args.splice(pi, 2); }
  if (args.length !== 2 || (pi >= 0 && !placesArg)) {
    process.stderr.write("usage: node tldr/check.mjs <digest.json> <brief.json> [--places <path>]\n");
    process.exitCode = 2;
    return;
  }
  const lines = [];
  const d = readJson(args[0], "digest"), b = readJson(args[1], "brief");
  if (d.err) lines.push(d.err);
  if (b.err) lines.push(b.err);
  const placesPath = placesArg ?? defaultPlacesPath();
  let known = null;
  if (!placesPath) lines.push("places: read: no places.json found beside tldr/ or in data/; pass --places");
  else {
    const p = readJson(placesPath, "places");
    if (p.err) lines.push(p.err); else known = knownNamesFrom(p.value);
  }
  // Without the known-name list rule 4a cannot run, so fail closed rather than check less.
  if (!lines.length) lines.push(...check(d.value, b.value, known));
  if (lines.length) { process.stdout.write(lines.join("\n") + "\n"); process.exitCode = 1; }
  else process.stdout.write("OK\n");
}
const isMain = (() => { try { return import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href; } catch { return false; } })();
if (isMain) main(process.argv.slice(2));
