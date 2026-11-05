"""Add a learner's private answers to their private word deck, so they sync with it (end-to-end encrypted).

Usage: build_answers.py <folder of p-NNN.json> <deck.json in> <deck.json out>

The answers and the deck are private: never commit them. This repo and its site are public. Each page file is
{"p": 9, "ex": [{"n": 1, "items": [["2", "answer"]], "note": "..."}, {"n": 5, "free": true}]}.
"""
import glob
import json
import os
import sys

folder, deck_in, deck_out = sys.argv[1], sys.argv[2], sys.argv[3]
pages, problems = {}, []
exercises = items = free = unsure = 0
for path in sorted(glob.glob(os.path.join(folder, "p-*.json"))):
    data = json.load(open(path, encoding="utf-8"))
    name = os.path.basename(path)
    if f"p-{data['p']:03d}.json" != name:
        problems.append(f"{name}: says page {data['p']}")
    for e in data["ex"]:
        exercises += 1
        if e.get("free"):
            free += 1
        elif not e.get("items"):
            problems.append(f"{name} ex {e.get('n')}: no items and not free")
        for it in e.get("items", []):
            items += 1
            if not (isinstance(it, list) and len(it) == 2 and str(it[1]).strip()):
                problems.append(f"{name} ex {e.get('n')}: bad item")
            elif "?" == str(it[1]).strip():
                unsure += 1
    pages[str(data["p"])] = data["ex"]

deck = json.load(open(deck_in, encoding="utf-8"))
deck["answers"] = {"book": "Grammaire progressive, débutant, 3e éd.", "by": "Claude", "pages": pages}
with open(deck_out, "w", encoding="utf-8") as f:
    json.dump(deck, f, ensure_ascii=False, separators=(",", ":"))
print(f"pages {len(pages)}, exercises {exercises}, items {items}, free {free}, unsure {unsure}")
print(f"deck {os.path.getsize(deck_out) / 1048576:.2f} MB")
for p in problems:
    print("PROBLEM", p)
sys.exit(1 if problems else 0)
