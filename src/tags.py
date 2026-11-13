# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 AIbrahimv2
"""What a card's tags say about it, for the topic you're on.

A card in an AnKing deck can carry 40 or more tags. Read against the topic
you're looking at (Stepwise's selection, or a `tag:` search), they tell:

- which resources it's in, and where in each (the resource you're on first,
  then your pinned ones, then the rest folded away);
- which unit each of those places is in, mapped onto organ systems
  (Repro, Reproduction, Reproductive and OB/GYN are all "Repro");
- where else it comes up: other systems, and whether you've done them;
- its AnKing yield (#Low/HighYield) and question banks (UWorld, AMBOSS, NBME);
- a verdict: unsuspend it now, or wait for the unit it mostly belongs to.

The verdict, for a topic in a unit (say SketchyPharm's antimicrobials,
"Micro"): count the places the card sits in the resources that count (your
pinned ones and the one you're on), by unit. If at least `wait_below` of
them are in this unit, it's "now". If not, and another system you haven't
started (or saved for later) has it, it's "wait": you'll meet it there.
High-yield cards that would wait are "your call". Cards tagged here only
as ::Extra lean to waiting.

Stepwise supplies the pinned resources, the resource roots and each tag's
status through a context (see api.set_context); without it, every resource
counts and nothing has a status.
"""

from __future__ import annotations

import re
from collections import Counter, defaultdict
from collections.abc import Callable, Iterable
from dataclasses import dataclass

SEP = "::"

# Organ systems (and immunology) first: a discipline chapter such as
# Pixorize's Pharmacology › Cardiovascular takes the system under it.
_SYSTEMS = [(name, re.compile(p)) for name, p in (
    ("Cardio", r"cardi|heart|circulat"),
    ("Respiratory", r"respir|pulm|lung"),
    ("Renal", r"renal|nephro|kidney|urinar"),
    ("GI", r"gastro|^gi\b|^gi_|digest|hepat|liver"),
    ("Endocrine", r"endocr|^endo\b"),
    ("Repro", r"repro|obstet|gyn|breast|^ob\b"),
    ("HemeOnc", r"hemat|^heme|oncol|^blood"),
    ("Neuro", r"neuro|nervous|special_senses|^brain"),
    ("Psych", r"psych|behavio"),
    ("MSK", r"musculo|^msk|rheum|skeletal"),
    ("Derm", r"derm|^skin"),
    ("Immuno", r"immun"),
)]
_DISCIPLINES = [(name, re.compile(p)) for name, p in (
    ("Micro", r"micro|infect|antimicrob|bacteri|fung|viru|parasit"),
    ("Pharm", r"pharm"),
    ("Biochem", r"biochem|metabol|genetic|cell_bio|molecular"),
    ("Path", r"patholog"),
    ("Biostats", r"biostat|epidem|public_health|ethic"),
)]
SYSTEMS = {name for name, _ in _SYSTEMS}

_YIELD = {
    "1-highyield": 1,
    "2-relativelyhighyield": 2,
    "3-highyield-temporary": 3,
    "4-loweryield": 4,
    "5-lowyield": 5,
}
YIELD_LABELS = {1: "High", 2: "Fairly high", 3: "High", 4: "Lower", 5: "Low"}
HIGH_YIELD = {1, 3}
_BANKS = {"#uworld": "UWorld", "#amboss": "AMBOSS", "#nbme": "NBME"}
BANK_SHORT = {"UWorld": "UW", "AMBOSS": "AM", "NBME": "NB"}
# Never worth showing among a card's places.
_NOISE = ("#ak_other", "#ak_step1_v12::^other", "#ak_step2_v12::^other")
_PREFIX = re.compile(r"^[^a-z0-9]*\d+[_\-.]*")

NOW, CALL, WAIT = "now", "call", "wait"
VERDICT_CODES = {None: 0, NOW: 1, CALL: 2, WAIT: 3}


def _clean(segment: str) -> str:
    """'07_Cardiovascular' -> 'cardiovascular', '!General_Pharm' -> 'general_pharm'."""
    s = segment.lower().lstrip("!*^#")
    return _PREFIX.sub("", s) or s


def pretty(segment: str) -> str:
    """A tag segment for reading: '02_Cushing_Syndrome' -> 'Cushing Syndrome'."""
    s = segment.lstrip("!*^#")
    s = re.sub(r"^\d+[_\-.]*", "", s) or s
    return s.replace("_", " ").strip()


