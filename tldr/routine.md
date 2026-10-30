# Mountain Weather TLDR run

This is the instruction set for a scheduled Claude Code run. The Mountain Weather page (https://boomchopalaka.github.io/mountain-weather/) is a static GitHub Pages site. Twice a day this run writes the two short TLDR texts (Ski and Hike) and publishes them as `brief.json` at the repo root on `main`. The working directory is a clone of that repo. Nobody reviews each run, so follow the steps exactly and stop when a step says stop.

1. Run `TZ=America/Los_Angeles date` and note the time. Then run `node tldr/digest.mjs --root . --out /tmp/digest.json`. If the digest command exits non-zero, stop. Publish nothing and report the error.
2. Read `tldr/prompt.md` in full, then read `/tmp/digest.json`. The digest is the only source of facts. Optionally look at up to three daytime cams, as the Cams section of `tldr/prompt.md` describes.
3. Write `/tmp/brief.json` as `tldr/prompt.md` describes: `at`, `ski`, `hike`. Get `at` from `TZ=America/Los_Angeles date -Iseconds`.
4. Run `node tldr/check.mjs /tmp/digest.json /tmp/brief.json`. If it prints `OK`, go to step 5. If it prints violations, rewrite `/tmp/brief.json` once, fixing exactly the listed violations, then run the check again. If the second check fails, stop. Publish nothing and report the violations.
5. Run `bash tldr/publish.sh /tmp/brief.json /tmp/digest.json`. This script checks the brief again, commits `brief.json` only, and pushes to `main`. That is the only push this run makes. Do not create a branch, do not open a pull request, and do not push anything else. If the script exits non-zero, report its output and stop.
6. Do not edit, commit or push any other file in the repo, ever, even if something looks broken. Report it in your final message instead.
7. End with a short report: the Ski text, the Hike text, the check result (`OK` or the violations), and whether publish pushed, said "no change", or failed.
