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

`topic` (a tag, or a list of them) is what the cards are read against: the
tags pane puts that resource first, "Again in" lists the other systems a
card is in, and suspended cards get a verdict (unsuspend now, or wait for
the system they mostly belong to). A `tag:` search names its own topic.

`set_context(factory)` lets a study planner say what it knows: `factory()`
returns an object with `pinned()` (resource tags, in the order to list
them), `roots()` (top-level tags whose children are resources, like
"#AK_Step1_v12") and `status(tag)` ("queued", "completed", "later" or
None). Call `context_changed()` when those change.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence

from aqt import mw
from anki.utils import ids2str
from aqt.qt import QApplication, QTimer

from . import kit
from .tags import Context
from .window import SkimWindow

VERSION = 2

_window: SkimWindow | None = None
_context_factory: Callable[[], Context] | None = None


def _get() -> SkimWindow:
    global _window
    if _window is None:
        _window = SkimWindow()
    return _window


def _topics(topic: str | Sequence[str] | None) -> list[str] | None:
    if topic is None:
        return None
    return [topic] if isinstance(topic, str) else [t for t in topic if isinstance(t, str)]


def open(*, search: str | None = None, card_ids: Sequence[int] | None = None,
         title: str | None = None, source: str | None = None, focus: bool = True,
         topic: str | Sequence[str] | None = None, select: int | None = None,
         back_label: str | None = None, ordered: bool = False, side: str | None = None,
         hidden: Sequence[int] | None = None, extra: dict | None = None) -> None:
    """Show Skim on these cards (or, with neither `search` nor `card_ids`,
    on whatever it showed last) and give it the keys."""
    if mw.col is None:
        return
    window = _get()
    # p goes back to the add-on window that asked (Stepwise), not to Anki's
    # main window when you open Skim from the Tools menu.
    opener = QApplication.activeWindow() if source else None
    window.show_cards(search=search, card_ids=card_ids, title=title, source=source,
                      topics=_topics(topic), select=select, ordered=ordered, side=side, hidden=hidden,
                      extra=extra, opener=opener if opener is not window else None, back_label=back_label)
    window.present(focus)


def follow(*, search: str, card_ids: Sequence[int] | None = None, title: str | None = None,
           source: str, topic: str | Sequence[str] | None = None, select: int | None = None,
           ordered: bool = False, side: str | None = None, hidden: Sequence[int] | None = None,
           extra: dict | None = None) -> bool:
    """If Skim is open on `source`'s cards, show these instead, without
    taking focus. Returns whether it did. Cheap to call on every move."""
    if _window is None or not _window.following(source):
        return False
    _window.follow(search=search, card_ids=card_ids, title=title, source=source, topics=_topics(topic),
                   select=select, ordered=ordered, side=side, hidden=hidden, extra=extra)
    return True


def set_context(factory: Callable[[], Context] | None) -> None:
    """Register what a study planner knows (see the module docstring)."""
    global _context_factory
    if factory is not _context_factory:
        _context_factory = factory
        context_changed()


def context_changed() -> None:
    if _window is not None:
        _window.context_changed()


def context() -> Context | None:
    """A fresh snapshot from the registered planner, if any."""
    if _context_factory is None:
        return None
    try:
        return _context_factory()
    except Exception:
        return None


def is_open() -> bool:
    return _window is not None and _window.isVisible()


def following(source: str) -> bool:
    return _window is not None and _window.following(source)


# --- for Skim itself ------------------------------------------------------------


def open_from_menu() -> None:
    """b, or Tools → Skim (keys.py): during a review, the review, on This
    review (or, while Skim already follows it, the view you picked there);
    anywhere else, All: what Skim showed last, unless that was one of the
    bar's other views."""
    global _lens
    if mw.col is None:
        return
    card = review_card()
    if card is not None:
        if not following(REVIEW):
            _lens = "session"
        open(back_label="the review", **_review_view(card, slow=True))
        return
    window = _get()
    if not window.isVisible():
        window.show_all()
    window.present()


