# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 AIbrahimv2
"""Card data for the page: the cards a search finds, the text of their list
rows, and their rendered HTML.

Everything here goes through Anki's backend (Rust) and SQLite: a search is
one call, a screenful of list rows one query, and a card's HTML about half a
millisecond. The page asks for rows and HTML in batches, only for what it is
about to show.
"""

from __future__ import annotations

import html
import re
from collections.abc import Callable, Iterable

from anki.collection import Collection
from anki.utils import ids2str

# A cloze with no cloze inside it: its answer, dropping any hint. Nested
# clozes fill in from the inside out. Then sound references, runs of space.
_CLOZE = re.compile(r"\{\{c\d+::((?:(?!\{\{|\}\}).)*?)(?:::(?:(?!\{\{|\}\}).)*?)?\}\}", re.S)
# Line breaks and blocks become spaces; inline tags (<b>, <span>) vanish.
_BREAK = re.compile(r"<(?:br|hr)\b[^>]*>|</(?:div|p|li|tr|td|th|h\d|blockquote)\s*>", re.I)
_TAG = re.compile(r"<[^>]*>")
_SOUND = re.compile(r"\[sound:[^\]]*\]")
_SPACE = re.compile(r"\s+")
# A type-in-the-answer box: a previewer has nowhere to type.
_TYPE = re.compile(r"\[\[type:[^]]+\]\]")

ROW_CHARS = 240


def search(col: Collection, query: str) -> list[int]:
    """Card ids for `query`, oldest card first (siblings stay together)."""
    return list(col.find_cards(query, order="c.id"))


def row_text(field: object) -> str:
    """A note's sort field as one line of plain text, clozes filled in."""
    text = str(field)
    for _ in range(3):  # nested clozes
        filled = _CLOZE.sub(r"\1", text)
        if filled == text:
            break
        text = filled
    text = _TAG.sub("", _BREAK.sub(" ", _SOUND.sub(" ", text)))
    return _SPACE.sub(" ", html.unescape(text)).strip()[:ROW_CHARS]


def rows(col: Collection, cids: Iterable[int]) -> dict[str, list]:
    """List rows by card id: [text, card type, queue, flag]. Cards that no
    longer exist are left out."""
    ids = [int(c) for c in cids]
    if not ids:
        return {}
    models: dict[int, tuple[int, bool, list[str]]] = {}
    out: dict[str, list] = {}
    # The note's fields, not its stored sort field: Anki strips that of
    # HTML without leaving spaces where line breaks were.
    sql = (
        "select c.id, c.ord, c.queue, c.flags, n.mid, n.flds from cards c "
        f"join notes n on n.id = c.nid where c.id in {ids2str(ids)}"
    )
    for cid, ord_, queue, flags, mid, flds in col.db.all(sql):
        info = models.get(mid)
        if info is None:
            info = models[mid] = _model_info(col, mid)
        sortf, cloze, names = info
        fields = flds.split("\x1f")
        text = row_text(fields[sortf] if sortf < len(fields) else fields[0])
        kind = f"Cloze {ord_ + 1}" if cloze else (names[ord_] if ord_ < len(names) else "")
        out[str(cid)] = [text, kind, queue, flags & 0b111]
    return out


def _model_info(col: Collection, mid: int) -> tuple[int, bool, list[str]]:
    """A note type's sort field, whether it's a cloze type, and its card
    types' names."""
    model = col.models.get(mid)
    if not model:
        return 0, False, []
    return (int(model.get("sortf") or 0), model.get("type") == 1,
            [t["name"] for t in model.get("tmpls") or []])


Prepare = Callable[[str], str]
Hook = Callable[[str, object, str], str]


def render(col: Collection, cid: int, prepare: Prepare, hook: Hook,
           body_class: Callable[[int], str]) -> dict | None:
    """Both sides of a card, ready for Anki's reviewer page: media names
    escaped, play buttons added, and passed through the `card_will_show`
    hook as a preview, like Anki's own previewer does."""
    try:
        card = col.get_card(cid)
    except Exception:  # deleted since the search
        return None
    out = card.render_output(reload=True)
    question = _TYPE.sub("", out.question_and_style())
    answer = _TYPE.sub("", out.answer_and_style())
    return {
        "q": hook(prepare(question), card, "previewQuestion"),
        "a": hook(prepare(answer), card, "previewAnswer"),
        "cls": body_class(card.ord),
    }
