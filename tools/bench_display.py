#!/usr/bin/env python3
"""Time how fast cards get on screen in Anki's web engine, two ways.

- swap: one reviewer page; each move replaces its HTML (what Anki's
  previewer does, minus its 300 ms throttle).
- ring: a few reviewer pages (iframes) with the next cards already drawn;
  each move only changes which frame shows. Tried with the waiting frames
  hidden (visibility) and stacked underneath (z-index), and with and
  without decoding their images ahead.

It draws real cards from a collection, with images from a media folder, in
a window on screen (pass --offscreen to skip the window, but paint timings
are then software-rendered). Nothing is written to either.

Run it with Anki's own Python:

    PY=~/Library/Application\\ Support/AnkiProgramFiles/python/*/bin/python3
    "$PY" tools/bench_display.py COLLECTION MEDIA_DIR [--cards 60] [--offscreen]

COLLECTION must be a copy (Anki locks the real one while it's open).
"""

from __future__ import annotations

import argparse
import json
import mimetypes
import os
import random
import statistics
import sys
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

APP = "/Applications/Anki.app/Contents/Resources/app_packages"
ANKI_WEB = os.path.join(APP, "_aqt", "data", "web")
sys.path.insert(0, APP)

ap = argparse.ArgumentParser()
ap.add_argument("collection")
ap.add_argument("media")
ap.add_argument("--cards", type=int, default=60)
ap.add_argument("--frames", type=int, default=4, help="frames in the ring")
ap.add_argument("--offscreen", action="store_true")
args = ap.parse_args()
if args.offscreen:
    os.environ["QT_QPA_PLATFORM"] = "offscreen"

from anki.collection import Collection, SearchNode  # noqa: E402

# --- cards -------------------------------------------------------------------

col = Collection(args.collection)
tags = [t for t in col.tags.all() if t.count("::") >= 3]
random.seed(7)
random.shuffle(tags)
cids: list[int] = []
for tag in tags:
    found = col.find_cards(col.build_search_string(SearchNode(tag=tag)), order="c.id")
    if args.cards <= len(found) <= args.cards * 4:
        cids = list(found)[: args.cards]
        break
if not cids:
    sys.exit("No tag with enough cards")
print(f"topic: {tag} ({len(cids)} cards)")

cards = []
for cid in cids:
    card = col.get_card(cid)
    html = col.media.escape_media_filenames(card.answer())
    cards.append({"html": html, "cls": f"card card{card.ord + 1} isMac"})
col.close()
sizes = [len(c["html"]) for c in cards]
imgs = [c["html"].count("<img") for c in cards]
print(f"answer HTML: median {statistics.median(sizes) / 1024:.0f} KB, "
      f"images per card: median {statistics.median(imgs):.0f}, max {max(imgs)}")

# --- a stand-in for Anki's media server --------------------------------------

FRAME = """<!doctype html><html class="" dir="ltr"><head><meta charset="utf-8">
<base href="http://127.0.0.1:{port}/">
<link rel="stylesheet" href="/_anki/css/webview.css">
<link rel="stylesheet" href="/_anki/css/reviewer.css">
<style>body {{ background-color: var(--canvas); }}</style>
<script>window.pycmd = window.bridgeCommand = function () {{}};</script>
<script src="/_anki/js/vendor/jquery.min.js"></script>
<script src="/_anki/js/mathjax.js"></script>
<script src="/_anki/js/vendor/mathjax/tex-chtml-full.js"></script>
<script src="/_anki/js/reviewer.js"></script>
</head><body class="card isMac">
<div id="_mark" hidden>&#x2605;</div><div id="_flag" hidden>&#x2691;</div>
<div id="qa" dir="auto"></div></body></html>"""

