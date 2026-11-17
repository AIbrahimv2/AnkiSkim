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
    LENS_ON = "document.querySelector('.lens.on').textContent"
    LENS_BAR = "[...document.querySelectorAll('.lens')].map(b => b.textContent).join(',')"
    bar = js(LENS_BAR)
    check(bar.startswith("All4,This review,Due") and bar.endswith("Overdue"),
          f"the bar over the table is there outside a review: All, then the review's views ({bar})")
    check(js(LENS_ON) == "All4", "on All, with the search's count")
    bar = wait_for(f"/^All4,This review\\d+,Due\\d+/.test({LENS_BAR}) && {LENS_BAR}")
    check(True, f"and the other views are counted once the window is up ({bar})")
    shown_is(ALL[0])
    check("Four" in js(SHOWN_TEXT), "the first card shows, back side (the default)")
    wait_for("[...document.querySelectorAll('.card-frame')].filter(f => f.contentWindow.skimCid).length >= 4")
    check(True, "the cards around it are drawn ahead")

    print("table, filters and tags")
    check(js("[...document.querySelectorAll('.list-head span')].map(s => s.textContent).join(',')")
          == "#,Card,State,Yield,Q-bank,Again in,Verdict", "the table has its columns")
    chips = wait_for("[...document.querySelectorAll('.chip')].map(c => c.textContent).join(',').includes('Suspended2') && "
                     "[...document.querySelectorAll('.chip')].map(c => c.textContent).join(',')")
    check("All4" in chips and "Now2" in chips and "Wait0" in chips, f"filter chips count the topic's cards ({chips})")
    check(js("document.querySelector('.tp-title').textContent") == "Where this card lives", "the tags pane is under the card")
    wait_for("document.querySelector('.tp-res') && document.querySelector('.tp-res').textContent.includes('you')")
    check(True, "and shows the card's places, the topic's resource first")
    js("[...document.querySelectorAll('.chip')].find(c => c.textContent.startsWith('Suspended')).dispatchEvent(new MouseEvent('mousedown', {bubbles: true}))")
    check(wait_for(f"{POS} === '1 of 2'"), "a chip filters the table")
    check(wait_for("document.querySelector('.tp-verdict') && document.querySelector('.tp-verdict').textContent.includes('Only here')"),
          "a suspended card's verdict and reason show in the pane")
    press("f")
    check(js("document.querySelector('.chip.on').textContent.startsWith('Now')"), "f goes to the next filter")
    press("F", "F")
    check(js("document.querySelector('.chip.on').textContent.startsWith('All')") and js(POS).endswith("of 4"), "F back to All")
    check(js(POS) != "1 of 4", "still on the card you were on")
    press("g", "g")
    shown_is(ALL[0])

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
    CAST = "(() => { const c = document.querySelector('.keycast'); return c.hidden ? '' : [...c.children].map(k => k.textContent + (k.dataset.n || '')).join(' '); })()"
    check(js(CAST).endswith("3 j"), f"the keys you press show over the table ({js(CAST)!r})")
    check(wait_for(f"{CAST} === ''", 4), "and fade once you stop")
    press("k", "k", "k")
    check(js(CAST) == "k×3", f"a key pressed again shows once, with a count ({js(CAST)!r})")
    press("j", "j", "j", "1", "2")
    pump(1.8)
    check(js(CAST).endswith("1 2"), f"a number waiting for its key stays up ({js(CAST)!r})")
    press("Escape")
    check(js(CAST).endswith("Esc") and wait_for(f"{CAST} === ''", 4), "until it's used or cancelled")
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
    every = len(col.find_cards("deck:*"))
    js("(() => { const i = document.querySelector('.search input'); i.value = ''; "
       "i.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true})); })()")
    check(wait_for(f"{POS} === '1 of {every}'"), f"Enter in an empty box shows every card ({every})")
    check(mw.pm.profile.get("skim.search") == "", "and that's remembered too")
    js("(() => { const i = document.querySelector('.search input'); i.value = 'tag:Neuro'; "
       "i.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true})); })()")
    check(wait_for(f"{POS} === '1 of 4'"), "back to tag:Neuro")

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

    print("from a review")
    col.decks.select(col.decks.id("Topics"))
    for _ in range(2):  # two cards answered Easy today: off today's queue
        done = col.sched.getCard()
        done.start_timer()
        col.sched.answerCard(done, 4)
    studied = col.db.list("select cid from revlog order by id")
    card = col.sched.getCard()
    mw.state = "review"
    mw.reviewer.card = card
    mw.reviewer.state = "question"
    api.open_from_menu()
    check(wait_for(f"{POS} === '3 of 6'"), "Cmd+Shift+B mid-review shows today's review: 2 studied, this card, 3 to come")
    shown_is(card.id)
    check(js("document.querySelector('.source-title').textContent") == "Topics: 2 studied, 4 to go", "named for the deck")
    check(js("document.querySelector('.sides .active').textContent") == "Front", "on the question, Skim shows the front")
    check(api._window._view.ids[:2] == studied, "the studied cards first, in the order you answered them")
    hidden_rows = wait_for("[...document.querySelectorAll('.row')].filter(r => +r.dataset.i >= 2).map(r => r.querySelector('.r-text').textContent).join(' | ')")
    check("[number]" in hidden_rows and "three" not in hidden_rows,
          f"cards still to come don't give their answers away ({hidden_rows})")
    api.on_review_answer(card)
    check(wait_for("document.querySelector('.sides .active').textContent === 'Back'"), "showing the answer flips Skim to the back")
    check(card.id not in api._window._view.hidden, "and the card's row may say what it is")
    card.start_timer()
    col.sched.answerCard(card, 4)
    nxt = col.sched.getCard()
    mw.reviewer.card = nxt
    mw.reviewer.state = "question"
    api.on_review_question(nxt)
    check(wait_for(f"{POS} === '4 of 6' && document.querySelector('.sides .active').textContent === 'Front'"),
          "the next card shows, front first, while Skim follows the review")
    lenses = js("JSON.stringify([...document.querySelectorAll('.lens')].map(b => [b.textContent, b.classList.contains('on')]))")
    check(lenses.startswith('[["All4",false],["This review6",true],["Due') and '"Studied3"' in lenses
          and '"Again0"' in lenses,
          f"the bar has the review's views, with counts, Anki's Today searches among them, on This review ({lenses})")
    press("t")
    check(wait_for("document.querySelector('.lens.on').textContent.startsWith('Due')"), "t goes to the next view")
    api.set_review_lens("studied")
    check(wait_for(f"{POS} === '1 of 3' || {POS} === '3 of 3'"), "Studied today: the three answered cards")
    check(api._window._view.ids == studied + [card.id], "in the order you studied them")
    check(js("document.querySelector('.source-title').textContent") == "Topics: 3 studied today", "and says so")
    third = col.sched.getCard()
    third.start_timer()
    col.sched.answerCard(third, 1)  # Again
    mw.reviewer.card = col.sched.getCard()
    api.on_review_question(mw.reviewer.card)
    check(wait_for("document.querySelector('.source-title').textContent === 'Topics: 4 studied today'"),
          "following keeps the view you chose, and its count goes up")
    check(wait_for("[...document.querySelectorAll('.lens')].some(b => b.textContent === 'Again1')"), "Again counts the card you failed")
    api.set_review_lens("session")
    check(wait_for("document.querySelector('.lens.on').textContent.startsWith('This review')"), "and back to the review")

    js("(() => { const i = document.querySelector('.search input'); i.value = 'tag:Neuro'; "
       "i.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true})); })()")
    wait_for(f"{POS} === '1 of 4'")
    api.on_review_question(nxt)
    pump(0.3)
    check(api._window._view.search == "tag:Neuro", "until you search for something else")
    check(wait_for(f"{LENS_ON} === 'All4'"), "which is All in the bar")
    press("L")
    check(wait_for(f"{LENS_ON}.startsWith('This review')"), "L goes to the view on the right, the review")
    check(api.following(api.REVIEW), "which Skim follows again")
    press("H")
    check(wait_for(f"{LENS_ON} === 'All4'"), "H back to All")
    check(api._window._view.search == "tag:Neuro" and not api.following(api.REVIEW), "on the search you had")

    from skim.tags import Context

    class Queued(Context):
        def status(self, tag):
            return {"Neuro::Brainstem": "queued", "Neuro::Movement": "completed"}.get(tag)

    brain_cards = list(col.find_cards(f"nid:{notes['brainstem']}"))
    api.set_context(Queued)
    check(api._review_topics(col.get_card(brain_cards[0])) == ["Neuro::Brainstem"],
          "with Stepwise, the review's card is read against the topic you've queued")
    check(api._review_topics(col.get_card(movement[0])) == ["Neuro::Movement"], "or else one you've done")
    api.set_context(None)
    mw.state = "deckBrowser"
    mw.reviewer.card = None
    api.open_from_menu()
    check(api._window._view.search == "tag:Neuro", "outside a review, the shortcut opens what Skim showed last")

    print("the bar outside a review")
    api.set_review_lens("due")
    check(wait_for(f"{LENS_ON}.startsWith('Due')"), "the review's views work outside a review too")
    v = api._window._view
    check(v.ids == api._lens_ids("due") and v.title.startswith("Topics: ") and v.source is None,
          f"on the deck selected in Anki, following nothing ({v.title})")
    api.set_review_lens("session")
    check(wait_for(f"{LENS_ON}.startsWith('This review')"), "This review too")
    studied_now, upcoming, _ = api._session(None)
    v = api._window._view
    check(v.ids == studied_now + upcoming and v.select == (upcoming[0] if upcoming else None),
          f"today's studied cards and the deck's queue, on the next one to study ({v.title})")
    check(set(upcoming) <= v.hidden, "the cards to come keep their answers hidden")
    press("q")
    pump(0.3)
    api.open_from_menu()
    check(wait_for(f"{LENS_ON} === 'All4'") and api._window._view.search == "tag:Neuro",
          "closed on another view, the shortcut opens Skim on All")

    print("switching views doesn't wait for the cards")
    asked: list[str] = []
    real_switch = api._window.review_lens
    api._window.review_lens = lambda lens: (asked.append(lens), real_switch(lens))[1]
    # The key and a look at the page in one go, before Python can answer.
    seen = json.loads(js("(() => { window.dispatchEvent(new KeyboardEvent('keydown', {key: 'L', bubbles: true})); "
                         "return JSON.stringify([document.querySelector('.lens.on').textContent, "
                         "document.querySelectorAll('.row.loading').length, "
                         "document.querySelectorAll('.row:not(.loading)').length, "
                         "document.querySelector('.pos').textContent]); })()"))
    check(seen[0].startswith("This review") and seen[1] > 0 and seen[2] == 0 and seen[3] == "",
          f"L moves the bar at once, with placeholder rows until the cards come ({seen})")
    check(wait_for(f"{LENS_ON}.startsWith('This review') && !document.querySelector('.row.loading') && "
                   f"/ of \\d/.test({POS})"), "then the view's rows and card")
    check(asked == ["session"], f"one request ({asked})")
    asked.clear()
    seen = js("(() => { for (let i = 0; i < 3; i++) window.dispatchEvent(new KeyboardEvent('keydown', {key: 'L', bubbles: true})); "
              "return document.querySelector('.lens.on').textContent; })()")
    check(seen.startswith("Edited"), f"three Ls in a row: the bar is on the third view straight away ({seen})")
    check(wait_for("!document.querySelector('.app.switching')") and api._window._view.extra.get("lens") == "edited"
          and js(LENS_ON).startswith("Edited"), "and that's the view that shows")
    check(len(asked) <= 2 and asked[-1] == "edited", f"without asking for each one on the way ({asked})")
    del api._window.review_lens

    print("views keep what they've read")
    calls: list[str] = []
    def counting(raw):
        calls.append(json.loads(raw).get("cmd") if raw.startswith("{") else raw)
        return api._window.bridge.handle(raw)
    api._window.web.set_bridge_command(counting, api._window)
    CHIPS_IN = "![...document.querySelectorAll('.chip')].some(c => c.textContent.includes('…'))"
    SETTLED = f"!document.querySelector('.app.switching') && !document.querySelector('.row.loading') && {CHIPS_IN}"
    api.set_review_lens("all")
    check(wait_for(f"{LENS_ON} === 'All4' && {SETTLED}"), "All, with its rows and filter counts")
    press("L")
    check(wait_for(f"{LENS_ON}.startsWith('This review') && {SETTLED}"), "another view, with its own")
    calls.clear()
    press("H")
    check(wait_for(f"{LENS_ON} === 'All4' && {SETTLED}"), "back to All")
    pump(0.6)  # past the wait for facets
    check("facets" not in calls and "rows" not in calls,
          f"its rows and filter counts are the ones kept from before: nothing asked but the view ({calls})")
    api.on_operation(types.SimpleNamespace(card=True, note_text=False, notetype=False), None)
    check(wait_for(f"{SETTLED}") and "facets" in calls, f"a change to the cards forgets them ({calls})")
    api._window.web.set_bridge_command(api._window.bridge.handle, api._window)
    mw.state = "review"
    mw.reviewer.card = col.sched.getCard() or nxt
    press("q")
    pump(0.3)
    api.open_from_menu()
    check(wait_for(f"{LENS_ON}.startsWith('This review')"), "and in a review, on This review")
    press("t", "t")
    pump(0.3)
    api.open_from_menu()
    check(wait_for(f"{LENS_ON}.startsWith('Added')"), "pressed again while Skim follows the review, it keeps your view")
    press("q")
    pump(0.3)
    api.open_from_menu()
    check(wait_for(f"{LENS_ON}.startsWith('This review')"), "but reopened, it starts on This review again")
    mw.state = "deckBrowser"
    mw.reviewer.card = None
    api.set_review_lens("all")
    check(wait_for(f"{LENS_ON} === 'All4'") and api._window._view.search == "tag:Neuro", "All, from the bar")

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
