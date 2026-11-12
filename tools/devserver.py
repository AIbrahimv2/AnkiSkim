#!/usr/bin/env python3
"""Run Skim's page outside Anki, against a copy of a real collection.

The page talks to the add-on's actual Python bridge (src/bridge.py), and the
card frames load Anki's own reviewer files from the installed app, so what
you see is real cards drawn the real way; only Anki's window is missing.
The collection is copied to a temp folder first, so the original is never
touched, and media is only read.

Run it with Anki's own Python, after building the page (web/: npm run build):

    PY=$(ls -d ~/Library/Application\\ Support/AnkiProgramFiles/python/*/bin/python3 | tail -1)
    "$PY" tools/devserver.py --collection ~/Library/Application\\ Support/Anki2/Default/collection.anki2 \\
        --media ~/Library/Application\\ Support/Anki2/Default/collection.media --search "tag:#AK_Step1_v12::#B&B::01_Biochem*"

Then open http://127.0.0.1:5183 (add ?theme=dark for dark mode, with --dark).
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import mimetypes
import os
import shutil
import sys
import tempfile
import threading
import types
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "src")
APP = "/Applications/Anki.app/Contents/Resources/app_packages"
ANKI_WEB = os.path.join(APP, "_aqt", "data", "web")
REVIEWER_HTML = '<div id="_mark" hidden>&#x2605;</div><div id="_flag" hidden>&#x2691;</div><div id="qa" dir="auto"></div>'

SHELL = """<!doctype html>
<html class="{html_class}"><head><meta charset="utf-8"><title>Skim (dev)</title>
<link rel="stylesheet" href="/_anki/css/webview.css">
<link rel="stylesheet" href="/web/skim.css">
<script>
window.pycmd = function (arg, cb) {{
  fetch("/bridge", {{method: "POST", body: arg}}).then(r => r.json()).then(r => cb && cb(r));
  return false;
}};
</script>
<script src="/web/skim.js"></script>
</head><body><div id="root"></div></body></html>"""


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--collection", required=True, help="collection.anki2 to copy and serve")
    ap.add_argument("--media", required=True, help="the collection's media folder (read only)")
    ap.add_argument("--search", default="deck:current", help="what the page opens on")
    ap.add_argument("--back", default="Stepwise", help="window title p would go back to ('' for none)")
    ap.add_argument("--dark", action="store_true")
    ap.add_argument("--port", type=int, default=int(os.environ.get("PORT", 5183)))
    args = ap.parse_args()

    os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
    if importlib.util.find_spec("aqt") is None:
        sys.path.insert(0, APP)

    work = tempfile.mkdtemp(prefix="skim-dev-")
    for suffix in ("", "-wal"):
        if os.path.exists(args.collection + suffix):
            shutil.copy(args.collection + suffix, os.path.join(work, "collection.anki2" + suffix))

    from aqt.qt import QApplication, QMenu, QWidget

    qt_app = QApplication.instance() or QApplication(["skim-dev"])  # noqa: F841 (must stay alive)

    import aqt
    from anki.collection import Collection

    col = Collection(os.path.join(work, "collection.anki2"))

    class AddonManager:
        def __init__(self):
            self.cfg = json.load(open(os.path.join(SRC, "config.json")))

        def getConfig(self, module):
            return json.loads(json.dumps(self.cfg))

        def writeConfig(self, module, cfg):
            self.cfg = json.loads(json.dumps(cfg))

        def setConfigAction(self, module, fn):
            pass

        def setWebExports(self, module, pattern):
            pass

    mw = QWidget()
    mw.col = col
    mw.addonManager = AddonManager()
    mw.form = types.SimpleNamespace(menuTools=QMenu())
    mw.pm = types.SimpleNamespace(profile={})
    aqt.mw = mw

    spec = importlib.util.spec_from_file_location("skim_dev", os.path.join(SRC, "__init__.py"),
                                                  submodule_search_locations=[SRC])
    pkg = importlib.util.module_from_spec(spec)
    sys.modules["skim_dev"] = pkg
    spec.loader.exec_module(pkg)
    from skim_dev import frame
    from skim_dev.bridge import Bridge
    from skim_dev.viewstate import ViewState

    base = f"http://127.0.0.1:{args.port}/"
    night = " nightMode night_mode" if args.dark else ""

    class Host:
        def __init__(self):
            self.col = col
            self.state = ViewState()
            self.state.set(col, search=args.search)
            self.saved_layout: dict = {}

        def prepare(self, text):
            return col.media.escape_media_filenames(text)

        def hook(self, text, card, kind):
            return text

        def body_class(self, ord_):
            return f"card card{ord_ + 1} isMac{night}"

        def view(self):
            return self.state.as_dict(args.back or None)

        def frame_html(self):
            return frame.document(base_url=base, night=args.dark, standard_css="",
                                  body_class=f"isMac{night}", reviewer_html=REVIEWER_HTML)

        def layout(self):
            return self.saved_layout

        def save_layout(self, layout):
            self.saved_layout = layout

        def run_search(self, query):
            self.state.set(col, search=query.strip())
            return self.view()

        def edit(self, cid):
            print(f"[dev] would open the browser on card {cid}")

        def back(self):
            print("[dev] would go back")

        def close_window(self):
            print("[dev] would close")

        def replay(self, cid, side):
            print(f"[dev] would play {side} audio of {cid}")

        def play(self, cid, tag):
            print(f"[dev] would play {tag} of {cid}")

        def settings_saved(self, cfg, changed):
            print(f"[dev] settings saved: {sorted(changed)}")

    bridge = Bridge(Host())
    lock = threading.Lock()  # one collection call at a time
    media = os.path.realpath(args.media)
    anki_web = os.path.realpath(ANKI_WEB)
    page_web = os.path.realpath(os.path.join(SRC, "web"))

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, fmt, *a):
            pass

        def _send(self, body: bytes, ctype: str, status: int = 200, cache: bool = False):
            self.send_response(status)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            # Media and Anki's files can be cached; the page is rebuilt often.
            self.send_header("Cache-Control", "max-age=300" if cache else "no-store")
            self.end_headers()
            self.wfile.write(body)

        def _file(self, root: str, rel: str, cache: bool = True):
            path = os.path.realpath(os.path.join(root, rel))
            if not path.startswith(root + os.sep) or not os.path.isfile(path):
                return self._send(b"not found", "text/plain", 404)
            with open(path, "rb") as fh:
                self._send(fh.read(), mimetypes.guess_type(path)[0] or "application/octet-stream", cache=cache)

        def do_GET(self):
            path = urllib.parse.unquote(urllib.parse.urlsplit(self.path).path)
            if path == "/":
                html = SHELL.format(html_class="night-mode" if args.dark else "")
                return self._send(html.encode(), "text/html; charset=utf-8")
            if path.startswith("/web/"):
                return self._file(page_web, path[len("/web/"):], cache=False)
            if path.startswith("/_anki/"):
                return self._file(anki_web, path[len("/_anki/"):])
            return self._file(media, path.lstrip("/"))

        def do_POST(self):
            if self.path != "/bridge":
                return self._send(b"not found", "text/plain", 404)
            raw = self.rfile.read(int(self.headers.get("Content-Length") or 0)).decode()
            with lock:
                result = bridge.handle(raw)
            self._send(json.dumps(result).encode(), "application/json")

    print(f"Skim dev server on {base} ({len(bridge.host.state.ids)} cards for {args.search!r})", flush=True)
    ThreadingHTTPServer(("127.0.0.1", args.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
