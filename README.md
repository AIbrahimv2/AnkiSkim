# Skim

**A card browser for Anki that keeps up with your keys.** Search with Anki's
own syntax, then move through the cards with vim keys. Each card looks the way
it does when you review it, and the next ones are drawn before you get there,
so moving is instant.

It pairs with [Stepwise](https://github.com/AIbrahimv2/AnkiStepwise): press
`p` on a topic there to see its cards here, and Skim follows as you move
through topics.

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
- **A list beside the card.** Every card the search found, one line each: the
  note's text with clozes filled in, its card type, its state (new, learning,
  review, suspended, buried) and its flag. Click a row to jump there; drag the
  edge between the list and the card to resize.
- **Follows Stepwise.** Press `p` on a topic in Stepwise and Skim opens on its
  cards. Leave Skim open and every topic you move to in Stepwise shows its
  cards here, without taking the keys away. `p` in Skim goes back to Stepwise.
  Search for something else in Skim and it stops following.
- **Edit in Anki's browser.** `e` opens the card there, with the same search.
- **Follows Anki's light and dark themes**, and looks like Stepwise.

## Usage

1. Open **Tools → Skim** (Cmd/Ctrl+Shift+B), or press `p` on a topic in
   Stepwise.
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
| `/` | Search; Enter runs it, Esc goes back to the cards |
| `e` or `b` | Open the card in Anki's browser, to edit it |
| `r` | Play the card's audio |
| `p` | Back to the window that opened Skim (Stepwise) |
| `q` or `Esc` | Close Skim (Esc first cancels a number you've typed) |
| `?` | Show these keys |

### Settings

**⋯ → Settings…** in the window (Anki's **Config** button for the add-on
opens the same thing): the side each card opens on (the back, by default,
which for most note types includes the front), playing audio by itself, the
search Skim opens on the first time, and the keyboard shortcut.

### For other add-ons

Skim publishes a small API as `aqt.mw.skim` (see [src/api.py](src/api.py)):
`open()` shows a search or a list of card ids, and `follow()` swaps in new
cards while Skim shows yours. Passing card ids skips Anki's search, which
for a tag reads every note.

## Installation

Not on AnkiWeb yet. Run `./build.sh` and double-click the file it writes to
`dist/`, or link `src/` into Anki's add-ons folder (below).

## Development

The add-on that Anki loads lives in `src/`. To try changes live, link it
into your Anki add-ons folder and restart Anki:

```bash
ln -s "$(pwd)/src" ~/Library/Application\ Support/Anki2/addons21/anki-skim
```

The window's page is TypeScript in `web/`, built with Vite into
`src/web/skim.js` and `skim.css` (committed, so the add-on works straight from
a checkout). The parts you move through (list, card frames, keys) are plain
DOM; the dialogs, menu and toasts are React, with styles and controls copied
from Stepwise. It talks to Python through Anki's `pycmd` bridge
(`src/bridge.py`).

```bash
cd web && npm install
npm run build        # rebuild src/web/ after changing the page
npm test             # the vim keys
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

[AGPL-3.0-or-later](LICENSE).
