"""The page's commands that the window test doesn't reach: settings, and
what happens with bad input."""

import json

from harness import ALL, check, col, mw
from skim import api, settings_page
from skim.bridge import MAX_BATCH, Bridge
from skim.tags import Analyzer
from skim.viewstate import ViewState


class Host:
    def __init__(self):
        self.col = col
        self.state = ViewState()
        self.saved = []

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
check(call("rows", ids=ALL[:1])["reading"] == "Cardio", "rows say their reading too")

print("layout")
call("layout", share=0.3)
check(host.saved_layout == {"share": 0.3}, "the table's width is saved")
call("layout", split=0.45678, tags=False)
check(host.saved_layout == {"share": 0.3, "split": 0.457, "tags": False}, "the card's height and the tags pane join it")
call("layout", share=0.05, split=True, tags="no")
check(host.saved_layout == {"share": 0.3, "split": 0.457, "tags": False}, "out of range or the wrong type: kept as it was")
call("layout", reset=True)
check(host.saved_layout == {}, "Reset layout forgets it all")

print("settings")
got = call("settings")
s = got["settings"]
check(s == {"shortcut": "Ctrl+Shift+B", "defaultSearch": "deck:current", "startSide": "answer", "autoplay": False,
           "waitBelow": 50, "systemDone": 50}, "the defaults")
check(got["defaults"] == s, "and Restore defaults knows them")
check(call("save_settings", settings={"waitBelow": 120}).get("problems", {}).get("waitBelow"), "a threshold over 95% is refused")
check(call("save_settings", settings={"systemDone": 0}).get("problems", {}).get("systemDone"), "so is a system done at 0%")
r = call("save_settings", settings={"shortcut": "Ctrl+Shift+Nope"})
check(r.get("problems", {}).get("shortcut"), "a shortcut Qt can't read is refused")
check(mw.addonManager.cfg["shortcut"] == "Ctrl+Shift+B", "and nothing is saved")
r = call("save_settings", settings={**s, "startSide": "question", "autoplay": True})
check(r["saved"] and r["config"] == {"startSide": "question", "autoplay": True, "waitBelow": 50, "systemDone": 50},
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
                                                 "systemDone": 50}}], w.pushed)
settings_page.handle({"cmd": "save_settings", "settings": {**s, "shortcut": "Ctrl+Shift+K", "autoplay": True}})
check(len(w.pushed) == 1, "and hears nothing when nothing changed")
check(settings_page.PAGE["bridge"] is settings_page.handle and settings_page.PAGE["script"] == "web/settings.js",
      "kit.register gets the panel")
api._window = real_window
print("all passed")
