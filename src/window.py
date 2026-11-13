# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 AIbrahimv2
"""The Skim window: a dialog hosting the page (built from web/ into
src/web/) in one AnkiWebView, wired to `Bridge` for data.

The page draws cards in a ring of frames, each a copy of Anki's reviewer
page (`frame_html`), so the next cards are on screen before you ask for
them. The window is made once, ahead of time (see api.prewarm), and only
hidden when closed, so opening it again is instant.
"""

from __future__ import annotations

import json
import os
import time

import aqt
from aqt import gui_hooks, mw
from aqt.qt import QDialog, Qt, QTimer, QVBoxLayout, qconnect, sip
from aqt.sound import av_player, play_clicked_audio
from aqt.theme import theme_manager
from aqt.utils import disable_help_button, restoreGeom, saveGeom, setWindowIcon
from aqt.webview import AnkiWebView

from . import frame
from .bridge import Bridge
from .config import ADDON, get_config
from .tags import Analyzer
from .viewstate import ViewState

GEOM_KEY = "skim"
SEARCH_KEY = "skim.search"
LAYOUT_KEY = "skim.layout"
WEB_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "web")
# Stepwise moving its cursor sends a new topic per key; show the latest at
# most this often.
FOLLOW_EVERY = 0.04

def asset_url(name: str) -> str:
    """URL for a built asset, versioned by mtime so a rebuild is never
    served from cache."""
    try:
        v = int(os.path.getmtime(os.path.join(WEB_DIR, name)))
    except OSError:
        v = 0
    return f"/_addons/{ADDON}/web/{name}?v={v}"


def _profile() -> dict:
    profile = getattr(getattr(mw, "pm", None), "profile", None)
    return profile if isinstance(profile, dict) else {}


def _alive(widget) -> bool:
    return widget is not None and not sip.isdeleted(widget) and widget.isVisible()


