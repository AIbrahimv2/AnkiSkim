# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 AIbrahimv2
"""The document in each card frame: Anki's reviewer page (its CSS and
reviewer.js), so cards look and behave the way they do when you review
them. Shared with tools/devserver.py, which serves the same files."""

from __future__ import annotations

# Runs in each card frame before reviewer.js. Audio buttons call
# pycmd("play:a:0"): pass that on with the frame's card. The reviewer's own
# messages ("updateToolbar", ...) mean nothing here and stop.
SHIM = """
window.pycmd = window.bridgeCommand = function (cmd, cb) {
  if (typeof cmd === "string" && cmd.indexOf("play:") === 0)
    return parent.pycmd(JSON.stringify({cmd: "play", tag: cmd, cid: window.skimCid || 0}), cb);
  return false;
};
"""


def document(*, base_url: str, night: bool, standard_css: str, body_class: str, reviewer_html: str) -> str:
    return (
        f'<!doctype html><html class="{"night-mode" if night else ""}" dir="ltr">'
        f'<head><meta charset="utf-8"><base href="{base_url}">'
        '<link rel="stylesheet" href="/_anki/css/webview.css">'
        '<link rel="stylesheet" href="/_anki/css/reviewer.css">'
        f"<style>{standard_css}</style>"
        f"<script>{SHIM}</script>"
        '<script src="/_anki/js/vendor/jquery.min.js"></script>'
        '<script src="/_anki/js/reviewer.js"></script>'
        f'</head><body class="{body_class}">{reviewer_html}</body></html>'
    )
