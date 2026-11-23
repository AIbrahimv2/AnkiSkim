# Skim

**A card browser for Anki that keeps up with your keys, and helps you decide
what to unsuspend.** Search with Anki's own syntax, then move through the
cards with vim keys. Each card looks the way it does when you review it, and
the next ones are drawn before you get there, so moving is instant. On a
topic, each suspended card says whether to unsuspend it now or wait for the
system it mostly belongs to, and why.

It pairs with [Stepwise](https://github.com/AIbrahimv2/AnkiStepwise): press
`b` on a topic there to see its cards here, and Skim follows as you move
through topics.

<img src="docs/screenshot.png" width="100%" alt="Two Skim windows side by side. Left: a B&amp;B topic's cards in a table with their state, retrievability, yield, question banks and verdicts, beside the card on screen and its tags by system and by step. Right: the same card open in the editor, its fields beside the card, with a diagram of dynein and kinesin">

<sub>Shown with [AnkiGlass](https://github.com/AIbrahimv2/AnkiGlass), which gives Anki's windows, Skim's included, macOS Liquid Glass.</sub>

## Features

- **Instant moves.** While you read a card, Skim draws the next ones (and the
  other side of this one) in the background. Pressing `j` then only swaps
  which one shows: about one screen refresh. Anki's own preview redraws on
  every move and waits at least 300 ms between them.
- **Cards as you review them.** Each card is drawn in a copy of Anki's
  reviewer page, with its note type's styling and scripts, images, MathJax and
  play buttons.
- **Vim keys.** `j`/`k` to move, a number first to move that many (`10j`),
  `gg`/`G` and `25G` to jump, `Ctrl-d`/`Ctrl-u` for half a page, `h`/`l` or
  Space for the front and back, `/` to search. Arrow keys, Home and End work
  too.
- **Laid out like Anki's browser.** A table of the cards on the left, the card
  on the right, and where it lives under it. Drag the edge between the table
  and the card, or between the card and its tags, to resize them
  (double-click one to reset it, or choose **⋯ → Reset layout** for all of
  it). A narrow table drops the columns it has least room for (Deck first,
  then Again in, Q-bank and Yield, then any scheduling columns you've
  turned on), so the card can take most of the window.
  Click a row to jump there.
- **Columns that help you decide.** The note's text with clozes filled in, its
  deck (for a card in a filtered deck, its home deck in brackets; hover for
  the full name), its state (new, learning, review, suspended, buried),
  its retrievability (with FSRS: the chance you'd recall it now, orange
  below the retention it's scheduled for),
  AnKing's yield tag (with signal bars: four for High down to one for Low),
  the UWorld, AMBOSS and NBME questions tagged on it, the other systems it
  comes up in ("Again in", coloured by what you've done in Stepwise), and a
  verdict.
  Click a column's title to sort by it (again to reverse it). Blanks, like
  a new card's retrievability, stay at the bottom either way.
- **Pick your columns.** Right-click the column titles, or choose
  **⋯ → Columns…**, to turn columns on and off. Besides those above there's
  Due ("in 5d", "today", "3d late" in orange), Interval, Difficulty,
  Stability, Reviews and Lapses; without FSRS, Ease takes the place of
  Retrievability, Difficulty and Stability. Drag a column's title left or
  right to move it (# stays first). Your columns and their order are kept
  for next time; **Default columns** brings back the ones Skim starts with
  (Deck, State, Retrievability, Yield, Q-bank, Again in and Verdict), in
  that order.
- **Now or wait.** On a topic (from Stepwise, or a `tag:` search), each
  suspended card gets a verdict. Its places in your pinned resources (and the
  one you're on) are sorted by system: if at least half are in this topic's
  system, unsuspend it now; if not, and a system you haven't started also has
  it, it could wait, since you'll meet it there. High-yield cards that would
  wait are "Your Call", and a card tagged here only as `::Extra` leans to
  waiting. The tags under the card show why: their places by system, under a
  bar of how many of your resources put the card in each. The threshold is a
  setting.
- **Filters.** All, Suspended, Now, Wait, Your Call, High Yield and Q-bank, each
  with its count. Click one, or press `f` / `F` to go through them.
- **Where this card lives.** Under the card, its verdict, then its places
  (in your pinned resources and the one you're on) by system: the topic's
  first, then the systems you haven't done, then the ones you have, so you
  can see where you'll meet the card again. When there's more than one
  system, a bar over them shows how many resources put the card in each,
  named, the topic's in blue and the others in Stepwise's colours (done,
  queued, saved for later) or grey. Each place shows its resource, with its logo where it
  has one, and the end of its path, with a check once it's done in Stepwise;
  hover for the whole tag. The yield (with its bars) and question banks are
  pills. Its other tags (other resources, AnKing's own) follow with readable
  names, and fold into "Show more" only when they don't fit; a card can have
  60 of them. The systems spread into columns when the pane is wide. Click
  its title, or press `i`, to hide it and give the card its room.
- **Step 1 or Step 2.** The tags also say which exam a card is for, from the
  resources and the UWorld, AMBOSS and NBME questions it has under each
  step's tags (`#AK_Step1_v12`, `#AK_Step2_v12`). A card tagged for one step
  gets a pill ("Step 1"). A card in both gets a bar of each step's share
  (the mean of its share of the resources and of the questions), and each
  step's resources and questions under it, so a clinical card that came
  along with a Step 1 resource shows as one.
- **Follows Stepwise.** Press `b` (or `p`) on a topic in Stepwise and Skim
  opens on its cards. Leave Skim open and every topic you move to in Stepwise shows its
  cards here, without taking the keys away. `p` in Skim goes back to Stepwise.
  Search for something else in Skim and it stops following.
- **In place of Anki's browser and editor.** `b` opens Skim from anywhere in
  Anki's main window, and `e` in a review edits the card in Skim. Anki's
  browser is still on its toolbar button and moves to Cmd/Ctrl+Shift+B, and
  its editor to Cmd/Ctrl+Shift+E. **b and e open Skim** in Settings gives
  Anki its keys back.
- **From a review.** Press `b` while reviewing and Skim opens on
  today's review of the deck: the cards you've studied so far, in the order
  you answered them, the card on screen (where it starts), then the cards
  still to come, in the order Anki will show them. It shows the side the
  reviewer is on: the front until you've shown the answer, then the back. The
  list doesn't give away answers you haven't seen: a card still to come shows
  its front, with its cloze as `[...]` (or its hint). Leave Skim open and it
  follows the review, flipping when you do; `p` goes back to the review.
  Press `e` instead and the card opens in Skim's editor; `q` saves it and
  closes Skim, back to the review.
- **Views.** A bar over the table switches between All (your search, or
  Stepwise's topic), This review and Anki's browser's "Today" searches: Due,
  Added, Edited, Studied, First review, Rescheduled, Again and Overdue, each
  with its count. They're on the deck you're reviewing, or else the one
  selected in Anki. Click one or press `t` / `T` (or `H` / `L`). Skim opens on
  All, or on This review during a review. While it follows a review it keeps
  the view you picked (studied cards in the order you studied them).
- **Edit where you are.** `e` turns the card you're on into its note's
  fields, in place of the table, with the card still beside them showing
  what you change. The fields edit like vim: `i` to type and `Esc` to stop,
  `w` `b` `e` `f` to move, `dw` `ciw` `dd` `p` `u` `.` and the rest, `v` to
  select. Clozes have keys of their own: `gciw` makes one of a word, `cic`
  changes a cloze's answer, `gx` takes one off. Nothing to save: what you
  change is written as you go, through Anki, so Edit → Undo takes it back.
  `J` and `K` go on to the next note, and `q` goes back to the table.
- **Or in Anki's browser.** `B` opens the card there, with the same search,
  for what Skim doesn't edit (tags, the deck, the note type).
- **Follows Anki's light and dark themes**, and looks like Stepwise.

## Usage

1. Press `b` in Anki's main window (or choose **Tools → Skim**), or press
   `b` on a topic in Stepwise. During a review, `b` opens Skim on today's
   review, at the card you're on, and `e` opens that card in Skim's editor.
2. Press `/`, type a search the way you would in Anki's browser
   (`tag:Cardio`, `deck:current is:suspended`, `heart`), and press Enter.
3. Move with `j` and `k`. `l` shows the back, `h` the front.

### Keys

| Keys | Does |
| --- | --- |
| `j` / `k` | Next / previous card (arrow keys too) |
| `10j` / `8k` | Move that many cards |
| `gg` / `G` | First / last card |
| `25G` or `25gg` | Card 25 |
| `Ctrl-d` / `Ctrl-u` | Half a page down / up; a number first sets how far, from then on |
| `Ctrl-f` / `Ctrl-b` | A page down / up (Page Down / Page Up too) |
| `h` / `l` | Show the front / the back |
| `Space` | Flip the card |
| `J` / `K` | Scroll a long card down / up |
| `i` | Hide or show the tags under the card |
| `v` | Select cards as you move (`j`, `k`, `10j`, `G`, ...); `v` or `Esc` stops |
| `Shift-↓` / `Shift-↑` | Select as you move, as in Anki's browser (Shift-click too) |
| `Cmd-J` (`Ctrl-J`) | Suspend the selected cards, or the one you're on; unsuspend them if they all are |
| `f` / `F` | Next / previous filter |
| `t` / `T` | Next / previous view (All, This review, Due, Studied, ...) |
| `H` / `L` | The view to the left / right |
| `/` | Search; Enter runs it, Esc goes back to the cards |
| `e` | Edit the card (see below) |
| `B` | Open the card in Anki's browser |
| `u` / `Ctrl-r` | Undo / redo what was done last (an edit, a suspend), as Anki's Edit menu does |
| `r` | Play the card's audio |
| `p` | Back to the window that opened Skim (Stepwise) |
| `q` or `Esc` | Close Skim (Esc first cancels a number you've typed, or ends a selection) |
| `Cmd-=` / `Cmd--` (`Ctrl` elsewhere) | Make everything in the window bigger / smaller; `Cmd-0` back to 100% |
| `?` | Show these keys |

### Editing a card

`e` on a card shows its note's fields where the table was. You start in
normal mode, on the first field, with a block cursor.

| Keys | Does |
| --- | --- |
| `i` `a` `I` `A` | Type: before / after the cursor, at the line's start / end |
| `o` / `O` | Type on a new line below / above |
| `Esc` | Stop typing |
| `h` `j` `k` `l` | Left, down, up, right; `j` and `k` go on into the next field |
| `w` `b` `e` | Next word, back a word, end of word (`W` `B` `E`: by spaces only) |
| `0` `^` `$` | Start of the line, its first letter, its end |
| `f x` / `t x` | To the next `x` on the line, or just before it (`F` `T` backwards; `;` and `,` repeat) |
| `gg` / `G` | First / last field (`2G`: field 2); `Tab` and `Shift-Tab` step through them |
| `x`, `r x`, `~` | Delete a letter, replace it, switch its case |
| `d` `c` `y` + a move | Delete, change or copy what the move covers: `dw`, `c$`, `yiw`, `dd`, `3dd` |
| `iw` `i(` `i"` `ic` | After `d`, `c`, `y` or `v`: a word, inside brackets or quotes, a cloze's answer (`aw` `a(` `ac`: all of it) |
| `p` / `P` | Paste after / before the cursor: what you yanked, or whatever you've copied since, anywhere on your computer |
| `Cmd-V` | Paste from the clipboard (`Ctrl-V` on Windows and Linux) |
| `v` / `V` | Select letters / lines as you move, then `d`, `c`, `y` |
| `u` / `Ctrl-r` | Undo / redo, in the fields |
| `.` | Do the last change again |
| `gc` + a move, `gC` | Make a cloze of what the move covers, or of what's selected (`gC`: the same number again) |
| `Cmd-Shift-C` | A cloze, as in Anki's editor (with `Alt`: the same number again) |
| `gx` | Take the cloze under the cursor off, keeping its text |
| `Cmd-B` `Cmd-I` `Cmd-U` | Bold, italic, underline |
| `J` / `K` | Next / previous note |
| `Space` | Flip the card beside the fields |
| `gb` | Open the card in Anki's browser |
| `q` or `ZZ` | Done: back to the table |

A number works as in vim (`3w`, `d2w`, `2dd`). `j` and `k` move by the lines
you see, so a long paragraph isn't one step. Pasting takes from your
computer's clipboard: a picture copied in a browser ("Copy image"), a
screenshot or an image file copied in Finder goes into your media folder
and onto the card; text from a web page keeps its bold, lists and tables and
drops the rest of the page's styling. Every picture you paste is given one
height on the card, 150 pixels, with its width to match, however big it was
where you copied it, so it sits with the text rather than pushing it off
the screen. **Height of pasted pictures** in Settings changes it (0
leaves pictures their own size).

Symbols come as you type, as with the
[Symbols As You Type](https://ankiweb.net/shared/info/2040501954) add-on
(which only reaches Anki's own editor): `->` turns into →, `=>` into ⇒,
`:alpha:` into α, `:Delta:` into Δ, `:pm:` into ±, `:deg:` into °,
`:1/2:` into ½, `:leq:` into ≤, and a `--` or `---` on its own into a dash
once you type the space after it. If you use that add-on, Skim types your
list from it, with any symbols you've added. `Cmd-Z` straight after a
symbol puts back what you typed, and a cloze's colons stay colons:
`{{c1::beta::hint}}` comes out as you type it. **Symbols as you type** in
Settings turns it off.

Edits are saved when you stop typing (and a moment after you pause), each
one through Anki itself: only the fields you changed are written, a new
cloze gets its card, and Anki's Edit → Undo takes an edit back: `u` back at
the table does the same, and `Ctrl-r` redoes it. Fields show
their HTML as Anki's editor does, without drawing MathJax.

### Settings

**⋯ → Settings…** in the window (Anki's **Config** button for the add-on
opens the same thing): the side each card opens on (the back, by default,
which for most note types includes the front), playing audio by itself, when
a card could wait (less than half its places in the topic's system, by
default), the height pasted pictures are given, symbols as you type, the window's size, the search
Skim opens on the first time, whether `b` and `e` open Skim, and, if they
don't, Skim's keyboard shortcut.

### For other add-ons

Skim publishes a small API as `aqt.mw.skim` (see [src/api.py](src/api.py)):
`open()` shows a search or a list of card ids, and `follow()` swaps in new
cards while Skim shows yours. Passing card ids skips Anki's search, which
for a tag reads every note. Passing a `topic` says what to read the cards'
tags against, and `set_context()` lets a study planner (Stepwise) say which
resources are pinned and what you've done.

## Installation

From [AnkiWeb](https://ankiweb.net/shared/info/2141626960): in Anki, open
**Tools → Add-ons → Get Add-ons** and paste the code `2141626960`. It needs
Anki 24.04 or newer. Or download `skim.ankiaddon` from the
[latest release](https://github.com/AIbrahimv2/AnkiSkim/releases/latest) and
double-click it.

## Development

The add-on that Anki loads lives in `src/`. To try changes live, link it
into your Anki add-ons folder and restart Anki:

```bash
ln -s "$(pwd)/src" ~/Library/Application\ Support/Anki2/addons21/anki-skim
```

The window's page is TypeScript in `web/`, built with Vite into
`src/web/skim.js` and `skim.css` (committed, so the add-on works straight from
a checkout). The parts you move through (list, card frames, keys) and the
editor (`web/src/edit/`) are plain DOM; the dialogs, menu and toasts are React, with styles and controls copied
from Stepwise. It talks to Python through Anki's `pycmd` bridge
(`src/bridge.py`).

```bash
cd web && npm install
npm run build        # rebuild src/web/ after changing the page
npm test             # the vim keys, for moving and for editing
```

To work on the page with **real cards**, run the dev server with Anki's own
Python. It copies the collection to a temp folder, only reads the media
folder, and loads Anki's reviewer files from the installed app:

```bash
PY=$(ls -d ~/Library/Application\ Support/AnkiProgramFiles/python/*/bin/python3 | tail -1)
"$PY" tools/devserver.py --collection ~/Library/Application\ Support/Anki2/User\ 1/collection.anki2 \
  --media ~/Library/Application\ Support/Anki2/User\ 1/collection.media --search "tag:Cardio"
# then open http://127.0.0.1:5183
```

The tests run with Anki's Python against a small collection they make up:

```bash
./tests/run.sh                  # all of them, or name some: ./tests/run.sh test_window
```

`tools/bench_display.py` times how fast cards get on screen, swapping one
page's HTML against switching between frames drawn ahead. That's how Skim
ended up drawing ahead.

## License

[AGPL-3.0-or-later](LICENSE). The logos of the resources (Bootcamp, Sketchy,
UWorld, AMBOSS and the others) belong to their owners, who aren't affiliated
with Skim; they're there only to show which resource is which.