def unit_of(path: list[str]) -> str | None:
    """The unit of a place in a resource, from its chapter (and, for a
    discipline chapter, the one under it)."""
    if not path:
        return None
    first = _clean(path[0])
    for name, pat in _SYSTEMS:
        if pat.search(first):
            return name
    discipline = next((name for name, pat in _DISCIPLINES if pat.search(first)), None)
    if discipline and len(path) > 1:
        second = _clean(path[1])
        for name, pat in _SYSTEMS:
            if pat.search(second):
                return name
    return discipline


def topics_from_search(search: str) -> list[str]:
    """A search for one tag (`tag:X`, `"tag:X"`, `tag:X*`) names a topic."""
    m = re.fullmatch(r'\s*"?tag:([^"\s]+?)\*?"?\s*', search or "")
    if not m:
        return []
    return [m.group(1).replace("\\_", "_").replace("\\*", "*").rstrip(":")]


class Context:
    """What Skim knows about your study plan without Stepwise: nothing."""

    def pinned(self) -> list[str]:
        return []

    def roots(self) -> list[str]:
        return []

    def status(self, tag: str) -> str | None:
        return None


@dataclass
class Tag:
    tag: str
    kind: str  # "place", "bank", "yield" or "other"
    resource: str | None = None  # lower-case, e.g. "#ak_step1_v12::#b&b"
    label: str = ""
    path: tuple[str, ...] = ()
    unit: str | None = None
    pin: int | None = None
    here: bool = False
    extra: bool = False
    status: str | None = None
    level: int | None = None
    bank: str | None = None


