# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 AIbrahimv2
"""b and e open Skim: b in Anki's main window, instead of Anki's browser,
and e in a review, which edits the card in Skim instead of in Anki's
editor. Anki's browser moves to Cmd/Ctrl+Shift+B (Skim's own shortcut,
which it doesn't need while it has b) and its editor to Cmd/Ctrl+Shift+E.
With the setting off (`b_and_e`), Anki has its keys back and Skim opens
with its shortcut setting.

Anki binds b once, as its main window starts: a shortcut on the window,
found here and given the other key. e is bound each time a review starts
(state_shortcuts_will_change), where the last binding for a key wins. Both
belong to Anki's main window, so they never fire in Skim's, which is a
window of its own."""

from __future__ import annotations

from aqt import mw
from aqt.qt import QAction, QKeySequence, QShortcut, qconnect

from .config import get_config

# Anki's browser and editor, while Skim has b and e.
BROWSE = "Ctrl+Shift+B"
EDIT = "Ctrl+Shift+E"

_action: QAction | None = None  # Tools → Skim
_anki_b: QShortcut | None = None  # Anki's b, which opens its browser
_skim_b: QShortcut | None = None


def install(action: QAction) -> None:
    """Once Anki's main window has made its keys (main_window_did_init)."""
    global _action, _anki_b, _skim_b
    from . import api

    _action = action
    b = QKeySequence("b")
    _anki_b = next((s for s in mw.findChildren(QShortcut) if s.key() == b), None)
    if _anki_b is not None:  # else an Anki without it: Skim keeps its shortcut
        _skim_b = QShortcut(b, mw)
        _skim_b.setAutoRepeat(False)
        qconnect(_skim_b.activated, api.open_from_menu)
    apply(get_config(), redraw=False)


def has_b(cfg: dict) -> bool:
    return bool(cfg["b_and_e"]) and _anki_b is not None


def apply(cfg: dict, redraw: bool = True) -> None:
    """Give b and e to Skim, or back to Anki, as the setting says; with
    `redraw`, the toolbar and a review on screen take it now."""
    on = has_b(cfg)
    if _anki_b is not None and _skim_b is not None:
        _anki_b.setKey(QKeySequence(BROWSE if on else "b"))
        _skim_b.setEnabled(on)
    if _action is not None:
        shortcut = "" if on else cfg["shortcut"]
        _action.setShortcut(QKeySequence(shortcut) if shortcut else QKeySequence())
    if not redraw:
        return
    try:
        if getattr(mw, "state", None) == "review":
            mw.clearStateShortcuts()
            mw.setStateShortcuts(mw.reviewer._shortcutKeys())
        mw.toolbar.draw()
    except Exception:  # an Anki without them: the next review, the next draw
        pass


def on_state_shortcuts(state: str, shortcuts: list) -> None:
    """A review starting: e edits in Skim, Cmd/Ctrl+Shift+E in Anki."""
    if state != "review" or not get_config()["b_and_e"]:
        return
    from . import api

    shortcuts.append(("e", api.edit_from_review))
    shortcuts.append((EDIT, mw.onEditCurrent))


def native(key: str) -> str:
    """A key as it's written on this computer (⇧⌘B on a Mac)."""
    return QKeySequence(key).toString(QKeySequence.SequenceFormat.NativeText)


def on_toolbar_links(links: list[str], toolbar) -> None:
    """Browse, in Anki's toolbar, says which key opens Anki's browser."""
    if not has_b(get_config()):
        return
    try:
        from aqt.utils import tr

        old = f'title="{tr.actions_shortcut_key(val="B")}"'
        new = f'title="{tr.actions_shortcut_key(val=native(BROWSE))}"'
    except Exception:
        return
    for i, link in enumerate(links):
        if 'id="browse"' in link:
            links[i] = link.replace(old, new)
