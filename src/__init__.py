# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 AIbrahimv2
"""Skim — a fast card browser with vim keys.

Open it from Tools -> Skim (or Stepwise, with p on a topic). j/k move
through the cards a search finds, h/l show the front or the back, / searches.
Cards show the way they look when you review them, and the next few are
drawn ahead of time, so moving is instant.
"""

from __future__ import annotations

from aqt import gui_hooks, mw
from aqt.qt import QAction, QKeySequence, QTimer, qconnect

from . import api, kit
from .config import ADDON, get_config


def _install() -> None:
    action = QAction("Skim", mw)
    shortcut = get_config()["shortcut"]
    if shortcut:
        action.setShortcut(QKeySequence(shortcut))
    qconnect(action.triggered, api.open_from_menu)
    mw.form.menuTools.addAction(action)
    api.set_action(action)


def _prewarm() -> None:
    QTimer.singleShot(3000, api.prewarm)


gui_hooks.main_window_did_init.append(_install)
gui_hooks.profile_did_open.append(_prewarm)
gui_hooks.profile_will_close.append(api.close)
gui_hooks.operation_did_execute.append(api.on_operation)
gui_hooks.theme_did_change.append(api.on_theme_change)
gui_hooks.reviewer_did_show_question.append(api.on_review_question)
gui_hooks.reviewer_did_show_answer.append(api.on_review_answer)
mw.addonManager.setConfigAction(ADDON, api.open_settings)
# Serve the built page (src/web/) to the Skim window.
mw.addonManager.setWebExports(ADDON, r"web/.*\.(js|css)")
# For other add-ons (Stepwise): see api.py.
mw.skim = api
# The add-on kit shared with AIbrahimv2's other add-ons (src/kit/): What's
# new and About beside Settings, and one notice after updates.
kit.register("skim", open_settings=api.open_settings)
