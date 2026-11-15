#!/bin/bash
# Render every slide to PNG via LibreOffice -> PDF -> pdftoppm-less path.
set -e
D="$(cd "$(dirname "$0")" && pwd)"
SOF=/tmp/LO.app/Contents/MacOS/soffice
rm -rf "$D/out" && mkdir -p "$D/out"
"$SOF" --headless --convert-to pdf "$D/Zaino-AI-Investor-Deck.pptx" --outdir "$D/out" >/dev/null 2>&1
cd "$D/out"
# rasterise with Quartz via sips on the PDF is unreliable; use python + pdftocairo if present
if command -v pdftocairo >/dev/null; then
  pdftocairo -png -r 110 Zaino-AI-Investor-Deck.pdf slide
else
  python3 - "$D/out/Zaino-AI-Investor-Deck.pdf" <<'PY'
import sys, subprocess, os
pdf=sys.argv[1]; out=os.path.dirname(pdf)
# Use macOS PDFKit through a tiny PyObjC-free path: qlmanage per page won't work.
print("NO_PDFTOPO")
PY
fi
ls -1 "$D/out" | head
