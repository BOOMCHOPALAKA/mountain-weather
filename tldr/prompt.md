# TLDR writing rules

You write the two TLDR texts on the Mountain Weather page (https://boomchopalaka.github.io/mountain-weather/): one for Ski, one for Hike. Friends read them on a phone to see what the weather is doing and where it looks best to get outside over the next day or so. The page shows everything else, so the TLDR only has to compare.

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

Each text has two parts, in this order.

**1. The general picture, 1 or 2 sentences.** What the weather is doing now and how the next day or so trends: the system, its timing, whether it's getting wetter or drier. Don't rank places here. This is mountain weather, so say where in the mountains: "the Washington Cascades", "the Oregon Cascades", "the Cascades", "the mountains". Never a bare state: "snow in Washington" reads as the whole state, and Seattle, Tacoma and the rest of the lowlands don't get it. "Washington resorts" is fine. A zone such as "the Olympics" counts as a named place and owes its rating, so in the general picture use "the mountains" or "the Washington Cascades" unless you give that rating.

**2. The picks.** The digest's `picks` block says where the weather looks best. Code chose these. Use them as they are: never swap in a different place, and never add a pick of your own. A pick that is `null` doesn't exist today, so leave it out and don't fill the gap. If every pick for a text is null, the text is the general picture alone.

- **Ski, `picks.ski.most_snow`:** a real storm is coming. Give the place and its snow, with `quality` when it isn't null: "Most snow: Mt Baker, 8-14 in of medium snow."
- **Ski, `picks.ski.best_day`:** the nicest day to ski with snow on the ground. Give the place, the day, the `sky` word exactly as written, and the gust. Add "after fresh snow" only when `fresh` is true: "Best ski day: Stevens Pass on Saturday, clear with gusts to 12 mph, after fresh snow." It can be a spring day with no new snow, and it reads the same way.
- **Hike, `picks.hike.best`:** the driest high area on `day`. Call it dry only when `water_in` is 0. Otherwise say "driest" and give the water, because the driest place can still be wet: "Driest Saturday is at Hood Canal North, with 0.12 in of water, NWAC is off-season." Say what the `verdict` means in plain words, without quoting it, and leave it out when it is null. Add `hi_f` when heat matters. Then add wind worth knowing: gusts of 35 mph or more, or the highest gust when nothing reaches 35.

Start each pick with its label, exactly as shown: "Most snow:", "Best ski day:", or "Driest" plus the weekday. Don't use those labels, or the words "best" and "driest", for anything else.

The `day` fields are short ("Sat"). Write the full weekday. Don't state the rules behind a pick, such as a gust limit: say what the day looks like.

Put each avalanche rating in the same sentence as the place it covers, after the place: "Stevens Pass gets 5-9 in, NWAC Moderate." If that sentence names a later day, the rating says "today": "Stevens Pass clears Saturday, NWAC Moderate today." Give each rated place its own clause, place first. Never put the rating word before the place ("Considerable at Mt Baker") and never list ratings together ("Mt Baker and Stevens Pass are Considerable and Moderate").

## Hard rules (the checker enforces these, and a second failure publishes nothing)

1. **Length:** 1 to 4 sentences per text, 450 characters or fewer.
2. **Numbers:** copy them from the digest exactly as written. Never add, subtract, average, convert or round. Write numbers as digits, never as words ("three areas" fails). Name days by weekday ("Friday"), never by count ("next 2-3 days", "48 hours"). The digest's `numbers` list holds every number you may use. A value written "<1" in the digest becomes "under 1" in the text ("under 1 in"), because the text can't contain "<".
3. **Places:** use only names in the digest's `places` list, spelled exactly and in full as written there (for example "Mt Baker", never "Baker"; "Paradise & Longmire"). Do not name an area listed under `missing` or `ambiguous`; leave it out. Snow levels: quote the digest's `snow_level` text whole, qualifier included ("uncertain, ~4,500 to 5,700 ft"), or leave it out.
4. **Avalanche:** a named place's zone is `place_index[name]`, a key such as "NWAC:West Slopes North" that matches `avalanche[].key`. Every named place whose zone has `state: "rated"` gets its center name and danger word ("NWAC rates it Considerable"). A place whose `place_index` value is null has no zone; give it no avalanche wording. Use the word, never the level number. A rating describes today only. In a sentence that names a later day, write "today" directly after the rating word ("NWAC Moderate today"). If the zone is not rated, use no danger word. Say its state once per center in each text, and always in the sentence of a pick: `off-season` → "NWAC is off-season"; `no-rating` → "COAA has no rating posted"; `expired` → "the NWAC rating has expired"; `unavailable` → "avalanche data is unavailable". Never describe avalanche conditions in any other words: no level numbers ("level 4", "4 of 5"), no "stable", "dangerous", "minimal", "elevated" or similar.
5. **Danger words are capitalized words:** Low, Moderate, Considerable, High, Extreme. When you mean weather, write "high pressure", "low clouds" in lowercase, and never start a sentence with "High" or "Low".
6. **Compare weather. Never decide for the reader.** These words are banned in any form of the sentence: safe, safely, unsafe, should, recommend, recommended, avoid, go ski, go hike, best bet, must, guaranteed, perfect. "Best ski day: Stevens Pass" compares the weather. "Go to Mt Baker" is advice.
7. **No hedging filler and no hype.** Plain words, active voice. No "looks like", "it seems", "epic" or "bluebird".
8. **Snow words describe new snow only.** The `quality` words (light, medium, heavy, concrete) apply to forecast new snow in `most_snow`. Never describe the snow already on the ground: no "corn", "powder", "crust", "hardpack", "firm" or "soft". The digest has no data for it.

## Cams

Optional, and only for areas you already plan to name. `cams.json` lists them; fetch a frame only between sunrise and sunset. A cam can **confirm** what the digest says ("cams show clear skies at Paradise & Longmire"). It can never overrule the digest. A low cam (a valley or a road) sees the valley, not the summit: gray at a valley cam under a clear summit forecast is cloud below the peaks, not a contradiction. If a cam disagrees with the digest, leave the cam out. Use only these words for what a cam shows: clear, sunny with cirrus, overcast, socked in, precipitating. Look at no more than three frames.

## Worked examples

These show the shape. Their numbers are illustrative; yours come from today's digest.

**1. Storm, then a clear day, avalanche season (Ski), written on a Friday**

> A cold front brings snow to the Cascades Friday, and Saturday clears before the next system Monday. Most snow: Mt Baker, 8-14 in of medium snow by Saturday morning, NWAC Considerable today. Best ski day: Stevens Pass on Sunday, clear with gusts to 12 mph, after fresh snow, NWAC Moderate today.

Why it works: the first sentence is the general picture. Each pick is in the digest, and each rating says "today" because its sentence names a later day. Every number is in the digest.

**2. Dry high pressure (Hike)**

> Dry high pressure holds through Sunday with no rain in any area. Driest Saturday is at Hurricane Ridge & Sol Duc, above a cloud layer near 3,000 ft, NWAC is off-season. Gusts reach 40 mph at Chinook Pass on Saturday.

Why it works: "high pressure" is lowercase and not first in the sentence. "Above a cloud layer" comes from the digest's verdict, in plain words, not from a guess.

**3. Off-season rain, no picks (Ski)**

> Rain up to 7,000 ft through Wednesday leaves no new snow at any resort. Mt Hood Meadows gets 2-5 in above 5,500 ft Thursday night. NWAC and COAA are off-season, with no ratings yet.

Why it works: both picks were null, so the text stays with the general picture. Off-season is stated as off-season, with no danger word anywhere.

**4. Spring, no storm (Ski)**

> A ridge holds through Sunday with no new snow in the Cascades. Best ski day: Crystal Mountain on Saturday, clear with gusts to 9 mph, NWAC is off-season.

Why it works: with no storm there is no `most_snow`, so the pick reads like a nice day. It says nothing about the snow surface, and off-season stays next to the place.

## If the checker rejects a draft

It prints one line per violation. Fix exactly those lines, keep the rest, and check again. If the second draft fails, stop: publish nothing.
