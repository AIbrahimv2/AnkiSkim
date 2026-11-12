"""The page's commands that the window test doesn't reach: settings, and
what happens with bad input."""

import json

from harness import ALL, check, col, mw
from skim.bridge import MAX_BATCH, Bridge
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

print("settings")
s = call("settings")["settings"]
check(s == {"shortcut": "Ctrl+Shift+B", "defaultSearch": "deck:current", "startSide": "answer", "autoplay": False},
      "the defaults")
r = call("save_settings", settings={"shortcut": "Ctrl+Shift+Nope"})
check(r.get("problems", {}).get("shortcut"), "a shortcut Qt can't read is refused")
check(mw.addonManager.cfg["shortcut"] == "Ctrl+Shift+B", "and nothing is saved")
r = call("save_settings", settings={**s, "startSide": "question", "autoplay": True})
check(r["saved"] and r["config"] == {"startSide": "question", "autoplay": True}, "a change is saved and sent back")
check(host.saved == [{"start_side", "autoplay_audio"}], "the window hears what changed")
r = call("save_settings", settings={**s, "startSide": "question", "autoplay": True})
check(not r["saved"] and len(host.saved) == 1, "saving the same again changes nothing")
print("all passed")
