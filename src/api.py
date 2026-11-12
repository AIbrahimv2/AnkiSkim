# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 AIbrahimv2
"""Skim's API for other add-ons, published as `aqt.mw.skim`.

Look it up when you need it (add-ons load in any order), and check it's
there, since Skim may not be installed:

    skim = getattr(aqt.mw, "skim", None)
    if skim:
        skim.open(search='"tag:Pixorize::Brainstem"', card_ids=ids,
                  title="Brainstem", source="Stepwise")

`card_ids` is optional. Passing them skips Anki's search, which for a tag
reads every note (well over 100 ms on a big collection). `search` is then
only shown, and used if you open the cards in Anki's browser.

`source` names who opened Skim. While the window still shows that source's
cards, `follow()` with the same source swaps in new ones without taking
focus (Stepwise does this as you move through topics); once you search for
something else in Skim, it stops following. `p` in Skim goes back to the
window that opened it.
"""

from __future__ import annotations

from collections.abc import Sequence

from aqt import mw
from aqt.qt import QAction, QApplication, QKeySequence

from .window import SkimWindow

VERSION = 1

_window: SkimWindow | None = None
_action: QAction | None = None


def _get() -> SkimWindow:
    global _window
    if _window is None:
        _window = SkimWindow()
    return _window


def open(*, search: str | None = None, card_ids: Sequence[int] | None = None,
         title: str | None = None, source: str | None = None, focus: bool = True) -> None:
    """Show Skim on these cards (or, with neither `search` nor `card_ids`,
    on whatever it showed last) and give it the keys."""
    if mw.col is None:
        return
    window = _get()
    # p goes back to the add-on window that asked (Stepwise), not to Anki's
    # main window when you open Skim from the Tools menu.
    opener = QApplication.activeWindow() if source else None
    window.show_cards(search=search, card_ids=card_ids, title=title, source=source,
                      opener=opener if opener is not window else None)
    window.present(focus)


def follow(*, search: str, card_ids: Sequence[int] | None = None, title: str | None = None,
           source: str) -> bool:
    """If Skim is open on `source`'s cards, show these instead, without
    taking focus. Returns whether it did. Cheap to call on every move."""
    if _window is None or not _window.following(source):
        return False
    _window.follow(search=search, card_ids=card_ids, title=title, source=source)
    return True


def is_open() -> bool:
    return _window is not None and _window.isVisible()


def following(source: str) -> bool:
    return _window is not None and _window.following(source)


# --- for Skim itself ------------------------------------------------------------


def open_from_menu() -> None:
    open()


def prewarm() -> None:
    """Make the window and load its page while nothing else is happening,
    so the first open is as quick as the rest."""
    if mw.col is not None:
        _get().load()


def set_action(action: QAction) -> None:
    global _action
    _action = action


def set_shortcut(shortcut: str) -> None:
    if _action is not None:
        _action.setShortcut(QKeySequence(shortcut) if shortcut else QKeySequence())


def open_settings() -> None:
    open()
    if _window is not None:
        _window.push({"type": "settings"})


def on_operation(changes, handler) -> None:
    if _window is not None and handler is not _window:
        _window.on_operation(changes)


def on_theme_change() -> None:
    if _window is not None:
        _window.reload()


def close() -> None:
    """The profile is closing: the window belongs to its collection."""
    global _window
    window, _window = _window, None
    if window is not None:
        window.close()
        window.cleanup()
        window.deleteLater()
