# Notes for agents

Skim is one of AIbrahimv2's Anki add-ons: a fast card browser with vim keys.
It isn't on AnkiWeb yet.

To release it, publish it, or edit its AnkiWeb listing, follow the
`anki-addon-release` skill. It covers all of the user's add-ons: the
changelog, building and checking the package, the GitHub release, AnkiWeb, the
listing and AnkiWeb search.

- **On the user's Mac** it loads by itself, from
  `~/.claude/skills/anki-addon-release`.
- **Anywhere else**, such as a cloud session, read it first:
  https://github.com/AIbrahimv2/AnkiStepwise/tree/main/.claude/skills/anki-addon-release

This repo:

- **Speed comes first.** Moving between cards never goes through Python or
  React: the page (plain DOM, `web/src/app.ts`, `list.ts`, `stage.ts`) handles
  the keys and swaps between card frames drawn ahead of time. Keep it that
  way; `tools/bench_display.py` times the approaches.
- **Stepwise** opens and follows Skim through `aqt.mw.skim` (`src/api.py`).
  Keep that API backwards compatible.
- **Looks:** the shared styles and React controls are copied from Stepwise
  (`web/src/styles.css`, `web/src/chrome/ui.tsx`); change both together.
- **Tests:** `./tests/run.sh` (Anki's Python, a made-up collection) and
  `cd web && npm test` (the vim keys).
- **Building:** `./build.sh` builds the page into `src/web/` and the package
  into `dist/skim.ankiaddon`.
- **Trying the page:** `tools/devserver.py` serves it against a copy of a
  collection, with Anki's own reviewer files. The README has the commands.