def edit_from_review() -> None:
    """e in a review (keys.py): the card on screen, in Skim's editor, on
    the review's view as Cmd/Ctrl+Shift+B opens it (or on This review, if
    the view you picked hasn't the card); q goes back to the review. Off a
    review, Anki's editor."""
    global _lens
    if mw.col is None:
        return
    card = review_card()
    if card is None:
        mw.onEditCurrent()
        return
    if not following(REVIEW):
        _lens = "session"
    # Not counted first, so it opens at once: the bar is counted again
    # once Skim is open.
    view = _review_view(card, count=False)
    if card.id not in view["card_ids"]:
        _lens = "session"
        view = _review_view(card, count=False)
    view["extra"] = {**view["extra"], "edit": card.id}
    open(back_label="the review", **view)


# --- the review -----------------------------------------------------------------

REVIEW = "Review"
# The scheduler's whole queue for a big deck is a few hundred cards.
QUEUE_LIMIT = 2000
REVIEW_DELAY_MS = 60


def review_card():
    """The card on screen in the reviewer, if you're reviewing."""
    if getattr(mw, "state", None) != "review":
        return None
    return getattr(getattr(mw, "reviewer", None), "card", None)


def _review_topics(card) -> list[str]:
    """The topics you're studying the card for: its tags the planner
    (Stepwise) has queued, or else done."""
    ctx = context()
    if ctx is None:
        return []
    try:
        tags = card.note().tags
        status = {t: ctx.status(t) for t in tags}
    except Exception:
        return []
    return [t for t in tags if status[t] == "queued"] or [t for t in tags if status[t] == "completed"]


def _session(card) -> tuple[list[int], list[int], str]:
    """Today's review of the deck you're studying (or, with no `card`, the
    deck selected in Anki): the cards answered so far (in the order you
    answered them), and the ones still to come (in the scheduler's order),
    without the card on screen; and the deck's name."""
    col = mw.col
    did = col.decks.get_current_id()
    dids = col.decks.deck_and_child_ids(did)
    start = (col.sched.day_cutoff - 86400) * 1000
    studied = col.db.list(
        "select r.cid from revlog r join cards c on c.id = r.cid "
        f"where r.id > ? and r.ease > 0 and c.did in {ids2str(dids)} "
        "group by r.cid order by min(r.id)", start)
    try:
        queued = [q.card.id for q in col.sched.get_queued_cards(fetch_limit=QUEUE_LIMIT).cards]
    except Exception:
        queued = []
    here = card.id if card is not None else None
    upcoming = [c for c in queued if c != here]
    coming = set(upcoming)
    studied = [c for c in studied if c != here and c not in coming]
    name = col.decks.name(did).rsplit("::", 1)[-1]
    return studied, upcoming, name


# The views in the bar over the table, after All (Skim's own search, which
# the window keeps): the session, and Anki's browser's "Today" searches
# (with the same definitions), on the deck you're reviewing, or else the
# one selected in Anki.
ALL = "all"
LENSES: list[tuple[str, str, str]] = [
    ("session", "This review", ""),
    ("due", "Due", "due today"),
    ("added", "Added", "added today"),
    ("edited", "Edited", "edited today"),
    ("studied", "Studied", "studied today"),
    ("first", "First review", "first reviewed today"),
    ("rescheduled", "Rescheduled", "rescheduled today"),
    ("again", "Again", "answered Again today"),
    ("overdue", "Overdue", "overdue"),
]
# Rescans every note (about 200 ms on a big collection): counted when Skim
# opens from a review or you change view, not after every card.
_SLOW = {"added", "edited"}
_RATED = {"studied", "first", "rescheduled", "again"}
# The view Skim follows a review on: This review, until you pick another.
_lens = "session"
_slow_counts: dict[str, int] = {}
# The bar's counts (but All's), as last counted: the window shows these for
# every view and counts them all again once it's open or you've switched
# (see recount), so a switch never waits on them.
_last_counts: list[list] = []