class Analyzer:
    """Reads cards' tags against the topic(s) you're on. One per view: it
    remembers every tag it has read, and a topic's cards share most."""

    def __init__(self, topics: Iterable[str], context: Context | None = None, wait_below: float = 0.5):
        self.ctx = context or Context()
        self.wait_below = wait_below
        try:
            pins = [p.lower() for p in self.ctx.pinned() if isinstance(p, str)]
            roots = [r.lower() for r in self.ctx.roots() if isinstance(r, str)]
        except Exception:
            pins, roots = [], []
        self.pins = {p: i for i, p in enumerate(pins)}
        self.roots = set(roots)
        self.topics = [t.lower().rstrip(":*") for t in topics if t]
        self._tags: dict[str, Tag] = {}
        self.here_resources = {self._place(t)[0] for t in self.topics} - {None}
        self.here_units = {unit_of(list(self._place(t)[1])) for t in self.topics} - {None}

    # --- one tag -----------------------------------------------------------

    def _place(self, tag: str) -> tuple[str | None, tuple[str, ...], str]:
        """(resource key, path inside it, resource label) for a tag."""
        parts = tag.split(SEP)
        first = parts[0].lower()
        if self.roots:
            n = 2 if first in self.roots else 1
        else:
            n = 2 if len(parts) >= 3 else 1
        if len(parts) < n:
            return None, (), ""
        resource = SEP.join(parts[:n]).lower()
        label = parts[n - 1].lstrip("#") or parts[n - 1]
        return resource, tuple(parts[n:]), label

    def tag(self, tag: str) -> Tag:
        t = self._tags.get(tag)
        if t is not None:
            return t
        low = tag.lower()
        resource, path, label = self._place(tag)
        last = low.rsplit(SEP, 1)[-1]
        name = resource.rsplit(SEP, 1)[-1] if resource else ""
        if last in _YIELD and "yield" in name:
            t = Tag(tag, "yield", resource, label, path, level=_YIELD[last])
        elif name in _BANKS:
            t = Tag(tag, "bank", resource, label, path, bank=_BANKS[name])
        elif resource is None or not path or low.startswith(_NOISE):
            t = Tag(tag, "other", resource, label, path)
        else:
            here = any(low == p or low.startswith(p + SEP) for p in self.topics)
            extra = last == "extra"
            unit = unit_of([s for s in path if s.lower() != "extra"])
            try:
                status = self.ctx.status(tag)
            except Exception:
                status = None
            t = Tag(tag, "place", resource, label, path, unit, self.pins.get(resource), here, extra, status)
        self._tags[tag] = t
        return t

    def counts(self, t: Tag) -> bool:
        """Places in your pinned resources (or every resource, without
        Stepwise) and in the one you're on count toward the verdict."""
        return t.kind == "place" and (not self.pins or t.here or t.pin is not None or t.resource in self.here_resources)

    # --- one card ----------------------------------------------------------

    def card(self, tags: Iterable[str], suspended: bool = True) -> dict:
        """The facts for a card's list row and its tags pane."""
        infos = [self.tag(t) for t in tags]
        levels = [t.level for t in infos if t.level]
        level = min(levels) if levels else None
        banks = Counter(t.bank for t in infos if t.bank)
        places = [t for t in infos if self.counts(t)]
        here_places = [t for t in infos if t.kind == "place" and t.here]

        # Units by the resources that put the card there; a place under
        # the topic counts as here whatever its unit.
        by_unit: dict[str, set[str]] = defaultdict(set)
        statuses: dict[str, list[str | None]] = defaultdict(list)
        for t in places:
            unit = "here" if t.here or t.unit in self.here_units else t.unit
            if unit:
                by_unit[unit].add(t.resource)
                statuses[unit].append(t.status)
        total = sum(len(r) for r in by_unit.values())
        share = len(by_unit.get("here", ())) / total if total else None

        again = []
        for unit in sorted(u for u in by_unit if u in SYSTEMS):
            s = statuses[unit]
            summary = ("completed" if all(x == "completed" for x in s)
                       else "queued" if "queued" in s else "later" if "later" in s else None)
            again.append([unit, summary])
        later = [u for u, s in again if s in (None, "later")]

        verdict = reason = None
        if suspended and here_places and share is not None:
            extra_only = all(t.extra for t in here_places)
            pct = f"{round(share * 100)}% here"
            if not later:
                verdict, reason = NOW, ("Only here" if not again else f"{pct}; done or queued elsewhere")
            elif share >= self.wait_below and not extra_only:
                verdict, reason = NOW, f"{pct}; also in {', '.join(later)}"
            elif level in HIGH_YIELD:
                verdict, reason = CALL, f"High yield, but {pct}; comes up again in {', '.join(later)}"
            else:
                why = "only an Extra here" if extra_only else pct
                verdict, reason = WAIT, f"{why}; comes up again in {', '.join(later)}"

        return {
            "level": level,
            "banks": dict(banks),
            "again": again,
            "later": len(later),
            "verdict": verdict,
            "reason": reason,
            "share": share,
            "places": infos,
        }

    def pane(self, facts: dict) -> dict:
        """The tags pane: the card's places grouped by resource, the one
        you're on first, then pinned ones in Stepwise's order; the rest
        (other resources, AnKing's own tags) folded into `more`."""
        groups: dict[str, dict] = {}
        more: list[str] = []
        for t in facts["places"]:
            if t.kind in ("yield", "bank"):
                continue
            shown = self.counts(t)
            if not shown:
                more.append(t.tag)
                continue
            g = groups.setdefault(t.resource, {
                "label": t.label, "pinned": t.pin is not None,
                "here": t.resource in self.here_resources, "rank": t.pin, "topics": [],
            })
            g["here"] = g["here"] or t.here
            path = [s for s in t.path if s.lower() != "extra"]
            g["topics"].append({
                "path": " › ".join(pretty(s) for s in path) or t.label,
                "tag": t.tag,
                "status": t.status,
                "here": t.here,
                "unit": t.unit,
                "again": bool(t.unit in SYSTEMS and not t.here and t.unit not in self.here_units),
                "extra": t.extra,
            })
        ordered = sorted(groups.values(), key=lambda g: (
            not g["here"], g["rank"] is None, g["rank"] if g["rank"] is not None else 0, g["label"].lower()))
        for g in ordered:
            g["topics"].sort(key=lambda x: (not x["here"], not x["again"], x["path"].lower()))
            del g["rank"]
        level = facts["level"]
        return {
            "verdict": facts["verdict"],
            "reason": facts["reason"],
            "yield": YIELD_LABELS.get(level) if level else None,
            "banks": sorted(facts["banks"].items(), key=lambda kv: -kv[1]),
            "groups": ordered,
            "more": sorted(more, key=str.lower),
        }


def banks_text(banks: dict) -> str:
    return "  ".join(f"{BANK_SHORT.get(b, b)} {n}" for b, n in sorted(banks.items(), key=lambda kv: -kv[1]))


ContextFactory = Callable[[], Context]
