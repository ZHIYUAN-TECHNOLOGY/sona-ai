#!/usr/bin/env python3
"""Score a harness run: recall of must-include facts, inventions (forbidden terms),
format obedience (Title line + '## ' sections + '- ' bullets).

  python3 score.py out_sealion.json
"""
import json, re, sys

rows = json.load(open(sys.argv[1]))
total_recall, inventions_total, format_ok = 0.0, 0, 0

for r in rows:
    out_low = r["output"].lower()
    # Tolerant match: "1 g" also matches "1g"; case-insensitive.
    def hit(term: str) -> bool:
        t = term.lower()
        return t in out_low or t.replace(" ", "") in out_low.replace(" ", "")

    must_hits = [m for m in r["must"] if hit(m)]
    missing = [m for m in r["must"] if not hit(m)]
    invented = [f for f in r["forbid"] if hit(f)]
    recall = len(must_hits) / len(r["must"]) if r["must"] else 1.0
    fmt = bool(re.search(r"^title\s*:", r["output"], re.I | re.M)) and "## " in r["output"] and "- " in r["output"]

    total_recall += recall
    inventions_total += len(invented)
    format_ok += fmt
    line = f"{r['id']:22s} recall {recall*100:5.1f}%  inventions {len(invented)}  format {'OK' if fmt else 'BAD'}"
    if missing:
        line += f"  missing: {missing}"
    if invented:
        line += f"  INVENTED: {invented}"
    print(line)

n = len(rows)
print(f"\nAVG recall {total_recall/n*100:.1f}% | total inventions {inventions_total} | format {format_ok}/{n}")
