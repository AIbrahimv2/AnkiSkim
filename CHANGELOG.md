# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- **Skim**, a card browser for Anki that moves as fast as you can press `j`.
  Search with Anki's own syntax, then move through the cards with vim keys:
  `j`/`k`, counts (`10j`, `25G`), `gg`/`G`, `Ctrl-d`/`Ctrl-u`, and `h`/`l` or
  Space for the front and back. Cards look the way they do when you review
  them.
- **Instant moves.** The next cards are drawn ahead of time, so moving to one
  takes about one screen refresh (Anki's own preview waits at least 300 ms).
- **Follows Stepwise.** Press `b` (or `p`) on a topic in Stepwise to see its cards;
  while Skim is open, moving through topics in Stepwise shows each one's
  cards, and `p` in Skim goes back.
- A list of the cards beside the card, with each one's type, state
  (new, learning, review, suspended, buried) and flag.
- `e` or `B` opens the card in Anki's browser to edit it (`B`, as in
  Stepwise); `r` plays its audio.
- Settings for the side shown first, playing audio by itself, the first
  search and the keyboard shortcut (Cmd/Ctrl+Shift+B), in the window.
