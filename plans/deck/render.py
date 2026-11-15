#!/usr/bin/env python3
"""Render the deck: PPTX -> PDF (LibreOffice) -> per-slide PNG (PyMuPDF)."""
import glob, os, subprocess, sys
import fitz

HERE = os.path.dirname(os.path.abspath(__file__))
SOF = "/tmp/LO.app/Contents/MacOS/soffice"
PPTX = os.path.join(HERE, "Zaino-AI-Investor-Deck.pptx")
OUT = os.path.join(HERE, "out")

os.makedirs(OUT, exist_ok=True)
for f in glob.glob(os.path.join(OUT, "*.pdf")):
    os.remove(f)
subprocess.run([SOF, "--headless", "--convert-to", "pdf", PPTX, "--outdir", OUT],
               check=True, capture_output=True)

pdf = os.path.join(OUT, "Zaino-AI-Investor-Deck.pdf")
doc = fitz.open(pdf)
for i, page in enumerate(doc, 1):
    pix = page.get_pixmap(dpi=110)
    pix.save(os.path.join(OUT, f"slide-{i:02d}.png"))
print(f"rendered {len(doc)} slides -> {OUT}")
