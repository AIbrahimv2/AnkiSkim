"""The page's commands that the window test doesn't reach: settings, and
what happens with bad input."""

import json

from harness import ALL, check, col, mw
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

print("settings")
s = call("settings")["settings"]
check(s == {"shortcut": "Ctrl+Shift+B", "defaultSearch": "deck:current", "startSide": "answer", "autoplay": False,
           "waitBelow": 50, "systemDone": 50}, "the defaults")
check(call("save_settings", settings={"waitBelow": 120}).get("problems", {}).get("waitBelow"), "a threshold over 95% is refused")
check(call("save_settings", settings={"systemDone": 0}).get("problems", {}).get("systemDone"), "so is a system done at 0%")
r = call("save_settings", settings={"shortcut": "Ctrl+Shift+Nope"})
check(r.get("problems", {}).get("shortcut"), "a shortcut Qt can't read is refused")
check(mw.addonManager.cfg["shortcut"] == "Ctrl+Shift+B", "and nothing is saved")
r = call("save_settings", settings={**s, "startSide": "question", "autoplay": True})
check(r["saved"] and r["config"] == {"startSide": "question", "autoplay": True, "waitBelow": 50, "systemDone": 50},
      "a change is saved and sent back")
check(host.saved == [{"start_side", "autoplay_audio"}], "the window hears what changed")
r = call("save_settings", settings={**s, "startSide": "question", "autoplay": True})
check(not r["saved"] and len(host.saved) == 1, "saving the same again changes nothing")
print("all passed")
