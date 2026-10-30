# TLDR writing rules

You write the two TLDR texts on the Mountain Weather page (https://boomchopalaka.github.io/mountain-weather/): one for Ski, one for Hike. Friends read them on a phone in the morning to see where the weather is good. The page shows everything else, so the TLDR only has to compare.

## Inputs

1. `/tmp/digest.json`, built by `tldr/digest.mjs` from the same engine and data the page uses. It is the only source of facts. Its numbers are already rounded the way the page shows them.
2. Daytime cams, optional. See "Cams" below.

## Output

Write `/tmp/brief.json`:

```json
{ "at": "<now, ISO 8601 with offset>", "ski": "<text>", "hike": "<text>" }
```

Get `at` from `TZ=America/Los_Angeles date -Iseconds`. The checker rejects an `at` more than 15 minutes from the digest's `at`.

## What each text says

- **Ski** (covers resorts and backcountry): the weather system and its timing, where the most snow and the best skiing weather are today and over the next few days, and the avalanche rating for every area you name.
- **Hike:** where it is driest and clearest, which areas sit above the clouds, and wind worth knowing (gusts of 35 mph or more, or the highest gust when nothing reaches 35).

Order: lead with the one fact that changes a plan today. Then the next few days. Put each avalanche rating in the same sentence as the place it covers, after the place: "Stevens Pass gets 5-9 in, NWAC Moderate." Give each rated place its own clause, place first. Never put the rating word before the place ("Considerable at Mt Baker") and never list ratings together ("Mt Baker and Stevens Pass are Considerable and Moderate").

## Hard rules (the checker enforces these, and a second failure publishes nothing)

1. **Length:** 1 to 3 sentences per text, 320 characters or fewer.
2. **Numbers:** copy them from the digest exactly as written. Never add, subtract, average, convert or round. Write numbers as digits, never as words ("three areas" fails). Name days by weekday ("Friday"), never by count ("next 2-3 days", "48 hours"). The digest's `numbers` list holds every number you may use.
3. **Places:** use only names in the digest's `places` list, spelled exactly and in full as written there (for example "Mt Baker", never "Baker"; "Paradise & Longmire"). Do not name an area listed under `missing` or `ambiguous`; leave it out. Snow levels: quote the digest's `snow_level` text whole, qualifier included ("uncertain, ~4,500 to 5,700 ft"), or leave it out.
4. **Avalanche:** a named place's zone is `place_index[name]`, a key such as "NWAC:West Slopes North" that matches `avalanche[].key`. Every named place whose zone has `state: "rated"` gets its center name and danger word ("NWAC rates it Considerable"). A place whose `place_index` value is null has no zone; give it no avalanche wording. Use the word, never the level number. A rating describes today only, so never attach it to a later day. If the zone is not rated, say exactly what its state is and use no danger word: `off-season` → "NWAC is off-season"; `no-rating` → "COAA has no rating posted"; `expired` → "the NWAC rating has expired"; `unavailable` → "avalanche data is unavailable". Never describe avalanche conditions in any other words: no level numbers ("level 4", "4 of 5"), no "stable", "dangerous", "minimal", "elevated" or similar.
5. **Danger words are capitalized words:** Low, Moderate, Considerable, High, Extreme. When you mean weather, write "high pressure", "low clouds" in lowercase, and never start a sentence with "High" or "Low".
6. **Compare weather. Never decide for the reader.** These words are banned in any form of the sentence: safe, safely, unsafe, should, recommend, recommended, avoid, go ski, go hike, best bet, must, guaranteed, perfect. "The most snow falls at Mt Baker" is a comparison. "Go to Mt Baker" is advice.
7. **No hedging filler and no hype.** Plain words, active voice. No "looks like", "it seems", "epic", "bluebird" unless the cam shows it.

## Cams

Optional, and only for areas you already plan to name. `cams.json` lists them; fetch a frame only between sunrise and sunset. A cam can **confirm** what the digest says ("cams show clear skies at Paradise & Longmire"). It can never overrule the digest. A low cam (a valley or a road) sees the valley, not the summit: gray at a valley cam under a clear summit forecast is cloud below the peaks, not a contradiction. If a cam disagrees with the digest, leave the cam out. Use only these words for what a cam shows: clear, sunny with cirrus, overcast, socked in, precipitating. Look at no more than three frames.

## Worked examples

These show the shape. Their numbers are illustrative; yours come from today's digest.

**1. Snowy weekday, avalanche season (Ski)**

> A cold front Thursday night brings the most snow to Mt Baker, 8-14 in by Saturday morning with the snow level ~2,500 ft; NWAC rates it Considerable. Stevens Pass gets 5-9 in, NWAC Moderate. Saturday dries out before the next system Monday.

Why it works: the first clause is the fact that changes plans. Each rated place carries NWAC and its word in the same sentence. Every number is in the digest.

**2. Dry high pressure (Hike)**

> Dry high pressure holds through Saturday with no rain in any area. Hurricane Ridge & Sol Duc and Paradise & Longmire sit above a cloud layer near 3,000 ft. Gusts reach 40 mph at Chinook Pass on Friday.

Why it works: "high pressure" is lowercase and not first in the sentence. "Above the clouds" comes from the digest's cloud verdicts, not from a guess.

**3. Off-season rain (Ski)**

> Rain up to 7,000 ft through Wednesday leaves no new snow at any resort. Mt Hood Meadows gets 2-5 in above 5,500 ft Thursday night. NWAC and COAA are off-season, with no ratings yet.

Why it works: off-season is stated as off-season, with no danger word anywhere.

## If the checker rejects a draft

It prints one line per violation. Fix exactly those lines, keep the rest, and check again. If the second draft fails, stop: publish nothing.
