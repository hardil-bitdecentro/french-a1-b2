"""Build the tutor page: tutor/template.html plus the public plan, inlined because the page can't fetch other sites.

Usage: python3 -I scripts/build_tutor.py <schedule.json> <template.html> <output.html>
Only public plan data goes in: chapter numbers, pages, my own topic notes and task prompts.
"""
import json
import sys

schedule, template, output = sys.argv[1:4]
plan = json.load(open(schedule, encoding="utf-8"))


def compact(day):
    row = {"date": day["date"], "phase": day["phase"]}
    if not day.get("sunday"):
        row["book"] = day["book"]
        row["write"] = day.get("write", "")
        if day.get("book_pages"):
            row["pages"] = day["book_pages"]
        if day.get("book_topics"):
            row["topics"] = [{"ch": t["ch"], "topic": t["topic"]} for t in day["book_topics"]]
    return row


data = json.dumps([compact(d) for d in plan["days"]], ensure_ascii=False, separators=(",", ":"))
# The JSON sits inside a <script> tag, so a "</" in any text must not be able to close it.
data = data.replace("</", "<\\/")
html = open(template, encoding="utf-8").read()
assert html.count("__PLAN__") == 1
open(output, "w", encoding="utf-8").write(html.replace("__PLAN__", data))
print(f"{output}: {len(plan['days'])} days, {len(data) // 1024} KB of plan")
