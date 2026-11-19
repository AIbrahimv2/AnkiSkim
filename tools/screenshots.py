#!/usr/bin/env python3
"""Make the screenshot for the README and the AnkiWeb listing.

    python3 tools/screenshots.py [--collection PATH] [--stepwise PATH] [--capture-wallpaper | --wallpaper PATH]

Writes docs/screenshot.png: Skim's window on a B&B topic (TOPIC) full of
suspended cards and their verdicts, at one with a picture that Skim says to
unsuspend now (CARD, found by its text): "tRNAs are the smallest RNAs and
have a clover-leaf structure", a real AnKing card (note 1467927195193, so
anyone's copy of the deck has it) whose diagram is OpenStax's, CC BY 4.0,
credited on the card. The window is taller than its default 1180x780, so
the diagram and its credit show whole, and draws at 108% (ZOOM). The page comes from tools/devserver.py, run with Anki's own Python
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
SIZE = (1180, 1040)  # the default width (src/window.py), taller so the card's diagram and its credit show whole
TOPIC = "#AK_Step1_v12::#B&B::07_Cell_Bio::01_Molecular::05_Translation"
CARD = "tRNAs are the smallest RNAs"  # its row's text
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
  await sleep(2500);  // the keys pressed fade from the corner, and the card's frame settles
  return counter().textContent.trim() + ': ' + document.querySelector('.row.cur').textContent;
})()"""


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--collection", default=shots.DEFAULT_COLLECTION)
    ap.add_argument("--media", help="the collection's media folder (default: beside it)")
    ap.add_argument("--stepwise", default=STEPWISE, help="Stepwise's meta.json, if the file exists")
    shots.add_wallpaper_args(ap)
    args = ap.parse_args()
    if not os.path.isfile(args.collection):
        raise SystemExit(f"no collection at {args.collection}: pass --collection")
    media = args.media or os.path.join(os.path.dirname(args.collection), "collection.media")
    with shots.Session() as s:
        port = shots.free_port()
        cmd = [shots.anki_python(), os.path.join(ROOT, "tools", "devserver.py"), "--collection", args.collection,
               "--media", media, "--search", f'"tag:{TOPIC}"', "--dark", "--port", str(port)]
        if os.path.isfile(args.stepwise):
            cmd += ["--stepwise", args.stepwise]
        dev = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            shots.wait_for(f"http://127.0.0.1:{port}/", timeout=90)
            s.capture([{"url": f"http://127.0.0.1:{port}/?theme=dark", "width": SIZE[0], "height": SIZE[1],
                        "setup": SETUP % {"card": json.dumps(CARD)}, "zoom": ZOOM, "wait": 300, "out": "skim.png",
                        "result": s.path("skim.json")}])
        finally:
            dev.terminate()
            dev.wait()
        with open(s.path("skim.json")) as f:
            print("card", json.load(f))
        written = s.frames([{"image": "skim.png", "size": SIZE, "title": "Skim", "out": "screenshot.png"}],
                           shots.wallpaper_for(args, s), DOCS)
    for out in written:
        print("wrote", os.path.relpath(out, ROOT))


if __name__ == "__main__":
    main()
