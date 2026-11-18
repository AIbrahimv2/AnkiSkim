"""Reading a card's tags against a topic: units, the tags pane's order, and
the verdict (unsuspend now, or wait). AnKing-style tags, with a stand-in
for what Stepwise tells Skim."""

from harness import check
from skim.tags import Analyzer, Context, topics_from_search, unit_of

S1 = "#AK_Step1_v12"

print("units")
for path, unit in [
    (["22_Repro", "05_Breast"], "Repro"),
    (["07_Cardiovascular", "05_Pharmacology"], "Cardio"),
    (["03_Pharmacology", "22_Cardiovascular_(new)"], "Cardio"),  # a discipline takes the system under it
    (["07_Antimicrobials", "05_Antifungals"], "Micro"),
    (["14_Infectious_Disease", "04_Fungi"], "Micro"),
    (["11_Musculoskeletal_Skin_and_Connective_Tissue"], "MSK"),
    (["12_Neurology_and_Special_Senses"], "Neuro"),
    (["Reproductive", "Pharmacology"], "Repro"),
    (["Hematology_and_Oncology"], "HemeOnc"),
    (["05_Pharm", "01_Pharmacokinetics"], "Pharm"),
    (["08_Antineoplastics"], None),
]:
    check(unit_of(path) == unit, f"{' › '.join(path)} is {unit}")

print("topics from a search")
check(topics_from_search('"tag:#AK_Step1_v12::#B&B::06\\_Cardio*"') == ["#AK_Step1_v12::#B&B::06_Cardio"],
      "a tag search (as Stepwise writes them) names its topic")
check(topics_from_search("heart failure") == [], "other searches don't")


class Plan(Context):
    """Stepwise, as Skim sees it: pins, roots and statuses."""

    def __init__(self, statuses=None):
        self.statuses = statuses or {}

    def pinned(self):
        return [f"{S1}::#B&B", f"{S1}::#Bootcamp", f"{S1}::#FirstAid", f"{S1}::#SketchyPharm", f"{S1}::^Systems"]

    def roots(self):
        return [S1, "#AK_Step2_v12"]

    def status(self, tag):
        for prefix, s in self.statuses.items():
            if tag.lower().startswith(prefix.lower()):
                return s
        return None


TOPIC = f"{S1}::#SketchyPharm::07_Antimicrobials"
KETO = [
    f"{TOPIC}::05_Antifungals::02_Azoles",
    f"{S1}::#B&B::09_Endocrinology::02_Adrenals::02_Cushing_Syndrome",
    f"{S1}::#B&B::14_Infectious_Disease::04_Fungi::04_Antifungal_Drugs::Extra",
    f"{S1}::#B&B::22_Repro::05_Breast::01_Breast_Tissue",
    f"{S1}::#Bootcamp::Microbiology::37_Antifungals::02_Azoles",
    f"{S1}::#Bootcamp::Reproduction::06_Pharmacology::04_Antiandrogens",
    f"{S1}::#FirstAid::15_Repro::05_Pharm::13_Antiandrogens::*Ketoconazole",
    f"{S1}::#FirstAid::08_Endocrine::02_Physiology",
    f"{S1}::^Systems::Reproductive::Pharmacology",
    f"{S1}::#Pixorize::04_Microbiology::02_Antifungals::04_Azoles",  # not pinned
    f"{S1}::#UWorld::Step::12345",
    f"{S1}::#UWorld::Step::12346",
    f"{S1}::#AMBOSS::Step1::ab12",
    f"{S1}::#Low/HighYield::4-LowerYield",
    "#AK_Other::AnKing_Image::Mujeeb::Azoles",
]