class SkimWindow(QDialog):
    def __init__(self) -> None:
        super().__init__(None, Qt.WindowType.Window)
        self.setWindowTitle("Skim")
        disable_help_button(self)
        setWindowIcon(self)
        self.setMinimumSize(560, 420)
        self.resize(1180, 780)
        restoreGeom(self, GEOM_KEY)

        self.bridge = Bridge(self)
        self.web = AnkiWebView(self, title="skim")
        self.web.set_bridge_command(self.bridge.handle, self)
        self.web.setPlaybackRequiresGesture(not get_config()["autoplay_audio"])
        lay = QVBoxLayout(self)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.addWidget(self.web)

        self._loaded = False
        self._dirty = False
        self._view = ViewState()
        self._analyzer: tuple[tuple, Analyzer] | None = None
        self._context_version = 0
        self._opener = None
        self._back_label: str | None = None
        self._pending: dict | None = None
        self._last_follow = 0.0
        self._follow_timer = QTimer(self)
        self._follow_timer.setSingleShot(True)
        qconnect(self._follow_timer.timeout, self._flush_follow)

    # --- host interface for Bridge -------------------------------------------

    @property
    def col(self):
        return mw.col

    def prepare(self, text: str) -> str:
        return mw.prepare_card_text_for_display(text)

    def hook(self, text: str, card, kind: str) -> str:
        return gui_hooks.card_will_show(text, card, kind)

    def body_class(self, ord_: int) -> str:
        return theme_manager.body_classes_for_card_ord(ord_)

    def view(self) -> dict:
        back = (self._back_label or self._opener.windowTitle()) if _alive(self._opener) else None
        return self._view.as_dict(back)

    def analyzer(self) -> Analyzer:
        """Reads the view's cards against its topic. Made once per view (and
        again when settings or Stepwise's plan change): it caches every tag
        it reads, and a topic's cards share most of theirs."""
        from . import api

        wait = get_config()["wait_below_percent"] / 100
        key = (self._view.seq, wait, self._context_version)
        if self._analyzer is None or self._analyzer[0] != key:
            self._analyzer = (key, Analyzer(self._view.topics, api.context(), wait))
        return self._analyzer[1]

    def ids(self) -> list[int]:
        return self._view.ids

    def hidden(self) -> set[int]:
        return self._view.hidden

    def reveal(self, cid: int) -> None:
        """The reviewer showed a card's answer: so does Skim."""
        self._view.hidden.discard(cid)
        self._view.side = "answer"
        self.push({"type": "reveal", "cid": cid})

    def context_changed(self) -> None:
        """Stepwise's plan changed (a topic queued or done): statuses and
        verdicts are read again."""
        self._context_version += 1
        if self.isVisible():
            self.push({"type": "retag"})
        else:
            self._dirty = True

    def frame_html(self) -> str:
        return frame.document(
            base_url=mw.serverURL(),
            night=theme_manager.night_mode,
            standard_css=self.web.standard_css(),
            body_class=theme_manager.body_class(reviewer=True),
            reviewer_html=mw.reviewer.revHtml(),
        )

    def layout(self) -> dict:
        saved = _profile().get(LAYOUT_KEY)
        return saved if isinstance(saved, dict) else {}

    def save_layout(self, layout: dict) -> None:
        _profile()[LAYOUT_KEY] = layout

    def run_search(self, query: str) -> dict:
        """A search typed in the window: it stops following whoever opened
        it, and is what Skim reopens on next time."""
        query = query.strip()
        _profile()[SEARCH_KEY] = query
        self._view.set(mw.col, search=query)
        return self.view()

    def edit(self, cid: int) -> None:
        if not cid:
            return
        search = self._view.search or f"cid:{cid}"
        browser = aqt.dialogs.open("Browser", mw, search=(search,))
        try:
            browser.table.select_single_card(cid)
        except Exception:
            pass

    def back(self) -> None:
        if _alive(self._opener):
            self._opener.raise_()
            self._opener.activateWindow()

    def close_window(self) -> None:
        self.close()

    def replay(self, cid: int, side: str) -> None:
        try:
            card = mw.col.get_card(cid)
        except Exception:
            return
        av_player.play_tags(card.question_av_tags() if side == "question" else card.answer_av_tags())

    def play(self, cid: int, tag: str) -> None:
        try:
            play_clicked_audio(tag, mw.col.get_card(cid))
        except Exception:
            pass

    def settings_saved(self, cfg: dict, changed: set) -> None:
        from . import api

        if "shortcut" in changed:
            api.set_shortcut(cfg["shortcut"])
        if "autoplay_audio" in changed:
            self.web.setPlaybackRequiresGesture(not cfg["autoplay_audio"])
        # The reply carries the page's config, and the page reads the rows
        # again if the wait threshold changed.

    # --- what the window shows -------------------------------------------------

    def show_cards(self, *, search: str | None = None, card_ids=None, title: str | None = None,
                   source: str | None = None, topics=None, select: int | None = None,
                   ordered: bool = False, side: str | None = None, hidden=None,
                   opener=None, back_label: str | None = None) -> None:
        """Show these cards; with neither a search nor ids, what showed last
        (or, the first time, the last search typed here or the default)."""
        if search is None and card_ids is None and not self._view.seq:
            saved = _profile().get(SEARCH_KEY)
            search = saved if isinstance(saved, str) and saved else get_config()["default_search"]
        if search is not None or card_ids is not None:
            self._view.set(mw.col, search=search or "", ids=card_ids, title=title, source=source,
                           topics=topics, select=select, ordered=ordered, side=side, hidden=hidden)
        if opener is not None and opener is not self:
            self._opener = opener
            self._back_label = back_label
        self.push({"type": "view", "view": self.view()})

    def following(self, source: str) -> bool:
        return self.isVisible() and self._view.source == source

    def follow(self, **view) -> None:
        """Show another set of cards without taking focus, at most every
        FOLLOW_EVERY seconds (the latest wins)."""
        self._pending = view
        if self._follow_timer.isActive():
            return
        wait = FOLLOW_EVERY - (time.monotonic() - self._last_follow)
        if wait <= 0:
            self._flush_follow()
        else:
            self._follow_timer.start(int(wait * 1000) + 1)

    def _flush_follow(self) -> None:
        view, self._pending = self._pending, None
        if view is not None:
            self._last_follow = time.monotonic()
            self.show_cards(**view)

    def present(self, focus: bool = True) -> None:
        if not self._loaded:
            self.load()
        self.show()
        if focus:
            self.raise_()
            self.activateWindow()
            self.web.setFocus()

    # --- page ------------------------------------------------------------------

    def load(self) -> None:
        if self._loaded:
            return
        self._loaded = True
        self.web.stdHtml(
            '<div id="root"></div>',
            css=[asset_url("skim.css")],
            js=[asset_url("skim.js")],
            context=self,
        )

    def reload(self) -> None:
        """Theme changed: the card frames are rebuilt with the new colours."""
        if self._loaded:
            self._loaded = False
            self.load()

    def push(self, event: dict) -> None:
        if self._loaded:
            self.web.eval(f"window.skim && window.skim.push({json.dumps(event)});")

    def on_operation(self, changes) -> None:
        if any(getattr(changes, k, False) for k in ("card", "note_text", "notetype")):
            if self.isVisible():
                self.push({"type": "changed"})
            else:
                self._dirty = True

    def showEvent(self, ev) -> None:
        super().showEvent(ev)
        if self._dirty:
            self._dirty = False
            self.push({"type": "changed"})
        self.push({"type": "shown", "back": self.view()["back"]})

    def closeEvent(self, ev) -> None:
        saveGeom(self, GEOM_KEY)
        self.push({"type": "hidden"})
        super().closeEvent(ev)

    def keyPressEvent(self, ev) -> None:
        # The page handles keys (Esc closes from there); don't let the
        # dialog close on an Esc the page didn't take.
        if ev.key() == Qt.Key.Key_Escape:
            ev.accept()
            return
        super().keyPressEvent(ev)

    def cleanup(self) -> None:
        self._follow_timer.stop()
        self.web.cleanup()
