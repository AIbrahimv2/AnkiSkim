# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 AIbrahimv2
"""Skim's Settings, a tab of the add-on kit's window (beside What's new and
About) rather than a dialog over the Skim window. Its panel
(web/src/settings-main.tsx, built into web/settings.js) sends its commands
here, open Skim window or not; after a save, an open window applies it and
its page hears the new config ("config")."""

from __future__ import annotations

import json

from . import api, keys
from .bridge import Bridge

# The panel's commands: the rest of the bridge is the Skim window's.
COMMANDS = {"settings", "save_settings"}


class _Host:
    """What the Settings commands ask of the Skim window, without one."""

    def settings_saved(self, cfg: dict, changed: set) -> None:
        window = api.window()
        if window is not None:
            window.settings_saved(cfg, changed)
        elif changed & {"shortcut", "b_and_e"}:
            # A window made later reads the rest (audio) itself.
            keys.apply(cfg)


def handle(msg: dict) -> dict:
    cmd = str(msg.get("cmd"))
    if cmd not in COMMANDS:
        return {"error": f"Unknown command: {cmd}"}
    reply = Bridge(_Host()).handle(json.dumps(msg))
    window = api.window()
    if cmd == "save_settings" and reply.get("saved") and window is not None:
        window.push({"type": "config", "config": reply["config"]})
    return reply


# For kit.register: the panel's files, in this add-on's folder.
PAGE = {"script": "web/settings.js", "style": "web/settings.css", "bridge": handle}