print("a card that mostly belongs elsewhere")
an = Analyzer([TOPIC], Plan(), 0.5)
f = an.card(KETO, suspended=True)
check(f["verdict"] == "wait", f"it could wait ({f['reason']})")
check("Endocrine" in f["reason"] and "Repro" in f["reason"], "for Endocrine and Repro")
check([a[0] for a in f["again"]] == ["Endocrine", "Repro"], "Again in: Endocrine, Repro")
check(f["level"] == 4 and f["banks"] == {"UWorld": 2, "AMBOSS": 1}, "yield and question banks read")
p = an.pane(f)
labels = [g["label"] for g in p["groups"]]
check(labels[0] == "SketchyPharm" and p["groups"][0]["here"], "the resource you're on comes first")
check(labels[1:] == ["B&B", "Bootcamp", "FirstAid", "^Systems"], f"then your pinned ones, in Stepwise's order ({labels})")
bb = p["groups"][1]["topics"]
check(bb[0]["again"] and bb[0]["unit"] in ("Endocrine", "Repro"), "a resource's places in other systems come first")
check(any(t["extra"] and not t["again"] for t in bb), "Infectious Disease (Micro, as here) isn't an 'again', and shows Extra")
others = {o["label"]: o["tags"] for o in p["more"]}
check(list(others) == ["AK Other", "Pixorize"], f"unpinned resources and AnKing's own tags go in 'more', by resource ({list(others)})")
check(others["Pixorize"] == [["Microbiology › Antifungals › Azoles", f"{S1}::#Pixorize::04_Microbiology::02_Antifungals::04_Azoles"]],
      "each with a readable path and its tag")
check(p["yield"] == "Lower" and p["banks"][0] == ("UWorld", 2), "the pane has its yield and banks")
lone = an.pane(an.card(["#AK_Brand_Name_Drugs::Cardiology::Other", "leech"]))
check(lone["groups"] == [] and lone["more"] == [
    {"label": "AK Brand Name Drugs", "tags": [["Cardiology › Other", "#AK_Brand_Name_Drugs::Cardiology::Other"]]},
    {"label": "", "tags": [["leech", "leech"]]},
], f"a tag outside your resources, and one with no path, last ({lone['more']})")
drugs = Analyzer(["#AK_Brand_Name_Drugs::Cardiology"], Plan(), 0.5)
check(drugs.pane(drugs.card(["#AK_Brand_Name_Drugs::Cardiology::Other"]))["groups"][0]["label"] == "AK Brand Name Drugs",
      "the one you're on reads without underscores too")
two_more = an.pane(an.card(KETO + ["#AK_Step2_v12::#Pixorize::03_Micro::Azoles"]))["more"]
check({"Pixorize (Step 1)", "Pixorize (Step 2)"} <= {o["label"] for o in two_more}, "other resources say which step too")

print("statuses change it")
done = Analyzer([TOPIC], Plan({f"{S1}::#B&B::09_Endocrinology": "completed", f"{S1}::#FirstAid::08_Endocrine": "completed",
                               f"{S1}::#B&B::22_Repro": "queued", f"{S1}::#Bootcamp::Reproduction": "queued",
                               f"{S1}::#FirstAid::15_Repro": "queued", f"{S1}::^Systems::Reproductive": "queued"}), 0.5)
f2 = done.card(KETO, suspended=True)
check(f2["verdict"] == "now", f"with Endocrine done and Repro queued, it's now ({f2['reason']})")
check({u: s for u, s, _ in f2["again"]} == {"Endocrine": "completed", "Repro": "queued"}, "and Again in says so")
later = Analyzer([TOPIC], Plan({f"{S1}::#B&B::22_Repro": "later"}), 0.5)
check(later.card(KETO, suspended=True)["verdict"] == "wait", "a system saved for later still counts as later")

print("a card that mostly belongs here")
CEF = [
    f"{TOPIC}::01_Cell_Wall::03_Cephalosporins",
    f"{S1}::#B&B::14_Infectious_Disease::02_Antibiotics::01_Beta_Lactams",
    f"{S1}::#Bootcamp::Microbiology::32_Neisseria",
    f"{S1}::#B&B::16_Neuro::05_Meningitis",
]
f3 = an.card(CEF, suspended=True)
check(f3["verdict"] == "now" and "Neuro" in f3["reason"], f"now, also in Neuro ({f3['reason']})")
check(an.card(CEF, suspended=False)["verdict"] is None, "only suspended cards get a verdict")

print("thresholds and overrides")
check(Analyzer([TOPIC], Plan(), 0.8).card(CEF, suspended=True)["verdict"] == "wait",
      "a higher threshold makes more cards wait")
high = KETO[:-2] + [f"{S1}::#Low/HighYield::1-HighYield"]
check(an.card(high, suspended=True)["verdict"] == "call", "high yield but mostly elsewhere: your call")
extra = [f"{TOPIC}::05_Antifungals::Extra", f"{S1}::#Bootcamp::Microbiology::37_Antifungals",
         f"{S1}::#B&B::22_Repro::05_Breast"]
