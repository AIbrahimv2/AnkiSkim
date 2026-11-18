"""Load Skim against a small collection made up for the tests, with a fake
`mw` and offscreen Qt. Imported by the test scripts; run them with
tests/run.sh.

The collection is built fresh in tests/fixture/work/ (gitignored) every run: a
Basic note type with two card types, a Cloze note type, tags in a
hierarchy, a suspended card, a flagged one. No real cards are needed."""

import importlib.util
import json
import os
import shutil
import sys
import types

S = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(os.path.dirname(S), "src")
FIXTURE = os.path.join(S, "fixture", "work")

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
os.environ.setdefault("QTWEBENGINE_CHROMIUM_FLAGS", "--disable-gpu --log-level=3")
# The installed app's Anki, unless this Python has its own (tests/run_on_anki.sh
# runs the tests on another Anki version that way).
if importlib.util.find_spec("aqt") is None:
    sys.path.insert(0, "/Applications/Anki.app/Contents/Resources/app_packages")

shutil.rmtree(FIXTURE, ignore_errors=True)
os.makedirs(FIXTURE)

from aqt.qt import QApplication, QMenu, QTimer, QWidget  # noqa: E402

app = QApplication.instance() or QApplication(["skim-test"])

import aqt  # noqa: E402

APP = os.path.dirname(os.path.dirname(aqt.__file__))  # this Anki's packages, with _aqt's web files
from anki.collection import Collection  # noqa: E402

col = Collection(os.path.join(FIXTURE, "collection.anki2"))


def add_notes() -> dict:
    """A few notes; returns their ids by name."""
    basic = col.models.by_name("Basic (and reversed card)")
    cloze = col.models.by_name("Cloze")
    deck = col.decks.id("Topics")
    made = {}

    def add(model, fields, tags, name):
        note = col.new_note(model)
        for i, f in enumerate(fields):
            note.fields[i] = f
        note.tags = tags
        col.add_note(note, deck)
        made[name] = note.id

    add(basic, ["<b>Heart</b> chambers?<br>Count them", "Four"], ["Cardio::Anatomy"], "heart")
    add(basic, ["Valve between LA and LV?", "Mitral"], ["Cardio::Anatomy::Valves"], "mitral")
    add(cloze, ["The {{c1::brainstem}} has {{c2::three::number}} parts", "Extra"], ["Neuro::Brainstem"], "brainstem")
    add(basic, ["Dopamine pathway in Parkinson's?", "Nigrostriatal"], ["Neuro::Movement"], "parkinson")
    return made


notes = add_notes()
ALL = list(col.find_cards("deck:Topics", order="c.id"))
# Suspend the mitral cards; flag the first heart card red.
mitral = list(col.find_cards(f"nid:{notes['mitral']}"))
col.sched.suspend_cards(mitral)
col.set_user_flag_for_cards(1, [ALL[0]])


class FakeAddonManager:
    def __init__(self):
        self.cfg = json.load(open(os.path.join(SRC, "config.json")))
        self.writes = 0

    def getConfig(self, module):
        return json.loads(json.dumps(self.cfg))

    def writeConfig(self, module, cfg):
        self.writes += 1
        self.cfg = json.loads(json.dumps(cfg))

    def setConfigAction(self, module, fn):
        self.config_action = fn

    def setWebExports(self, module, pattern):
        self.web_exports = pattern


mw = QWidget()
mw.col = col
mw.addonManager = FakeAddonManager()
mw.form = types.SimpleNamespace(menuTools=QMenu())
mw.pm = types.SimpleNamespace(profile={}, minimalist_mode=lambda: False, reduce_motion=lambda: False)
mw.prepare_card_text_for_display = lambda text: col.media.escape_media_filenames(text)
mw.progress = types.SimpleNamespace(single_shot=lambda ms, fn, *a, **k: QTimer.singleShot(ms, fn))
mw.reviewer = types.SimpleNamespace(
    revHtml=lambda: '<div id="_mark" hidden>&#x2605;</div><div id="_flag" hidden>&#x2691;</div><div id="qa"></div>')
aqt.mw = mw

# Import the add-on under a name without a hyphen.
pkg_link = os.path.join(FIXTURE, "pkgs", "skim")
os.makedirs(os.path.dirname(pkg_link), exist_ok=True)
os.symlink(SRC, pkg_link)
sys.path.insert(0, os.path.dirname(pkg_link))

import skim  # noqa: E402,F401
from skim import api, bridge, cards, config, viewstate, window  # noqa: E402,F401

window.restoreGeom = window.saveGeom = lambda *a, **k: None


def check(cond, what: str) -> None:
    if not cond:
        raise AssertionError(what)
    print(f"  ok  {what}")


def pump(seconds: float = 0.05) -> None:
    import time

    end = time.time() + seconds
    while time.time() < end:
        app.processEvents()
        time.sleep(0.005)