BENCH = """<!doctype html><html><head><meta charset="utf-8"><style>
html, body {{ margin: 0; height: 100%; }}
#stage {{ position: relative; height: 100%; }}
#stage iframe {{ position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }}
#stage[data-mode=vis] iframe {{ visibility: hidden; }}
#stage[data-mode=vis] iframe.on {{ visibility: visible; }}
#stage[data-mode=z] iframe {{ z-index: 0; }}
#stage[data-mode=z] iframe.on {{ z-index: 1; }}
</style></head><body><div id="stage" data-mode="vis">{frames}</div><script>
const stage = document.getElementById("stage");
const frames = [...stage.querySelectorAll("iframe")];
window.cards = [];
window.result = null;
const raf2 = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
window.ready = () => frames.every((f) => f.contentWindow && typeof f.contentWindow._updateQA === "function");
async function draw(f, c, decode) {{
  const w = f.contentWindow;
  await w._updateQA(c.html, null, () => {{ w.scrollTo(0, 0); w.document.body.className = c.cls; }}, () => {{}});
  if (decode) await Promise.all([...w.document.images].map((i) => i.decode().catch(() => {{}})));
}}
function show(f) {{ for (const x of frames) x.classList.toggle("on", x === f); }}
async function swap(start, n) {{
  stage.dataset.mode = "vis";
  const f = frames[0]; show(f); await raf2();
  const t = [];
  for (let i = start; i < start + n; i++) {{
    const t0 = performance.now();
    await draw(f, cards[i], false); await raf2();
    t.push(performance.now() - t0);
  }}
  return {{ show: t }};
}}
async function ring(start, n, mode, decode) {{
  stage.dataset.mode = mode;
  const K = frames.length, pre = [], sw = [];
  for (let j = 0; j < K; j++) {{
    const t0 = performance.now(); await draw(frames[j], cards[start + j], decode); pre.push(performance.now() - t0);
  }}
  show(frames[0]); await raf2(); await new Promise((r) => setTimeout(r, 300));
  for (let i = start + 1; i < start + n; i++) {{
    const f = frames[(i - start) % K], old = frames[(i - start - 1) % K];
    const t0 = performance.now(); show(f); await raf2(); sw.push(performance.now() - t0);
    const next = i - 1 + K;
    if (next < start + n) {{
      const t1 = performance.now(); await draw(old, cards[next], decode); pre.push(performance.now() - t1);
    }}
  }}
  return {{ show: sw, predraw: pre }};
}}
window.run = (name, ...a) => {{
  window.result = null;
  (name === "swap" ? swap(...a) : ring(...a)).then((r) => (window.result = JSON.stringify(r)),
    (e) => (window.result = JSON.stringify({{ error: String(e) }})));
}};
</script></body></html>"""


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, body: bytes, ctype: str) -> None:
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = urllib.parse.unquote(self.path.split("?")[0])
        if path == "/frame.html":
            return self._send(FRAME.format(port=PORT).encode(), "text/html; charset=utf-8")
        if path == "/bench.html":
            frames = "".join('<iframe src="/frame.html"></iframe>' for _ in range(args.frames))
            return self._send(BENCH.format(frames=frames).encode(), "text/html; charset=utf-8")
        if path.startswith("/_anki/"):
            f = os.path.join(ANKI_WEB, path[len("/_anki/"):])
        else:
            f = os.path.join(args.media, path.lstrip("/"))
        real = os.path.realpath(f)
        if not (real.startswith(os.path.realpath(ANKI_WEB)) or real.startswith(os.path.realpath(args.media))):
            self.send_response(403)
            self.end_headers()
            return
        if os.path.isfile(real):
            with open(real, "rb") as fh:
                return self._send(fh.read(), mimetypes.guess_type(real)[0] or "application/octet-stream")
        self.send_response(404)
        self.end_headers()


srv = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
PORT = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()

# --- the window --------------------------------------------------------------

from PyQt6.QtCore import QCoreApplication, Qt, QUrl  # noqa: E402

QCoreApplication.setAttribute(Qt.ApplicationAttribute.AA_ShareOpenGLContexts)
from PyQt6.QtWebEngineWidgets import QWebEngineView  # noqa: E402
from PyQt6.QtWidgets import QApplication  # noqa: E402

app = QApplication(sys.argv[:1])
view = QWebEngineView()
view.resize(900, 760)
view.setWindowTitle("Skim display timing")
view.load(QUrl(f"http://127.0.0.1:{PORT}/bench.html"))
view.show()


def js(expr: str, timeout: float = 30.0):
    out: list = []
    view.page().runJavaScript(expr, lambda r: out.append(r))
    end = time.time() + timeout
    while not out and time.time() < end:
        app.processEvents()
        time.sleep(0.005)
    return out[0] if out else None


def wait(expr: str, timeout: float = 60.0):
    end = time.time() + timeout
    while time.time() < end:
        r = js(expr, 5)
        if r:
            return r
        time.sleep(0.05)
    sys.exit(f"timed out waiting for {expr}")


wait("window.ready && window.ready()")
for i in range(0, len(cards), 10):
    js(f"cards.push(...{json.dumps(cards[i:i + 10])}); cards.length")


def run(label: str, *call_args) -> dict:
    js(f"run({', '.join(json.dumps(a) for a in call_args)})")
    r = json.loads(wait("window.result", 600))
    if "error" in r:
        sys.exit(f"{label}: {r['error']}")
    return r


def stats(xs: list[float]) -> str:
    xs = sorted(xs)
    return (f"median {statistics.median(xs):6.1f} ms   p90 {xs[int(len(xs) * 0.9)]:6.1f} ms   "
            f"max {xs[-1]:6.1f} ms")


n = len(cards)
half = n // 2
# First pass over each half sees its images for the first time (cold);
# repeating a half shows them again from Chromium's cache (warm).
results = [
    ("swap, first time", run("swap", "swap", 0, half)),
    ("swap, seen before", run("swap", "swap", 0, half)),
    ("ring hidden, first time", run("ring", "ring", half, n - half, "vis", False)),
    ("ring hidden + decode", run("ring", "ring", half, n - half, "vis", True)),
    ("ring stacked + decode", run("ring", "ring", 0, half, "z", True)),
]
print()
print(f"time from a move to the card on screen ({'offscreen' if args.offscreen else 'on screen'}):")
for label, r in results:
    print(f"  {label:26} {stats(r['show'])}")
print()
print("time to draw a waiting card in the background (ring):")
for label, r in results:
    if "predraw" in r:
        print(f"  {label:26} {stats(r['predraw'])}")
view.close()
srv.shutdown()
