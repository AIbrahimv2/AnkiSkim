"""The page's commands that the window test doesn't reach: settings, and
what happens with bad input."""

import json

from harness import ALL, check, col, mw, notes
from skim import api, settings_page
from skim.bridge import MAX_BATCH, Bridge
from skim.tags import Analyzer
from skim.viewstate import ViewState


class Host:
    def __init__(self):
        self.col = col
        self.state = ViewState()
        self.saved = []
        self.changes = []
        self.browsed = []

    def prepare(self, text):
        return text

    def hook(self, text, card, kind):
        return text

    def body_class(self, ord_):
        return "card"

    def view(self):
        return self.state.as_dict()

    def ids(self):
        return self.state.ids

    def analyzer(self):
        return Analyzer(self.state.topics)

    def run_search(self, query):
        self.state.set(col, search=query)
        return self.view()

    def settings_saved(self, cfg, changed):
        self.saved.append(changed)

    saved_layout: dict = {}

    def layout(self):
        return self.saved_layout

    def save_layout(self, layout):
        self.saved_layout = layout

    def changed(self, changes):
        self.changes.append(changes)

    def browse(self, cid):
        self.browsed.append(cid)


host = Host()
b = Bridge(host)
call = lambda cmd, **kw: b.handle(json.dumps({"cmd": cmd, **kw}))  # noqa: E731

print("plumbing")
check(b.handle("domDone") is None, "Anki's own messages are ignored")
check("error" in call("nope"), "an unknown command says so")
check(call("search", query="tag:(")["view"]["error"], "a bad search comes back as the view's error")
many = call("rows", ids=ALL * 200)
check(len(many["rows"]) == len(ALL), f"rows are capped at {MAX_BATCH} ids a call, duplicates once")
check(call("rows", ids=["x", None, ALL[0]])["rows"].keys() == {str(ALL[0])}, "junk ids are skipped")
check(len(call("cards", ids=ALL)["cards"]) == len(ALL), "cards render in batches")
cardio = call("search", query="tag:Cardio")["view"]
part = call("facets", seq=cardio["seq"], ids=[cardio["ids"][3], cardio["ids"][1]])
check(part["ids"] == [cardio["ids"][3], cardio["ids"][1]] and len(part["facets"]["state"]) == 2,
      "facets come for the cards asked for, in that order")
check(part["reading"] == cardio["reading"] == "Cardio", "named for what they were read against")
check(call("facets", seq=cardio["seq"] - 1, ids=ALL).get("stale"), "and not for a view that's gone")
part = call("facets", seq=cardio["seq"], ids=cardio["ids"][:2], extra=["lapses", "nope", 3])
check(part["facets"]["lapses"] == [0, 0] and "nope" not in part["facets"],
      "a scheduling column's sort values come when asked for, and nothing else does")
check(call("rows", ids=ALL[:1])["reading"] == "Cardio", "rows say their reading too")

print("editing a note")
brain = sorted(col.find_cards(f"nid:{notes['brainstem']}"), key=lambda c: col.get_card(c).ord)
got = call("note", cid=brain[1])["note"]
check(got["nid"] == notes["brainstem"] and got["cloze"] and got["card"] == "Cloze 2", "a card's note, and which card it is")
check([f["name"] for f in got["fields"]] == ["Text", "Back Extra"] and got["fields"][0]["html"].startswith("The {{c1::"),
      "its fields by name, as they're stored")
check(call("note", cid=1)["note"] is None, "a card that's gone has none")
r = call("save", nid=got["nid"], fields={"1": "Extra"})
check(r == {"saved": False, "problem": None} and not host.changes, "saving what's there already writes nothing")
r = call("save", nid=got["nid"], fields={"1": "More <b>here</b>", "9": "x", "no": "y"})
check(r["saved"] and len(host.changes) == 1, "a changed field is written, and Anki hears of it")
after = col.get_note(got["nid"]).fields
check(after == ["The {{c1::brainstem}} has {{c2::three::number}} parts", "More <b>here</b>"],
      "only that field; ones the note doesn't have are skipped")
r = call("save", nid=got["nid"], fields={"0": "No cloze now", "1": "<br>"})
check(r["problem"] and "cloze" in r["problem"].lower(), "a cloze note left with no cloze says so")
check(col.get_note(got["nid"]).fields[1] == "", "and a field emptied in the page is empty")
call("save", nid=got["nid"], fields={"0": "The {{c1::brainstem}} has {{c2::three::number}} parts", "1": "Extra"})
check(call("save", nid=1, fields={"0": "x"}) == {"gone": True}, "a note that's gone can't be saved")
check("error" in call("save", nid=got["nid"], fields=["x"]) and "error" in call("save", nid=got["nid"], fields={"0": 5}),
      "nor anything that isn't fields")
png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
r = call("media", mime="image/png", name="My shot.png", data=png)
check(r.get("src", "").endswith(".png") and col.media.have(r["src"].replace("%20", " ")), f"a pasted image goes into the media folder ({r})")
check("error" in call("media", mime="text/html", data=png) and "error" in call("media", mime="image/png", data="@@"),
      "only images, and only real ones")