def _lens_search(lens: str) -> str:
    from anki.collection import SearchNode

    rated = SearchNode.Rated
    node = {
        "due": lambda: SearchNode(due_on_day=0),
        "added": lambda: SearchNode(added_in_days=1),
        "edited": lambda: SearchNode(edited_in_days=1),
        "studied": lambda: SearchNode(rated=rated(days=1)),
        "first": lambda: SearchNode(introduced_in_days=1),
        "rescheduled": lambda: SearchNode(rated=rated(days=1, rating=SearchNode.RATING_BY_RESCHEDULE)),
        "again": lambda: SearchNode(rated=rated(days=1, rating=SearchNode.RATING_AGAIN)),
        "overdue": lambda: mw.col.group_searches(SearchNode(card_state=SearchNode.CARD_STATE_DUE),
                                                 SearchNode(negated=SearchNode(due_on_day=0))),
    }[lens]()
    return mw.col.build_search_string(node, SearchNode(parsable_text="deck:current"))


def _lens_ids(lens: str) -> list[int]:
    """A Today view's cards: due ones soonest first, edited ones latest
    first, studied ones in the order you studied them."""
    col = mw.col
    search = _lens_search(lens)
    if lens in ("due", "overdue"):
        return list(col.find_cards(search, order="c.due, c.id"))
    if lens == "edited":
        return list(col.find_cards(search, order="n.mod desc, c.id"))
    ids = list(col.find_cards(search, order="c.id"))
    if lens in _RATED and ids:
        start = (col.sched.day_cutoff - 86400) * 1000
        order = col.db.list(
            f"select cid from revlog where id > ? and cid in {ids2str(ids)} group by cid order by min(id)", start)
        ids = order + [c for c in ids if c not in set(order)]
    return ids


def _counts(session: int, slow: bool) -> list[list]:
    if slow or not _slow_counts:
        for lens in _SLOW:
            _slow_counts[lens] = len(mw.col.find_cards(_lens_search(lens)))
    out = []
    for key, label, _ in LENSES:
        if key == "session":
            n = session
        elif key in _SLOW:
            n = _slow_counts.get(key, 0)
        else:
            n = len(mw.col.find_cards(_lens_search(key)))
        out.append([key, label, n])
    _last_counts[:] = out
    return out


def lens_counts() -> list[list]:
    """The bar's views (but All) with the last counts (None until the
    first)."""
    return [list(x) for x in _last_counts] or [[k, label, None] for k, label, _ in LENSES]


def _note_counts(known: dict[str, int]) -> None:
    """Counts a view found on its way (its own cards, the session's), so
    the bar agrees with the table before the next recount."""
    rows = lens_counts()
    for row in rows:
        if row[0] in known:
            row[2] = known[row[0]]
    _last_counts[:] = rows


def recount() -> None:
    """Count the bar's views again. Each count is a search, and Added and
    Edited read every note, so this runs once Skim is open, not on every
    move."""
    card = review_card()
    try:
        studied, upcoming, _ = _session(card)
        _counts(len(studied) + len(upcoming) + (card is not None), slow=True)
    except Exception:
        pass


