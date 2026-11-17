# Skim

Open Skim from **Tools → Skim** (Cmd/Ctrl+Shift+B). Settings are edited in the
window itself: **⋯ → Settings…** (Anki's Config button for this add-on opens
it too). The keys below are what it saves, for reference.

- `shortcut` — keyboard shortcut for the Tools menu entry (empty to disable).
  During a review it opens Skim on today's review, at the card you're on.
- `default_search` — what Skim shows the first time you open it, in Anki's
  search syntax (default `deck:current`). After that it reopens on your last
  search.
- `start_side` — which side of each card to show: `"answer"` (default, which
  for most note types includes the question too) or `"question"`. `h` and `l`
  switch sides while you browse.
- `autoplay_audio` — play a card's audio when it comes up (default `false`).
  `r` plays it whenever you want.
- `wait_below_percent` — when you're looking at a topic (from Stepwise, or a
  `tag:` search), a suspended card is marked **Wait** if less than this share
  of the places it's tagged in (in your pinned resources and the one you're on)
  is in this topic's unit, and a system you haven't done also has it. Default
  `50`.
- `system_done_percent` — a system counts as done (green under **Again in**,
  and no reason to wait for it) once at least this share of its topics in
  your pinned Stepwise resources is done, so a block you've finished shows
  as done on every card even though you never marked every topic in it.
  Hover a system to see how much of it is done. Default `50`; `100` means
  only when every topic is.
