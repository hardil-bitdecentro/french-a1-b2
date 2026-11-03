"""Extract the main word list from the "5000 most frequently used French words [v. 6.0]" Anki decks.

Usage: python3 -I scripts/parse_apkg.py OUT.json PART1.apkg [PART2.apkg ...]

Reads only the "5000 French Words 2.0 (F to E)" note type and writes a compact JSON word list
for the app's private "Import word deck" button. The output is personal data: keep it OUT of
this repository (the site and repo are public). Nothing from the decks is committed here.
"""

import html
import json
import re
import sqlite3
import sys
import tempfile
import zipfile
from pathlib import Path

MODEL = "5000 French Words 2.0 (F to E)"
SENTENCES = "French sentences Read Training"  # Front = French, Back = English
POS = {"n", "v", "adj", "adv", "prep", "conj", "pron", "det", "interj", "num", "art"}


def strip(s: str) -> str:
    s = re.sub(r"<br\s*/?>", " ", s, flags=re.I)
    s = re.sub(r"<[^>]+>", "", s)
    s = html.unescape(s).replace("\xa0", " ")
    return re.sub(r"\s+", " ", s).strip()


def gender(article_html: str) -> str:
    has_f, has_m = "<red>" in article_html, "<blue>" in article_html
    if has_f and has_m:
        return "mf"
    return "f" if has_f else "m" if has_m else ""


def examples(field: str) -> list:
    pairs = re.findall(r"<b>(.*?)</b>\s*<i>(.*?)</i>", field, flags=re.S)
    return [[strip(fr), strip(en)] for fr, en in pairs if strip(fr) and strip(en)][:3]


def meaning(field: str) -> tuple:
    text = strip(field)
    m = re.match(r"^((?:[a-z]+\.\s*)+)(.*)$", text)
    if not m:
        return "", text
    pos = " ".join(p.strip() for p in m.group(1).split() if p.strip())
    # Later parts of speech inside the gloss ("the pro. it") become separate clauses ("the; pro. it").
    rest = re.sub(r"\s+((?:n|v|adj|adv|pro|prep|conj|art|det|int|num)\.)\s", r"; \1 ", m.group(2).strip())
    return pos, rest


def read_deck(apkg: Path) -> tuple:
    with tempfile.TemporaryDirectory() as tmp:
        db = Path(tmp) / "c.anki2"
        with zipfile.ZipFile(apkg) as z:
            db.write_bytes(z.read("collection.anki2"))
        con = sqlite3.connect(db)
        models = json.loads(con.execute("select models from col").fetchone()[0])
        decks = json.loads(con.execute("select decks from col").fetchone()[0])
        mid = next(int(k) for k, m in models.items() if m["name"] == MODEL)
        names = [f["name"] for f in models[str(mid)]["flds"]]
        rows = con.execute("select flds, tags from notes where mid = ?", (mid,)).fetchall()
        sentences = []
        smid = next((int(k) for k, m in models.items() if m["name"] == SENTENCES), None)
        if smid is not None:
            # The deck's own new-card order (easy → harder), basic subdeck before intermediate.
            srows = con.execute(
                "select n.flds, c.did from notes n join cards c on c.nid = n.id where n.mid = ? order by c.due",
                (smid,),
            ).fetchall()
            for flds, did in srows:
                fr, en = (flds.split("\x1f") + ["", ""])[:2]
                level = "i" if "Intermediate" in decks[str(did)]["name"] else "b"
                if strip(fr) and strip(en):
                    sentences.append([strip(fr), strip(en), level])
            sentences.sort(key=lambda x: x[2] != "b")  # stable: basic first, deck order kept
        con.close()
    out = []
    for flds, tags in rows:
        f = dict(zip(names, flds.split("\x1f")))
        rank = re.search(r"\d+", f.get("Frequency Index", ""))
        if not rank:
            continue
        pos_from_meaning, gloss = meaning(f.get("Basic meanings of word", ""))
        tag_pos = [t for t in tags.split() if t in POS]
        ipa = re.search(r"/[^/]+/", f.get("IPA", ""))
        out.append({
            "r": int(rank.group()),
            "w": strip(f.get("Word", "")),
            "a": strip(f.get("Word with article", "")),
            "g": gender(f.get("Word with article", "")),
            "pos": " ".join(tag_pos) or pos_from_meaning.rstrip("."),
            "m": gloss,
            "ipa": ipa.group() if ipa else "",
            "d": strip(f.get("Noun declension", "")).strip("[]"),
            "ex": examples(f.get("Example sentences", "")),
        })
    return out, sentences


def main() -> None:
    out_path, *decks = sys.argv[1:]
    words, sentences = {}, []
    for d in decks:
        ws, ss = read_deck(Path(d))
        for w in ws:
            words.setdefault(w["r"], w)
        sentences = sentences or ss
    ordered = [words[r] for r in sorted(words)]
    data = {
        "name": "5000 most frequently used French words [v. 6.0]",
        "source": "AnkiWeb shared decks 893324022 + 1543609595 (personal use)",
        "count": len(ordered),
        "words": ordered,
        "sentences": sentences,
    }
    Path(out_path).write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    missing = [r for r in range(1, max(words) + 1) if r not in words]
    print(f"{len(ordered)} words, ranks {min(words)}–{max(words)}, missing ranks: {len(missing)} {missing[:10]}")
    print(f"{len(sentences)} sentences ({sum(1 for s in sentences if s[2] == 'b')} basic)")


if __name__ == "__main__":
    main()