def _review_view(card, side: str | None = None, lens: str | None = None, slow: bool = False,
                 count: bool = True) -> dict:
    """One of the bar's views but All. From a review (`card`): the session
    (or one of the Today views), on the card on screen, showing the side the
    reviewer is on, following the review. With no review, the same views of
    the deck selected in Anki, starting on the next card to study. Answers
    of cards still to come (and the reviewer's, until it's answered) stay
    hidden in the list. Without `count`, the other views keep their last
    counts (switching views shouldn't wait on counting them all)."""
    lens = lens or _lens
    reviewing = card is not None
    if reviewing and side is None:
        side = "answer" if getattr(getattr(mw, "reviewer", None), "state", None) == "answer" else "question"
    try:
        studied, upcoming, deck = _session(card)
    except Exception:  # an unusual collection: the card's note alone
        studied, upcoming, deck = [], [], ""
    here = [card.id] if reviewing else []
    secret = set(upcoming) | (set(here) if side == "question" else set())
    session = [*studied, *here, *upcoming]
    select = card.id if reviewing else (upcoming[0] if upcoming and lens == "session" else None)
    if not deck:
        ids = list(card.note().card_ids()) if reviewing else []
        title, extra = "This card's note" if reviewing else None, {"lens": lens}
    else:
        try:
            ids = session if lens == "session" else _lens_ids(lens)
            if count:
                _counts(len(session), slow)
            else:
                _note_counts({lens: len(ids), "session": len(session)})
        except Exception:
            lens, ids = "session", session
        phrase = next(p for k, _, p in LENSES if k == lens)
        title = (f"{deck}: {len(studied):,} studied, {len(upcoming) + len(here):,} to go" if lens == "session"
                 else f"{deck}: {len(ids):,} {phrase}")
        extra = {"lens": lens}
    # No search: the title says what these are (e still opens the card in
    # Anki's browser).
    return {"search": "", "card_ids": ids, "ordered": True, "select": select, "side": side,
            "hidden": [c for c in ids if c in secret], "title": title, "source": REVIEW if reviewing else None,
            "topic": (_review_topics(card) or None) if reviewing else None, "extra": extra}


def set_review_lens(lens: str, push: bool = True) -> None:
    """Switch views (the bar over the table, t/T or H/L). All goes back to
    Skim's search; the others follow the review if there is one. Only the
    view's own cards are found now; the bar is counted again a moment later.
    Without `push`, the caller hands the view to the page (the bridge's
    reply)."""
    global _lens
    if _window is None:
        return
    if lens == ALL:
        _window.show_all(push)
        return
    if lens not in {k for k, _, _ in LENSES}:
        return
    card = review_card()
    if card is not None:
        _lens = lens
    view = _review_view(card, lens=lens, count=False)
    view["topics"] = _topics(view.pop("topic"))
    _window.show_cards(**view, push=push)
    _window.recount_soon()


def on_review_question(card) -> None:
    """The reviewer moved on: if Skim is open on the review, show this card,
    front only. Just after the reviewer has drawn it, so it never waits."""
    if following(REVIEW):
        QTimer.singleShot(REVIEW_DELAY_MS, lambda: following(REVIEW) and follow(**_review_view(card, "question")))


def on_review_answer(card) -> None:
    """The reviewer showed the answer: so does Skim."""
    if following(REVIEW) and _window is not None:
        _window.reveal(card.id)


# Prewarming waits this long between its steps, and this long again while
# Anki is busy (a sync, an import: anything with a progress window).
PREWARM_STEP_MS = 700
PREWARM_RETRY_MS = 3000


def _busy() -> bool:
    try:
        return bool(mw.progress.busy())
    except Exception:
        return False


def prewarm() -> None:
    """Get the window ready while nothing else is happening, so the first
    open is as quick as the rest. In steps, each a moment's work, after
    Anki's own startup (see __init__): the window, then its page, hidden,
    on what it opens on (All), which draws its first cards and reads their
    tags (and the whole collection's, for the systems: see
    window.analyzer), then reads the rest of its cards a slice at a time
    with pauses between (see the page's HIDDEN_SLICE)."""
    if mw.col is None:
        return
    if _busy():
        QTimer.singleShot(PREWARM_RETRY_MS, prewarm)
        return
    if _window is None:
        _get()
        QTimer.singleShot(PREWARM_STEP_MS, prewarm)
        return
    _window.prime()


def window() -> SkimWindow | None:
    """The Skim window, if it's been made (shown or not)."""
    return _window


def open_settings() -> None:
    """Anki's Config button, ⋯ → Settings… and ⌘, (from the Skim window):
    Settings, a tab of the add-on kit's window (settings_page.py)."""
    kit.open_page("skim", "settings")


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
        if window.isVisible():
            window.flush()  # an edit typed a moment ago
        window.close()
        window.cleanup()
        window.deleteLater()
