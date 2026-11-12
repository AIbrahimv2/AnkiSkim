"""The real Skim window offscreen: its AnkiWebView, the built page, and card
frames running Anki's own reviewer.js, served by a stand-in for Anki's media
server. Driven the way you'd use it: keys, a search, Stepwise opening and
following, an edit, closing."""

import json
import os
import threading
import time
import types
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from harness import ALL, APP, SRC, api, app, check, col, mw, notes, pump
from aqt.qt import QDialog

ANKI_WEB = os.path.join(APP, "_aqt", "data", "web")
PAGES: dict[str, str] = {}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, body: bytes, ctype: str):
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = urllib.parse.unquote(self.path.split("?")[0])
        if path == "/_anki/legacyPageData":
            return self._send(PAGES.get(self.path.split("id=")[-1], "").encode(), "text/html; charset=utf-8")
        for prefix, root in (("/_anki/", ANKI_WEB), ("/_addons/skim/web/", os.path.join(SRC, "web"))):
            if path.startswith(prefix):
                f = os.path.join(root, path[len(prefix):])
                if os.path.isfile(f):
                    ctype = "text/css" if f.endswith(".css") else "application/javascript"
                    return self._send(open(f, "rb").read(), ctype)
        self.send_response(404)
        self.end_headers()


srv = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
PORT = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
mw.mediaServer = types.SimpleNamespace(getPort=lambda: PORT, set_page_html=lambda pid, html, ctx: PAGES.__setitem__(str(pid), html),
                                       clear_page_html=lambda pid: PAGES.pop(str(pid), None))
mw.app = app
mw.serverURL = lambda: f"http://127.0.0.1:{PORT}/"
mw.baseHTML = lambda: f'<base href="http://127.0.0.1:{PORT}/">'


def js(expr: str, timeout: float = 8.0):
    out: list = []
    api._window.web.evalWithCallback(expr, lambda r: out.append(r))
    end = time.time() + timeout
    while not out and time.time() < end:
        app.processEvents()
        time.sleep(0.01)
    return out[0] if out else "<timeout>"


def wait_for(expr: str, timeout: float = 20.0):
    end = time.time() + timeout
    last = None
    while time.time() < end:
        last = js(expr)
        if last and last != "<timeout>":
            return last
        pump(0.05)
    raise AssertionError(f"timed out waiting for {expr} (last: {last!r})")


def press(*keys: str) -> None:
    for k in keys:
        js(f"window.dispatchEvent(new KeyboardEvent('keydown', {{key: {json.dumps(k)}, bubbles: true}}))")


SHOWN = "(() => { const f = document.querySelector('.card-frame.on'); return f && f.contentWindow.skimCid; })()"
SHOWN_TEXT = "(() => { const f = document.querySelector('.card-frame.on'); return f && f.contentDocument.getElementById('qa').textContent; })()"
POS = "document.querySelector('.pos') && document.querySelector('.pos').textContent"


def shown_is(cid: int) -> None:
    wait_for(f"{SHOWN} === {cid} && !document.querySelector('.stage').classList.contains('waiting')")


try:
    print("prewarm")
    api.prewarm()
    check(api._window is not None and not api._window.isVisible(), "the window is made ahead, hidden")
    wait_for("!!document.querySelector('.card-frame')")
    check(js("document.querySelectorAll('.card-frame').length") == 6, "with six card frames loading Anki's reviewer")

    print("open")
    api.open(search="tag:Cardio")
    check(api.is_open(), "Tools → Skim shows it")
    check(wait_for(f"{POS} === '1 of 4'"), "on the search's four cards")
    shown_is(ALL[0])
    check("Four" in js(SHOWN_TEXT), "the first card shows, back side (the default)")
    wait_for("[...document.querySelectorAll('.card-frame')].filter(f => f.contentWindow.skimCid).length >= 4")
    check(True, "the cards around it are drawn ahead")

    print("keys")
    press("j")
    check(js(POS) == "2 of 4", "j moves on")
    check(js(SHOWN) == ALL[1], "and the next card is already on screen when the key returns")
    press("G")
    check(js(POS) == "4 of 4", "G goes to the last card")
    press("g", "g")
    check(js(POS) == "1 of 4", "gg to the first")
    press("3", "j")
    check(js(POS) == "4 of 4", "3j moves three")
    press("k")  # card 3: the mitral note's forward card ("Valve between LA and LV?")
    press("h")
    wait_for(f"{SHOWN_TEXT} && !{SHOWN_TEXT}.includes('Mitral') && document.querySelector('.sides .active').textContent === 'Front'")
    check(True, "h shows the front, without the answer")
    press(" ")
    wait_for(f"{SHOWN_TEXT}.includes('Mitral')")
    check(True, "Space flips to the back")
    check(js("document.querySelector('.row.cur .r-state').textContent") == "Suspended", "the list marks suspended cards")

    print("search")
    js("(() => { const i = document.querySelector('.search input'); i.value = 'tag:Neuro'; "
       "i.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true})); })()")
    check(wait_for(f"{POS} === '1 of 4'"), "a search in the box shows what it finds")
    check(js("document.activeElement === document.body"), "and the keys go back to the cards")
    check(mw.pm.profile.get("skim.search") == "tag:Neuro", "it's remembered for next time")

    print("opened from Stepwise")
    stepwise = QDialog()
    stepwise.setWindowTitle("Stepwise")
    stepwise.show()
    stepwise.activateWindow()
    pump(0.2)
    movement = list(col.find_cards(f"nid:{notes['parkinson']}"))
    api._window._opener = None
    api.open(search='"tag:Neuro::Movement"', card_ids=movement, title="Movement", source="Stepwise")
    check(wait_for(f"{POS} === '1 of 2'"), "card ids handed over are shown as they are")
    check(js("document.querySelector('.source-title').textContent") == "Movement", "with the topic's name")
    check("back to Stepwise" in js("document.querySelector('.hints').textContent"), "and p to go back to Stepwise")
    brainstem = list(col.find_cards(f"nid:{notes['brainstem']}"))
    check(api.follow(search='"tag:Neuro::Brainstem"', card_ids=brainstem, title="Brainstem", source="Stepwise"),
          "follow() takes the next topic while Skim shows Stepwise's cards")
    check(wait_for("document.querySelector('.source-title').textContent === 'Brainstem'"), "and shows it")
    shown_is(brainstem[0])
    check(not api.follow(search="x", card_ids=[], title="x", source="Other"), "another source can't take over")
    press("p")
    pump(0.2)
    check(True, "p asks to go back (the window manager decides who gets focus offscreen)")

    print("an edit elsewhere")
    note = col.get_note(notes["brainstem"])
    note.fields[1] = "Edited extra"
    col.update_note(note)
    api.on_operation(types.SimpleNamespace(note_text=True, card=False, notetype=False), None)
    wait_for(f"{SHOWN_TEXT} && {SHOWN_TEXT}.includes('Edited extra')")
    check(True, "redraws the card with the new text")

    print("searching here stops following")
    api._window.run_search("tag:Cardio")
    check(not api.following("Stepwise"), "follow() no longer applies")

    print("close")
    press("q")
    pump(0.3)
    check(not api.is_open(), "q closes Skim")
    api.open()
    check(wait_for(f"{POS} === '1 of 4'"), "and it reopens on what it showed")
    api.close()
    check(api._window is None, "closing the profile disposes of it")
    print("all passed")
finally:
    api.close()
    srv.shutdown()