check(call("undo") == {"empty": True}, "a host with no undo has nothing to undo")
host.undo = lambda redo=False: {"message": "redone" if redo else "undone"}
check(call("undo")["message"] == "undone" and call("undo", redo=True)["message"] == "redone" and
      call("undo", redo="yes")["message"] == "undone", "u undoes, and only a true redo redoes")
del host.undo
call("browse", cid=brain[0])
check(host.browsed == [brain[0]], "B asks for Anki's browser")

print("layout")
call("layout", share=0.3)
check(host.saved_layout == {"share": 0.3}, "the table's width is saved")
call("layout", split=0.45678, tags=False)
check(host.saved_layout == {"share": 0.3, "split": 0.457, "tags": False}, "the card's height and the tags pane join it")
call("layout", share=0.05, split=True, tags="no")
check(host.saved_layout == {"share": 0.3, "split": 0.457, "tags": False}, "out of range or the wrong type: kept as it was")
call("layout", cols={"ret": False, "lapses": True, "Bad Key": True, "due": "yes"})
check(host.saved_layout.get("cols") == {"ret": False, "lapses": True},
      "the columns you turn on and off are saved, without what isn't a column's key or a yes or no")
call("layout", order=["num", "ret", "text", "deck"])
check(host.saved_layout.get("order") == ["num", "ret", "text", "deck"], "the order you drag the columns into is saved")
call("layout", order=["num", "num"])
call("layout", order=["num", 3])
check(host.saved_layout.get("order") == ["num", "ret", "text", "deck"], "an order with a key twice, or not a key: kept as it was")
call("layout", reset=True)
check(host.saved_layout == {"cols": {"ret": False, "lapses": True}, "order": ["num", "ret", "text", "deck"]},
      "Reset layout forgets the rest, not the columns or their order")
call("layout", cols={}, order=[])
check(host.saved_layout == {}, "Default columns forgets them")
call("layout", cols={str(i): True for i in range(40)})
check(host.saved_layout == {}, "too many columns: kept as it was")

print("settings")
got = call("settings")
s = got["settings"]
check(s == {"shortcut": "Ctrl+Shift+B", "defaultSearch": "deck:current", "startSide": "answer", "autoplay": False,
           "waitBelow": 50, "systemDone": 50, "size": 100, "pasteHeight": 150}, "the defaults")
check(got["defaults"] == s, "and Restore defaults knows them")
check(call("save_settings", settings={"waitBelow": 120}).get("problems", {}).get("waitBelow"), "a threshold over 95% is refused")
check(call("save_settings", settings={"systemDone": 0}).get("problems", {}).get("systemDone"), "so is a system done at 0%")
check(call("save_settings", settings={"size": 300}).get("problems", {}).get("size"), "and a size over 200%")
check(call("save_settings", settings={"pasteHeight": 5}).get("problems", {}).get("pasteHeight"), "and a pasted picture 5 pixels high")
r = call("save_settings", settings={"shortcut": "Ctrl+Shift+Nope"})
check(r.get("problems", {}).get("shortcut"), "a shortcut Qt can't read is refused")
check(mw.addonManager.cfg["shortcut"] == "Ctrl+Shift+B", "and nothing is saved")
r = call("save_settings", settings={**s, "startSide": "question", "autoplay": True})
check(r["saved"] and r["config"] == {"startSide": "question", "autoplay": True, "waitBelow": 50, "systemDone": 50,
                                     "pasteHeight": 150},
      "a change is saved and sent back")
check(r["settings"]["startSide"] == "question", "with Settings as saved")
check(host.saved == [{"start_side", "autoplay_audio"}], "the window hears what changed")
r = call("save_settings", settings={**s, "startSide": "question", "autoplay": True})
check(not r["saved"] and len(host.saved) == 1, "saving the same again changes nothing")

print("settings in the kit's window")
real_window = api._window
api._window = None
check(settings_page.handle({"cmd": "settings"})["settings"]["startSide"] == "question", "read without a Skim window")
check("error" in settings_page.handle({"cmd": "rows", "ids": ALL}), "only Settings' commands")
r = settings_page.handle({"cmd": "save_settings", "settings": {**s, "shortcut": "Ctrl+Shift+K"}})
check(r["saved"] and mw.addonManager.cfg["shortcut"] == "Ctrl+Shift+K", "saved without a Skim window")


class Window:
    def __init__(self):
        self.pushed, self.saved = [], []

    def push(self, e):
        self.pushed.append(e)

    def settings_saved(self, cfg, changed):
        self.saved.append(changed)


w = Window()
api._window = w
settings_page.handle({"cmd": "save_settings", "settings": {**s, "shortcut": "Ctrl+Shift+K", "autoplay": True}})
check(w.saved == [{"autoplay_audio"}], "an open window applies what changed")
check(w.pushed == [{"type": "config", "config": {"startSide": "answer", "autoplay": True, "waitBelow": 50,
                                                 "systemDone": 50, "pasteHeight": 150}}], w.pushed)
settings_page.handle({"cmd": "save_settings", "settings": {**s, "shortcut": "Ctrl+Shift+K", "autoplay": True}})
check(len(w.pushed) == 1, "and hears nothing when nothing changed")
check(settings_page.PAGE["bridge"] is settings_page.handle and settings_page.PAGE["script"] == "web/settings.js",
      "kit.register gets the panel")
api._window = real_window
print("all passed")
