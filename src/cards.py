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
import time
from collections.abc import Callable, Iterable

from anki.collection import Collection
from anki.utils import ids2str

from .tags import VERDICT_CODES, YIELD_LABELS, Analyzer, banks_text

# A cloze with no cloze inside it: its answer, dropping any hint. Nested
# clozes fill in from the inside out. Then sound references, runs of space.
_CLOZE = re.compile(r"\{\{c(\d+)::((?:(?!\{\{|\}\}).)*?)(?:::((?:(?!\{\{|\}\}).)*?))?\}\}", re.S)
# Line breaks and blocks become spaces; inline tags (<b>, <span>) vanish.
_BREAK = re.compile(r"<(?:br|hr)\b[^>]*>|</(?:div|p|li|tr|td|th|h\d|blockquote)\s*>", re.I)
_TAG = re.compile(r"<[^>]*>")
_SOUND = re.compile(r"\[sound:[^\]]*\]")
_SPACE = re.compile(r"\s+")
# A type-in-the-answer box: a previewer has nowhere to type.
_TYPE = re.compile(r"\[\[type:[^]]+\]\]")

ROW_CHARS = 240

# --- scheduling ---------------------------------------------------------------
#
# For the columns you can turn on (Due, Interval, Retrievability, ...): read
# with the row, from the card and the FSRS memory state Anki keeps in its
# data (s: stability, d: difficulty, decay, lrt: when you last reviewed it,
# in seconds, dr: desired retention). json_valid: older cards' data can be
# empty, which json_extract would refuse.
_FSRS_KEYS = ("s", "d", "decay", "lrt", "dr")
SCHED_SQL = "c.type, c.due, c.odue, c.ivl, c.factor, c.reps, c.lapses, " + ", ".join(
    f"case when json_valid(c.data) then json_extract(c.data, '$.{k}') end" for k in _FSRS_KEYS
)
# FSRS-5's decay, for a memory state that doesn't keep its own (FSRS-6's do).
_DECAY = 0.5
_DAY = 86400
# A due bigger than this is a time in seconds (a card learning within the
# day); smaller, a day number.
_TIMESTAMP = 1_000_000_000
# What the page can sort by besides the facets, and the row's field each
# comes from (see schedule).
EXTRA = {"due": "du", "ivl": "iv", "ease": "e", "ret": "rt", "dif": "df", "stab": "sb", "reps": "rv",
         "lapses": "lp"}


def timing(col: Collection) -> tuple[int, float]:
    """Today, as Anki's scheduler counts days, and now, for schedule()."""
    return col.sched.today, time.time()


def schedule(fields: tuple, today: int, now: float) -> dict:
    """A card's scheduling, from SCHED_SQL's fields, for the list (blanks
    left out). du: when it's due, in days from today (a fraction for one
    learning within the day, from now; below 0 when it's late), iv: its
    interval in days, e: its ease in percent (SM-2), rv: reviews, lp:
    lapses; with an FSRS memory state, rt: retrievability (0 to 1), dr:
    the desired retention it's scheduled for, df: difficulty in percent and
    sb: stability in days, as Anki's Card Info has them."""
    type_, due, odue, ivl, factor, reps, lapses, s, d, decay, lrt, dr = fields
    due = odue or due  # a card in a filtered deck: its due back home
    out: dict = {"rv": reps, "lp": lapses}
    if type_ != 0:  # not new
        out["du"] = round((due - now) / _DAY, 3) if due > _TIMESTAMP else due - today
    if ivl > 0:
        out["iv"] = ivl
    if factor:
        out["e"] = factor // 10
    if s and s > 0:
        out["rt"] = round(retrievability(s, decay, lrt, due, ivl, today, now), 4)
        out["dr"] = round(dr or 0.9, 2)
        out["sb"] = round(s, 2)
    if d:
        out["df"] = round((d - 1) / 9 * 100)
    return out


def retrievability(s: float, decay: float | None, lrt: int | None, due: int, ivl: int,
                   today: int, now: float) -> float:
    """The chance you'd recall a card now, as Anki's FSRS reckons it: from
    its stability and the time since you last reviewed it. A card reviewed
    before Anki kept that time counts from its due day less its interval,
    as Anki's browser does."""
    decay = decay or _DECAY
    if lrt:
        days = max(0.0, (now - lrt) / _DAY)
    elif due < _TIMESTAMP:
        days = max(0, today - (due - ivl))
    else:
        days = 0.0  # learning within the day
    factor = 0.9 ** (-1 / decay) - 1
    return (1 + factor * days / s) ** -decay


def search(col: Collection, query: str) -> list[int]:
    """Card ids for `query`, oldest card first (siblings stay together)."""
    return list(col.find_cards(query, order="c.id"))


def row_text(field: object, hide: int | None = None) -> str:
    """A note's sort field as one line of plain text, clozes filled in,
    except cloze number `hide` (a card you haven't answered yet), which
    shows as its front does: [...] or [hint]."""

    def fill(m: re.Match) -> str:
        if hide is not None and int(m.group(1)) == hide:
            return f"[{m.group(3) or '...'}]"
        return m.group(2)

    text = str(field)
    for _ in range(3):  # nested clozes
        filled = _CLOZE.sub(fill, text)
        if filled == text:
            break
        text = filled
    return plain(text)


_BLOCKS = re.compile(r"<(style|script)\b.*?</\1\s*>", re.S | re.I)


def plain(html_text: str) -> str:
    text = _BLOCKS.sub(" ", html_text)
    text = _TAG.sub("", _BREAK.sub(" ", _SOUND.sub(" ", text)))
    return _SPACE.sub(" ", html.unescape(text)).strip()[:ROW_CHARS]


