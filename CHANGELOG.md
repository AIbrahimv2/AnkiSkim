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
- A list of the cards beside the card, with each one's type, deck, state
  (new, learning, review, suspended, buried) and flag. A card in a filtered
  deck shows its home deck too, and you can sort by deck.
- `e` or `B` opens the card in Anki's browser to edit it (`B`, as in
  Stepwise); `r` plays its audio.
- **Select and suspend.** `v` selects cards as you move (`v`, then `G`,
  selects to the end), and so do Shift+↓/↑ and Shift-click. Cmd+J (Ctrl+J)
  suspends the selected cards, or the one you're on, or unsuspends them if
  they all are, as Anki's browser does; Edit → Undo in Anki takes it back.
- **The keys you press show on screen**, in a frosted pill over the table's
  corner, and fade once you stop, so a screen recording shows what was
  pressed: a short trail of quick presses (`1 0 j`), a key pressed again with
  a count (`j ×5`), and a number typed before a move until it's used.
- Settings for the side shown first, playing audio by itself, the first
  search and the keyboard shortcut (Cmd/Ctrl+Shift+B), in ⋯ → Settings….
  ⌘S saves them (Ctrl+S on Windows and Linux).
- On a Mac, ⌘, opens Skim's settings while its window is in front, instead
  of Anki's Preferences. Anywhere else it still opens Anki's.
- **Laid out like Anki's browser:** the card table on the left, the card and
  where it lives on the right.
- **Columns to decide by:** state, AnKing yield, question banks (UWorld,
  AMBOSS, NBME), the other systems a card comes up in ("Again in", coloured by
  your Stepwise progress) and a verdict. Click a column to sort by it. The
  Verdict column shows only on a topic with suspended cards; elsewhere,
  Again in gets its room. Again in lists the systems you haven't done
  first, and any that don't fit go in a "+2" that names them when you
  hover it.
- **Now or wait.** On a topic, each suspended card says whether to unsuspend
  it now or wait for the system it mostly belongs to, and why ("43% here;
  comes up again in Endocrine, Repro"), from where it's tagged in your pinned
  resources. The threshold is a setting.
- **Blocks you've finished show as done.** Once half of a system's topics in
  your pinned resources are done, it shows green under "Again in" on every
  card, and no card waits for it any more, even where a card is also tagged
  in a topic you never marked. A system you haven't started stays grey,
  except on a card whose every topic there you've done. Hover a system to
  see how much of it is done; the share is a setting.
- **Filters** (All, Suspended, Now, Wait, Your call, High yield, Q-bank) with
  counts; `f` and `F` go through them. Skim keeps what it has read about each
  card, so going back to a view, or to any view of cards you've already seen,
  shows its rows and counts at once.
- **From a review:** Cmd/Ctrl+Shift+B while reviewing opens Skim on today's
  review of the deck (cards studied so far, the one on screen, then the ones
  still to come), at the card you're on and on the side the reviewer shows.
  Cards still to come keep their answers hidden in the list. Skim follows the
  review while it stays open, flipping when you do; `p` goes back to it.
- **Views** in a bar over the table: All (your search, or Stepwise's topic),
  This review, and Anki's browser's "Today" searches (Due, Added, Edited,
  Studied, First review, Rescheduled, Again and Overdue), each with its count,
  on the deck you're reviewing or the one selected in Anki. Skim opens on All,
  or on This review during a review. `t` and `T` (or `H` and `L`, left and
  right) go through them, and the bar moves the moment you press them, with
  placeholder rows until the cards are in.
- **Where this card lives:** its tags by resource, the one you're on and your
  pinned ones first, with Stepwise's status and the other systems marked; then
  its other tags, with readable names, folded away only when there are too
  many to fit. They spread into columns when there's room.
- **Settings, What's new and About share one window**, a tab each: Settings;
  What's new (this list of changes, with the ones since you last looked marked
  New); and About (links to the code and to report a problem, whether AnkiWeb
  has an update, AIbrahimv2's other Anki add-ons with an Install button, and a
  signature that opens AIbrahimv2's website).
  Open them from ⋯ → Settings…, What's new or About. A dot on ⋯ says there's
  an update you haven't read about.
- **One notice after updates.** When any of AIbrahimv2's add-ons is updated, a
  card at the bottom of Anki's main window says so once, with a link to
  what's new.
- **Liquid Glass with AnkiGlass.** On a Mac with AnkiGlass installed, Skim's
  window and its Settings, What's new and About window get the same glass
  as Anki's main window. The card is glass too, the way it is in review,
  while AnkiGlass's **Glass behind the card** is on. **Glass on add-on
  windows** in AnkiGlass's Settings turns it all off.
