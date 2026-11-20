#!/usr/bin/env python3
"""Make the screenshot for the README and the AnkiWeb listing.

    python3 tools/screenshots.py [--collection PATH] [--stepwise PATH] [--topic TAG] [--card TEXT]
                                 [--plain] [--capture-wallpaper | --wallpaper PATH]

Writes docs/screenshot.png: two Skim windows side by side, unlabelled. On
the left, Skim on a B&B topic (TOPIC) full of suspended cards and their
verdicts, at a card (CARD, found by its row's text) whose tags show both
steps and several systems; on the right, the same card open in the editor
(e). The card is "Which molecular motor protein is used for retrograde
transport along the microtubule? Dynein", a real AnKing card (note
1468250073774, so anyone's copy of the deck has it): its tags put it in
Biochem, Neuro, Respiratory and Micro, 86% Step 1 to 14% Step 2, and its
diagram, which the editor shows whole with its credit, is Duncan and
Goldstein's, CC BY 4.0, via Wikimedia Commons. --topic and --card show
another. Each window is taller than its default 1180x780 and draws at 108%
(ZOOM), on AnkiGlass's glass as AnkiGlass gives an add-on's window (--plain
for none), with the card see-through as "Glass behind the card" makes it. The page comes from tools/devserver.py, run with Anki's own Python
(ANKI_PYTHON, or the launcher's) on a copy of a collection: the Default
profile's unless --collection names another, with the media folder beside
it. The collection itself is never touched. Verdicts follow Stepwise's
pinned resources and statuses, read from its meta.json (--stepwise, by
default the Stepwise checkout next to this one), as Stepwise would pass them.

It's made with the add-ons' shared screenshot tools, in the kit's checkout
next to this one (../anki-addon-kit/screenshots/shots.py, or set
ANKI_ADDON_KIT), which describe how they look and what they need.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOCS = os.path.join(ROOT, "docs")
KIT = os.environ.get("ANKI_ADDON_KIT", os.path.join(os.path.dirname(ROOT), "anki-addon-kit"))
sys.path.insert(0, os.path.join(KIT, "screenshots"))
import shots  # noqa: E402

# How big it draws in its window (the kit's zoom.py, Cmd+=), so it reads at
# the listing's width. The page is then 1180 / 1.08 = 1093px wide: any
# narrower (under 1080px, styles.css) and Skim hides the card to give the
# table the window.
ZOOM = 1.08
SIZE = (1180, 1040)  # the default width (src/window.py), taller to show more of the card and its tags
TOPIC = "#AK_Step1_v12::#B&B::07_Cell_Bio::03_Cellular_Biology::03_Cytoskeleton"
CARD = "retrograde transport along the microtubule"  # its row's text: the dynein card
STEPWISE = os.path.join(os.path.dirname(ROOT), "anki-stepwise", "src", "meta.json")
SETUP = """(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const counter = () => [...document.querySelectorAll('body *')].find((e) =>
    e.children.length === 0 && /^\\d+ of \\d+$/.test(e.textContent.trim()));
  for (let i = 0; i < 100 && !counter(); i++) await sleep(100);
  if (!counter()) throw new Error('no card counter: did the page load?');
  // Down the list with j until the current row is the card.
  const here = () => (document.querySelector('.row.cur')?.textContent ?? '').includes(%(card)s);
  for (let i = 0; i < 500 && !here(); i++) {
    document.documentElement.dispatchEvent(new KeyboardEvent('keydown', {key: 'j', bubbles: true}));
    await sleep(40);
  }
  if (!here()) throw new Error('no row with ' + %(card)s);
  const row = counter().textContent.trim() + ': ' + document.querySelector('.row.cur').textContent;
%(then)s
  await sleep(2500);  // the keys pressed fade from the corner, and the card's frame settles
  return row;
})()"""
# Then, for the second window: e opens the card in the editor, its fields in
# the table's place and the card beside them.
EDIT = """  document.documentElement.dispatchEvent(new KeyboardEvent('keydown', {key: 'e', bubbles: true}));
  for (let i = 0; i < 50 && !document.querySelector('.editing .field'); i++) await sleep(100);
  if (!document.querySelector('.editing .field')) throw new Error("the editor didn't open");"""


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--collection", default=shots.DEFAULT_COLLECTION)
    ap.add_argument("--media", help="the collection's media folder (default: beside it)")
    ap.add_argument("--stepwise", default=STEPWISE, help="Stepwise's meta.json, if the file exists")
    ap.add_argument("--topic", default=TOPIC, help="the tag the window opens on")
    ap.add_argument("--card", default=CARD, help="text in the row of the card to show")
    ap.add_argument("--plain", action="store_true", help="without AnkiGlass")
    shots.add_wallpaper_args(ap)
    args = ap.parse_args()
    if not os.path.isfile(args.collection):
        raise SystemExit(f"no collection at {args.collection}: pass --collection")
    media = args.media or os.path.join(os.path.dirname(args.collection), "collection.media")
    glass = None if args.plain else shots.load_glass()
    with shots.Session() as s:
        port = shots.free_port()
        cmd = [shots.anki_python(), os.path.join(ROOT, "tools", "devserver.py"), "--collection", args.collection,
               "--media", media, "--search", f'"tag:{args.topic}"', "--dark", "--port", str(port)]
        if os.path.isfile(args.stepwise):
            cmd += ["--stepwise", args.stepwise]
        dev = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            shots.wait_for(f"http://127.0.0.1:{port}/", timeout=90)
            s.capture([{"url": f"http://127.0.0.1:{port}/?theme=dark", "width": SIZE[0], "height": SIZE[1],
                        "setup": SETUP % {"card": json.dumps(args.card), "then": then}, "zoom": ZOOM, "wait": 300,
                        "out": f"{name}.png", "result": s.path(f"{name}.json"),
                        **({"preload": glass["window"], "transparent": True} if glass else {})}
                       for name, then in (("table", ""), ("editor", EDIT))])
        finally:
            dev.terminate()
            dev.wait()
        with open(s.path("table.json")) as f:
            print("card", json.load(f))
        # The two windows speak for themselves: no labels.
        out = s.side_by_side([{"image": f"{name}.png", "size": SIZE, "title": "Skim", "tint": glass and glass["tint"]}
                              for name in ("table", "editor")],
                             None, shots.wallpaper_for(args, s), os.path.join(DOCS, "screenshot.png"))
    print("wrote", os.path.relpath(out, ROOT))


if __name__ == "__main__":
    main()
