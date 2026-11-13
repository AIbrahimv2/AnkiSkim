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
- **Laid out like Anki's browser:** the card table on the left, the card and
  where it lives on the right.
- **Columns to decide by:** state, AnKing yield, question banks (UWorld,
  AMBOSS, NBME), the other systems a card comes up in ("Again in", coloured by
  your Stepwise progress) and a verdict. Click a column to sort by it.
- **Now or wait.** On a topic, each suspended card says whether to unsuspend
  it now or wait for the system it mostly belongs to, and why ("43% here;
  comes up again in Endocrine, Repro"), from where it's tagged in your pinned
  resources. The threshold is a setting.
- **Filters** (All, Suspended, Now, Wait, Your call, High yield, Q-bank) with
  counts; `f` and `F` go through them.
- **From a review:** Cmd/Ctrl+Shift+B while reviewing opens Skim on today's
  review of the deck (cards studied so far, the one on screen, then the ones
  still to come), at the card you're on and on the side the reviewer shows.
  Cards still to come keep their answers hidden in the list. Skim follows the
  review while it stays open, flipping when you do; `p` goes back to it.
- **Where this card lives:** its tags by resource, the one you're on and your
  pinned ones first, with Stepwise's status and the other systems marked; the
  rest folded away.