def rows(col: Collection, cids: Iterable[int], analyzer: Analyzer | None = None,
         hidden: set[int] | frozenset[int] = frozenset()) -> dict[str, dict]:
    """List rows by card id. Cards that no longer exist are left out.
    Cards in `hidden` (ones still to come in a review) don't give their
    answers away: a cloze shows as [...], other cards show their front.

    t: the note's text, k: card type, q: Anki's queue number, f: flag,
    d: its deck's full name, o: its home deck's, for a card in a filtered
    deck; h: 1 if the answer was kept back; its scheduling (see schedule);
    with an analyzer, also y: yield, b: question banks, a: the other systems
    it comes up in ([unit, status]), v/r: the verdict and why, p: its tags
    pane (see tags.Analyzer)."""
    ids = [int(c) for c in cids]
    if not ids:
        return {}
    models: dict[int, tuple[int, bool, list[str]]] = {}
    decks: dict[int, str] = {}
    out: dict[str, dict] = {}
    today, now = timing(col)
    # The note's fields, not its stored sort field: Anki strips that of
    # HTML without leaving spaces where line breaks were.
    sql = (
        f"select c.id, c.ord, c.queue, c.flags, c.did, c.odid, n.mid, n.flds, n.tags, {SCHED_SQL} from cards c "
        f"join notes n on n.id = c.nid where c.id in {ids2str(ids)}"
    )
    for cid, ord_, queue, flags, did, odid, mid, flds, tags, *sched in col.db.all(sql):
        info = models.get(mid)
        if info is None:
            info = models[mid] = _model_info(col, mid)
        sortf, cloze, names = info
        fields = flds.split("\x1f")
        sort_field = fields[sortf] if sortf < len(fields) else fields[0]
        if cid not in hidden:
            text = row_text(sort_field)
        elif cloze:
            text = row_text(sort_field, hide=ord_ + 1)
        else:
            text = _front_text(col, cid)
        row = {
            "t": text,
            "k": f"Cloze {ord_ + 1}" if cloze else (names[ord_] if ord_ < len(names) else ""),
            "q": queue,
            "f": flags & 0b111,
            "d": deck_name(col, did, decks),
            **schedule(tuple(sched), today, now),
        }
        if odid:
            row["o"] = deck_name(col, odid, decks)
        if cid in hidden:
            row["h"] = 1  # its answer kept back: not the row to show once it's seen
        if analyzer is not None:
            facts = analyzer.card(tags.split(), suspended=queue == -1)
            level = facts["level"]
            row.update({
                "y": YIELD_LABELS.get(level) if level else None,
                "b": banks_text(facts["banks"]),
                "a": facts["again"],
                "v": facts["verdict"],
                "r": facts["reason"],
                "p": analyzer.pane(facts),
            })
        out[str(cid)] = row
    return out


def facets(col: Collection, cids: list[int], analyzer: Analyzer,
           extra: Iterable[str] = ()) -> dict[str, list]:
    """For filtering and sorting the whole list: per card, in `cids`
    order, its queue, yield level (0 for none), question count, verdict
    (0 none, 1 now, 2 your call, 3 wait), how many systems it comes up
    in that you haven't done and its deck's id (see deck_names). About
    30 ms per 1,000 cards. `extra`: also these of EXTRA's, to sort by
    (None for a blank), asked for only when you sort by one."""
    extra = [k for k in extra if k in EXTRA]
    cols = f", {SCHED_SQL}" if extra else ""
    found: dict[int, tuple] = {}
    for start in range(0, len(cids), 2000):
        chunk = cids[start:start + 2000]
        sql = (f"select c.id, c.queue, n.tags, c.did{cols} from cards c join notes n on n.id = c.nid "
               f"where c.id in {ids2str(chunk)}")
        for cid, *rest in col.db.all(sql):
            found[cid] = tuple(rest)
    out: dict[str, list] = {"state": [], "yield": [], "banks": [], "verdict": [], "later": [], "deck": []}
    for k in extra:
        out[k] = []
    today, now = timing(col) if extra else (0, 0.0)
    for cid in cids:
        queue, tags, did, *sched = found.get(cid, (99, "", 0))
        facts = analyzer.card(tags.split(), suspended=queue == -1)
        out["state"].append(queue)
        out["yield"].append(facts["level"] or 0)
        out["banks"].append(sum(facts["banks"].values()))
        out["verdict"].append(VERDICT_CODES[facts["verdict"]])
        out["later"].append(facts["later"])
        out["deck"].append(did)
        if extra:
            s = schedule(tuple(sched), today, now) if sched else {}
            for k in extra:
                out[k].append(s.get(EXTRA[k]))
    return out


def deck_name(col: Collection, did: int, names: dict[int, str]) -> str:
    """A deck's full name ("AnKing::Step 1"), remembered in `names`."""
    name = names.get(did)
    if name is None:
        name = names[did] = col.decks.name_if_exists(did) or ""
    return name


def deck_names(col: Collection, dids: Iterable[int]) -> dict[str, str]:
    """Full names by deck id, for sorting the list by deck: the page sorts
    by name, so a deck added meanwhile doesn't shift the others."""
    return {str(d): col.decks.name_if_exists(d) or "" for d in set(dids) if d}


def _front_text(col: Collection, cid: int) -> str:
    """A card's front as text: what you'd see before answering it."""
    try:
        return plain(col.get_card(cid).question())
    except Exception:
        return ""


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
