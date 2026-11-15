#!/usr/bin/env python3
"""Geometry audit for the deck PDF.

Checks, per slide: text outside the safe margins, text below the footer rule,
and near-duplicate text drawn at the same coordinates (the defect that produced
doubled severity badges on slide 13).
"""
import sys
import fitz

PDF = sys.argv[1] if len(sys.argv) > 1 else "out/Zaino-AI-Investor-Deck.pdf"
ML, MR = 0.75 * 72, None          # left margin in points
FOOT_RULE = 6.92 * 72

doc = fitz.open(PDF)
pw = doc[0].rect.width
ph = doc[0].rect.height
MR = pw - ML
print(f"page {pw:.0f}x{ph:.0f}pt  margins {ML:.0f}..{MR:.0f}")

bad = 0
for pi, page in enumerate(doc, 1):
    iss = []
    words = page.get_text("words")
    for w in words:
        x0, y0, x1, y1, t = w[0], w[1], w[2], w[3], w[4]
        if x0 < ML - 2:
            iss.append(f"LEFT   {x0:6.1f} '{t}'")
        if x1 > MR + 2:
            iss.append(f"RIGHT  {x1:6.1f} '{t}'")
        if y1 > ph - 14:
            iss.append(f"BELOW  {y1:6.1f} '{t}'")
        if y0 < 20:
            iss.append(f"ABOVE  {y0:6.1f} '{t}'")

    # duplicates: identical text, same origin, drawn twice
    seen = {}
    for w in words:
        key = (w[4], round(w[0], 1), round(w[1], 1))
        seen[key] = seen.get(key, 0) + 1
    for (t, x, y), n in seen.items():
        if n > 1 and t.strip():
            iss.append(f"DRAWx{n} ({x:.0f},{y:.0f}) '{t}'")

    status = "OK" if not iss else f"{len(iss)} issue(s)"
    print(f"slide {pi:2d}: {status}")
    for s in iss[:10]:
        print("    ", s)
    bad += len(iss)

print(f"\ntotal issues: {bad}")
sys.exit(1 if bad else 0)
