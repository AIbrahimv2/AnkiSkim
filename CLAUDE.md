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
- **Editing (`e`)** is `web/src/edit/`: `vim.ts` (keys to commands) and
  `text.ts` (motions over a field's text) are pure and tested; `flat.ts`
  reads a field's HTML as that text and maps places back; `editor.ts` runs
  commands through `execCommand`, so the browser's undo holds every change;
  `session.ts` is the panel and saving. Typing never goes through Python:
  a save sends only the fields that changed (`src/notes.py`), through
  Anki's `update_note`.
- **Stepwise** opens and follows Skim through `aqt.mw.skim` (`src/api.py`),
  and tells it about pins and statuses through `set_context`. Keep that API
  backwards compatible (Stepwise checks `VERSION`).
- **Now or wait:** `src/tags.py` reads a card's tags against the topic (units,
  the tags pane, the verdict). `tests/test_tags.py` pins down its rules; the
  unit names map resources' chapters onto organ systems, so new resources may
  need a pattern there.
- **Shared kit:** `src/kit/` and `web/src/kit/` are copies of `../anki-addon-kit` (the
  theme, the controls, the Settings / What's new / About dialog and the
  notice after updates). Don't edit them here: change the kit and run its
  `sync.py`; `build.sh` warns when they're behind. `build.sh` puts
  `CHANGELOG.md` in the package, where What's new shows it to users, so
  write it in their terms. Every change users will notice gets a line
  under `## [Unreleased]` in the session that makes it: that's what the
  next release is cut from. The release skill's `release_status.py` shows
  what's waiting in every add-on.
- **Tests:** `./tests/run.sh` (Anki's Python, a made-up collection) and
  `cd web && npm test` (the vim keys).
- **Building:** `./build.sh` builds the page into `src/web/` and the package
  into `dist/skim.ankiaddon`.
- **Trying the page:** `tools/devserver.py` serves it against a copy of a
  collection, with Anki's own reviewer files. The README has the commands.
