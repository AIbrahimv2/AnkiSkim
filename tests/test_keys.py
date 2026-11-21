"""b and e (keys.py): Skim takes Anki's b, and e in a review, moving Anki's
browser and editor to Cmd/Ctrl+Shift+B and E; the setting gives them back.
With the harness's stand-in main window: Anki's b is a shortcut on it, as
in Anki (aqt/main.py, setupKeys), and a review's keys go through the hook
the way Anki's setStateShortcuts sends them."""

import json

from harness import check, mw
from aqt.qt import QAction, QKeySequence, QShortcut
from skim import api, config, keys, settings_page

opened, edits, drawn, review_keys = [], [], [], []
api.open_from_menu = lambda: opened.append(1)
mw.onEditCurrent = lambda: edits.append(1)
mw.toolbar = type("Toolbar", (), {"draw": lambda self: drawn.append(1)})()
mw.state = "deckBrowser"


def anki_edit():
    pass


def anki_review_keys():
    return [("e", anki_edit), ("u", lambda: None)]


def set_review_keys(shortcuts):
    keys.on_state_shortcuts(mw.state, shortcuts)
    # Anki's applyShortcuts: one shortcut a key, the last one wins.
    review_keys[:] = [{QKeySequence(k).toString(): fn for k, fn in shortcuts}]


mw.reviewer.card = None
mw.reviewer._shortcutKeys = anki_review_keys
mw.clearStateShortcuts = lambda: None
mw.setStateShortcuts = set_review_keys


def bound(shortcuts):
    out = list(shortcuts)
    keys.on_state_shortcuts("review", out)
    return {QKeySequence(k).toString(): fn for k, fn in out}


def key(seq) -> str:
    return seq.toString()


B, BROWSE, EDIT = key(QKeySequence("b")), key(QKeySequence(keys.BROWSE)), key(QKeySequence(keys.EDIT))

print("as Anki starts")
anki_b = QShortcut(QKeySequence("b"), mw)
other = QShortcut(QKeySequence("d"), mw)
action = QAction("Skim", mw)
keys.install(action)
check(config.get_config()["b_and_e"], "b and e open Skim unless you turn it off")
check(key(anki_b.key()) == BROWSE, f"Anki's browser moves to {BROWSE}")
check(key(other.key()) == "D", "Anki's other keys stay where they are")
check(keys._skim_b is not None and key(keys._skim_b.key()) == B and keys._skim_b.isEnabled(), "b is Skim's")
check(action.shortcut().isEmpty(), "and Tools → Skim needs no shortcut of its own")
keys._skim_b.activated.emit()
check(opened == [1], "b opens Skim")

print("a review")
keys_now = bound(anki_review_keys())
check(keys_now["E"] is api.edit_from_review, "e edits the card in Skim")
check(keys_now[EDIT] is mw.onEditCurrent, f"and {EDIT} in Anki's editor")
check(keys_now["U"] is not None and len(keys_now) == 3, "the review's other keys are Anki's")
overview = [("e", anki_edit)]
keys.on_state_shortcuts("overview", overview)
check(overview == [("e", anki_edit)], "e elsewhere (emptying a filtered deck) is left alone")

print("Anki's toolbar")
import anki.lang

anki.lang.set_lang("en")  # as Anki does at startup: tr needs a language
from aqt.utils import tr

browse_link = f'<a id="browse" title="{tr.actions_shortcut_key(val="B")}">Browse</a>'
links = ['<a id="decks">Decks</a>', browse_link]
keys.on_toolbar_links(links, None)
check(links[0] == '<a id="decks">Decks</a>' and keys.native(keys.BROWSE) in links[1] and 'id="browse"' in links[1],
      f"Browse says which key opens Anki's browser ({links[1]})")

print("off, in Settings")
mw.state = "review"
reply = settings_page.handle({"cmd": "settings"})
check(reply["settings"]["bAndE"] is True and reply["defaults"]["bAndE"] is True, "Settings shows it, on by default")
settings = {**reply["settings"], "bAndE": False}
reply = settings_page.handle({"cmd": "save_settings", "settings": settings})
check(reply.get("saved") and config.get_config()["b_and_e"] is False, f"turned off and saved ({json.dumps(reply)[:80]})")
check(key(anki_b.key()) == B and not keys._skim_b.isEnabled(), "Anki has its b back")
check(key(action.shortcut()) == key(QKeySequence("Ctrl+Shift+B")), "and Skim its shortcut")
check(review_keys and review_keys[0]["E"] is anki_edit and EDIT not in review_keys[0],
      "the review on screen has Anki's e back at once")
check(drawn, "and the toolbar is drawn again")
check(bound(anki_review_keys())["E"] is anki_edit, "the next review too")
links = ['<a id="decks">Decks</a>', browse_link]
keys.on_toolbar_links(links, None)
check(links[1] == browse_link, "Browse says B again")

print("on again")
reply = settings_page.handle({"cmd": "save_settings", "settings": {**settings, "bAndE": True}})
check(key(anki_b.key()) == BROWSE and keys._skim_b.isEnabled() and action.shortcut().isEmpty(), "Skim has b again")
check(review_keys[0]["E"] is api.edit_from_review, "and the review's e")

print("e off a review")
mw.state = "overview"
api.edit_from_review()
check(edits == [1], "opens Anki's editor, there being no review card")
print("all passed")