f4 = an.card(extra, suspended=True)
check(f4["verdict"] == "wait" and "Extra" in f4["reason"], f"tagged here only as Extra leans to waiting ({f4['reason']})")
only = [f"{TOPIC}::05_Antifungals::03_Echinocandins", f"{S1}::#Bootcamp::Microbiology::37_Antifungals"]
check(an.card(only, suspended=True)["reason"] == "Only here", "a card nowhere else: now, only here")

print("the same resource in two steps")
two = KETO + [f"#AK_Step2_v12::#B&B::08_Infectious_Disease::02_Fungi"]
bare2 = Analyzer([TOPIC], None, 0.5)
labels2 = [g["label"] for g in bare2.pane(bare2.card(two))["groups"]]
check("B&B (Step 1)" in labels2 and "B&B (Step 2)" in labels2, f"say which step ({labels2})")

print("without Stepwise")
bare = Analyzer([TOPIC], None, 0.5)
f5 = bare.card(KETO, suspended=True)
check(f5["verdict"] == "wait", "still judged, every resource counting")
check(len(bare.pane(f5)["groups"]) >= 6, "and every resource shows")
check(Analyzer([], Plan(), 0.5).card(KETO, suspended=True)["verdict"] is None, "no topic, no verdict")
check(bare.system_shares(KETO) == {} and all(a[2] is None for a in f5["again"]), "and no system is done")

print("a system you've finished")
# Every tag in the collection, as far as systems go: Endocrine is 3 of 4
# topics done in the pinned resources, Repro 1 of 4.
EVERY = [
    f"{S1}::#B&B::09_Endocrinology::01_Thyroid",
    f"{S1}::#B&B::09_Endocrinology::02_Adrenals::02_Cushing_Syndrome",
    f"{S1}::#FirstAid::08_Endocrine::02_Physiology",
    f"{S1}::#FirstAid::08_Endocrine::03_Pathology",
    f"{S1}::#Pixorize::03_Pharmacology::10_Endocrine_Pharm",  # not pinned
    f"{S1}::#B&B::22_Repro::05_Breast::01_Breast_Tissue",
    f"{S1}::#Bootcamp::Reproduction::06_Pharmacology::04_Antiandrogens",
    f"{S1}::#FirstAid::15_Repro::05_Pharm::13_Antiandrogens::*Ketoconazole",
    f"{S1}::^Systems::Reproductive::Pharmacology",
    f"{TOPIC}::05_Antifungals::02_Azoles",  # Micro: not a system
    f"{S1}::#UWorld::Step::12345",
    f"{S1}::#B&B",
]
DONE = {f"{S1}::#B&B::09_Endocrinology::01_Thyroid": "completed",
        f"{S1}::#B&B::09_Endocrinology::02_Adrenals": "completed",
        f"{S1}::#FirstAid::08_Endocrine::03_Pathology": "completed",
        f"{S1}::#B&B::22_Repro::05_Breast": "completed"}


def finished(statuses, done_at=0.5):
    a = Analyzer([TOPIC], Plan(statuses), 0.5, done_at)
    a.shares = a.system_shares(EVERY)
    return a


fin = finished(DONE)
check(fin.shares == {"Endocrine": 0.75, "Repro": 0.25}, f"each system's share, pinned resources only ({fin.shares})")
f6 = fin.card(KETO, suspended=True)
check(f6["again"] == [["Endocrine", "completed", 75], ["Repro", None, 25]],
      f"Endocrine is done on the card though its First Aid place isn't; Repro isn't ({f6['again']})")
check(f6["verdict"] == "wait" and "Repro" in f6["reason"] and "Endocrine" not in f6["reason"],
      f"so it waits for Repro only ({f6['reason']})")
check(finished(DONE, 0.8).card(KETO)["again"][0][1] is None, "a higher threshold: Endocrine isn't done yet")
f7 = finished(DONE, 0.25).card(KETO, suspended=True)
check([a[1] for a in f7["again"]] == ["completed", "completed"] and f7["verdict"] == "now",
      f"a lower one: Repro is done too, and the card is for now ({f7['reason']})")
saved = finished({**DONE, f"{S1}::#FirstAid::08_Endocrine::02_Physiology": "later"})
check(saved.card(KETO)["again"][0][1] == "later", "a topic saved for later in a done system still says so")
print("all passed")
