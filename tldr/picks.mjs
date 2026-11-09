// tldr/picks.mjs
// The brief the page reads: the checked brief plus the Best each mode's digest named, as {id, ymd}, and picks.at, when the
// digest read its forecast, so the page can compare its live Best with the TLDR's and say when the forecast moved (Scott,
// 2026-11-08). The picks come from the digest, never from the writer. A mode whose digest named no Best gets null, and the page compares nothing for it.
//   node tldr/picks.mjs <brief.json> <digest.json>    prints the published brief
import fs from "node:fs";
import { pathToFileURL } from "node:url";

export function withPicks(brief, digest) {
  const one = (p) => (p && typeof p.id === "string" && typeof p.ymd === "string" ? { id: p.id, ymd: p.ymd } : null);
  return { ...brief, picks: { at: digest?.at ?? null, ski: one(digest?.picks?.ski?.best_day), hike: one(digest?.picks?.hike?.best_day) } };
}

const isMain = (() => { try { return import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href; } catch { return false; } })();
if (isMain) {
  const [briefPath, digestPath] = process.argv.slice(2);
  if (!briefPath || !digestPath) { process.stderr.write("usage: node tldr/picks.mjs <brief.json> <digest.json>\n"); process.exit(2); }
  const read = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
  process.stdout.write(JSON.stringify(withPicks(read(briefPath), read(digestPath)), null, 2) + "\n");
}
