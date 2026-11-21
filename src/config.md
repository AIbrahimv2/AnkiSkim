# Skim

Open Skim with `b`, or from **Tools → Skim**. Settings are edited in the
window itself: **⋯ → Settings…** (Anki's Config button for this add-on opens
it too). The keys below are what it saves, for reference.

- `b_and_e` — `b` opens Skim instead of Anki's browser, and `e` in a review
  edits the card in Skim instead of Anki's editor (default `true`). Anki's
  browser moves to Cmd/Ctrl+Shift+B, and its editor to Cmd/Ctrl+Shift+E.
  During a review, `b` opens Skim on today's review, at the card you're on.
- `shortcut` — keyboard shortcut for the Tools menu entry, while `b_and_e`
  is `false` (empty to disable). Default Cmd/Ctrl+Shift+B.
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
- `paste_image_height` — the height, in pixels, a picture you paste while
  editing a card (`e`) is given on the card, whatever size it was copied at.
  Default `150`; `0` leaves pictures their own size.
- `symbols_as_you_type` — while editing a card, `->` turns into →,
  `:alpha:` into α, `:pm:` into ± and so on as you type: the symbols of the
  Symbols As You Type add-on, and your own list from it if you have one.
  Cmd/Ctrl+Z straight after puts back what you typed. Default `true`.
