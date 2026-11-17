"""Card data: searches, list rows and rendered cards."""

from harness import ALL, check, col, notes
from skim import cards
from skim.viewstate import ViewState

print("search")
found = cards.search(col, "tag:Cardio")
check(found == sorted(found), "results come oldest card first")
check(len(found) == 4, "a parent tag finds its children's cards (two notes, two cards each)")

print("view state")
v = ViewState()
v.set(col, search="tag:Neuro")
check(v.ids and v.error is None and v.seq == 1, "a search fills the view")
v.set(col, search="  ")
check(v.ids == list(col.find_cards("deck:*", order="c.id")) and len(v.ids) >= len(ALL) and v.error is None,
      "an empty search shows every card")
v.set(col, search="tag:(", title="Bad")
check(v.ids == [] and v.error, f"a bad search keeps Anki's message ({v.error!r})")
v.set(col, search="ignored here", ids=[ALL[3], ALL[1], ALL[1]], title="Two", source="Stepwise")
check(v.ids == sorted({ALL[1], ALL[3]}), "handed-over ids are used as they are, sorted, once each")
check(v.as_dict("Stepwise")["back"] == "Stepwise" and v.seq == 4, "every view gets a new number")

print("rows")
rows = cards.rows(col, ALL)
heart = rows[str(ALL[0])]
check(heart["t"] == "Heart chambers? Count them", f"row text: tags dropped, line breaks as spaces ({heart['t']!r})")
check(heart["k"] == "Card 1", "a Basic card shows its card type")
check(heart["f"] == 1, "the red flag comes through")
check("v" not in heart, "without an analyzer, no verdict")
brain_cids = col.find_cards(f"nid:{notes['brainstem']}", order="c.ord")
brain = rows[str(brain_cids[1])]
check(brain["t"] == "The brainstem has three parts", f"clozes filled in, hints dropped ({brain['t']!r})")
check(brain["k"] == "Cloze 2", "a cloze card shows its number")
mitral = [rows[str(c)] for c in col.find_cards(f"nid:{notes['mitral']}")]
check(all(r["q"] == -1 for r in mitral), "suspended cards say so")

print("answers kept back")
check(cards.row_text("The {{c1::brainstem}} has {{c2::three::number}} parts", hide=2) == "The brainstem has [number] parts",
      "a card's own cloze shows as its hint")
check(cards.row_text("{{c1::Ceftriaxone}} treats {{c2::meningitis}}", hide=1) == "[...] treats meningitis", "or as [...]")
heart_cards = list(col.find_cards(f"nid:{notes['heart']}", order="c.ord"))
kept = cards.rows(col, heart_cards, hidden={heart_cards[1]})
check(kept[str(heart_cards[1])]["t"] == "Four" and kept[str(heart_cards[0])]["t"].startswith("Heart"),
      "a reversed card still to come shows its front, not the note's sort field")

print("rows read against a topic")
from skim.tags import Analyzer  # noqa: E402

an = Analyzer(["Cardio"])
read = cards.rows(col, ALL, an)
m = read[str(col.find_cards(f"nid:{notes['mitral']}")[0])]
check(m["v"] == "now" and m["r"] == "Only here", f"a suspended card under the topic gets a verdict ({m['r']})")
check(read[str(ALL[0])]["v"] is None, "a card that isn't suspended doesn't")
check(m["p"]["groups"] and m["p"]["groups"][0]["here"], "and a tags pane, the topic's resource first")
fac = cards.facets(col, ALL, an)
check(len(fac["state"]) == len(ALL) and fac["state"].count(-1) == 2, "facets cover every card, in order")
check(fac["verdict"].count(1) == 2, "suspended cards' verdicts are in the facets")
check(cards.rows(col, [123]) == {}, "a card that doesn't exist is left out")

print("render")
seen = []


def hook(text, card, kind):
    seen.append(kind)
    return text + f"<!--{kind}-->"


out = cards.render(col, ALL[0], prepare=lambda t: t, hook=hook, body_class=lambda o: f"card card{o + 1}")
check("Heart" in out["q"] and "Four" in out["a"], "both sides come back")
check(seen == ["previewQuestion", "previewAnswer"], "the card_will_show hook sees a preview of each side")
check(out["cls"] == "card card1", "the body class is the card's")
check(cards.render(col, 123, lambda t: t, lambda t, c, k: t, lambda o: "") is None, "a deleted card renders as None")
print("all passed")
