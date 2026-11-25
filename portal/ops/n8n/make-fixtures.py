#!/usr/bin/env python3
"""Render synthetic D17 receipt fixtures for testing the vision read.

WHY SYNTHETIC. The repo has no real proof screenshot, and a real one is
someone's bank receipt. These render the LAYOUT and the failure modes the
reader must handle — clean, blurred, glare, wrong amount, missing number,
prose-instead-of-JSON — so the pipeline can be exercised end to end without
a customer's data leaving their phone.

Each fixture is a 900x1200 PNG written to fixtures/. The filenames encode
what the case is, because the test harness asserts against them.
"""

import json
import os
import struct
import zlib

W, H = 900, 1200
BG = (247, 245, 241)
INK = (28, 28, 30)
GREY = (110, 110, 115)
RULE = (205, 202, 196)
BAND = (14, 92, 120)

# 5x7 bitmap font, uppercase + digits + a few punctuation marks. Small but
# legible at 2-3x scale, which is what a vision model needs.
GLYPHS = {
    'A': ["01110","10001","10001","11111","10001","10001","10001"],
    'B': ["11110","10001","10001","11110","10001","10001","11110"],
    'C': ["01110","10001","10000","10000","10000","10001","01110"],
    'D': ["11110","10001","10001","10001","10001","10001","11110"],
    'E': ["11111","10000","10000","11110","10000","10000","11111"],
    'F': ["11111","10000","10000","11110","10000","10000","10000"],
    'G': ["01110","10001","10000","10111","10001","10001","01111"],
    'H': ["10001","10001","10001","11111","10001","10001","10001"],
    'I': ["01110","00100","00100","00100","00100","00100","01110"],
    'J': ["00111","00010","00010","00010","00010","10010","01100"],
    'K': ["10001","10010","10100","11000","10100","10010","10001"],
    'L': ["10000","10000","10000","10000","10000","10000","11111"],
    'M': ["10001","11011","10101","10101","10001","10001","10001"],
    'N': ["10001","11001","10101","10011","10001","10001","10001"],
    'O': ["01110","10001","10001","10001","10001","10001","01110"],
    'P': ["11110","10001","10001","11110","10000","10000","10000"],
    'Q': ["01110","10001","10001","10001","10101","10010","01101"],
    'R': ["11110","10001","10001","11110","10100","10010","10001"],
    'S': ["01111","10000","10000","01110","00001","00001","11110"],
    'T': ["11111","00100","00100","00100","00100","00100","00100"],
    'U': ["10001","10001","10001","10001","10001","10001","01110"],
    'V': ["10001","10001","10001","10001","10001","01010","00100"],
    'W': ["10001","10001","10001","10101","10101","11011","10001"],
    'X': ["10001","10001","01010","00100","01010","10001","10001"],
    'Y': ["10001","10001","01010","00100","00100","00100","00100"],
    'Z': ["11111","00001","00010","00100","01000","10000","11111"],
    '0': ["01110","10001","10011","10101","11001","10001","01110"],
    '1': ["00100","01100","00100","00100","00100","00100","01110"],
    '2': ["01110","10001","00001","00010","00100","01000","11111"],
    '3': ["11110","00001","00001","01110","00001","00001","11110"],
    '4': ["00010","00110","01010","10010","11111","00010","00010"],
    '5': ["11111","10000","11110","00001","00001","10001","01110"],
    '6': ["00110","01000","10000","11110","10001","10001","01110"],
    '7': ["11111","00001","00010","00100","01000","01000","01000"],
    '8': ["01110","10001","10001","01110","10001","10001","01110"],
    '9': ["01110","10001","10001","01111","00001","00010","01100"],
    '.': ["00000","00000","00000","00000","00000","01100","01100"],
    ',': ["00000","00000","00000","00000","01100","01100","00100"],
    ':': ["00000","01100","01100","00000","01100","01100","00000"],
    '-': ["00000","00000","00000","11111","00000","00000","00000"],
    '/': ["00001","00010","00010","00100","01000","01000","10000"],
    ' ': ["00000"]*7,
}


class Canvas:
    def __init__(self):
        self.px = [[BG for _ in range(W)] for _ in range(H)]

    def rect(self, x, y, w, h, color):
        for yy in range(max(0, y), min(H, y + h)):
            row = self.px[yy]
            for xx in range(max(0, x), min(W, x + w)):
                row[xx] = color

    def text(self, x, y, s, scale=2, color=INK):
        cx = x
        for ch in s.upper():
            g = GLYPHS.get(ch, GLYPHS[' '])
            for ry, line in enumerate(g):
                for rx, bit in enumerate(line):
                    if bit == '1':
                        self.rect(cx + rx * scale, y + ry * scale, scale, scale, color)
            cx += 6 * scale
        return cx

    def save(self, path, blur=0):
        raw = bytearray()
        for y in range(H):
            raw.append(0)
            for x in range(W):
                r, g, b = self.px[y][x]
                raw += bytes((r, g, b))
        if blur:
            raw = box_blur(raw, W, H, blur)
        write_png(path, W, H, raw)


def box_blur(raw, w, h, radius):
    # PNG rows carry a filter byte; strip, blur, re-add.
    stride = w * 3
    out = bytearray()
    for y in range(h):
        out.append(0)
        row_start = y * (stride + 1) + 1
        for x in range(stride):
            acc = 0
            n = 0
            for dy in (-radius, 0, radius):
                for dx in (-radius * 3, 0, radius * 3):
                    sy = min(h - 1, max(0, y + dy))
                    sx = min(stride - 1, max(0, x + dx))
                    acc += raw[sy * (stride + 1) + 1 + sx]
                    n += 1
            out.append(acc // n)
    return out


def write_png(path, w, h, raw):
    def chunk(tag, data):
        body = tag + data
        return (struct.pack('>I', len(data)) + body
                + struct.pack('>I', zlib.crc32(body) & 0xffffffff))
    ihdr = struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)
    with open(path, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n')
        f.write(chunk(b'IHDR', ihdr))
        f.write(chunk(b'IDAT', zlib.compress(bytes(raw), 9)))
        f.write(chunk(b'IEND', b''))


def receipt(amount, auth, sender, receiver, date, time="11:42"):
    c = Canvas()
    c.rect(0, 0, W, 150, BAND)
    c.text(60, 58, "LA POSTE", 5, (255, 255, 255))
    c.text(60, 108, "RECU DE TRANSFERT D'ARGENT", 2, (210, 232, 240))

    c.text(60, 200, "MONTANT TRANSFERE", 2, GREY)
    c.text(60, 240, f"{amount} DT", 7, INK)

    c.rect(60, 340, W - 120, 3, RULE)

    labels = [
        ("NUMERO D'AUTORISATION", auth),
        ("TELEPHONE EXPEDITEUR", sender),
        ("TELEPHONE DESTINATAIRE", receiver),
        ("DATE", date),
        ("HEURE", time),
    ]
    y = 390
    for label, value in labels:
        c.text(60, y, label, 2, GREY)
        c.text(60, y + 30, value, 3, INK)
        y += 110

    c.rect(60, 980, W - 120, 3, RULE)
    c.text(60, 1020, "MERCI DE CONSERVER CE RECU", 2, GREY)
    c.text(60, 1060, "SERVICE CLIENT 1828", 2, GREY)
    return c


OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixtures')
os.makedirs(OUT, exist_ok=True)

CASES = {}

# DATES ARE RELATIVE, NOT LITERAL.
#
# The first version printed 19/11/2026. That reads as the honest case on the
# day it was written and as a STALE receipt two days later, because
# checkDate() rejects anything older than D17_VERIFY_MAX_PROOF_AGE_HOURS
# (default 48). The end-to-end test then reported "an exact read passes" as a
# failure when nothing was wrong with the pipeline — the fixture had simply
# aged out. A receipt fixture is only meaningful relative to "now".
from datetime import datetime, timedelta

def _d(days_ago: int) -> str:
    return (datetime.now() - timedelta(days=days_ago)).strftime("%d/%m/%Y")

TODAY = _d(0)
STALE = _d(9)   # comfortably beyond the 48h window

# 1. The honest payment — must pass.
receipt("90.000", "A1B2C3D4", "20 123 456", "71 999 999",
        TODAY).save(f"{OUT}/clean_match.png")
CASES["clean_match.png"] = {"expect": "pass", "amount": "90.000", "auth": "A1B2C3D4"}

# 2. Underpayment — the Solo price against a Pro invoice. Must fail.
receipt("39.000", "A1B2C3D4", "20 123 456", "71 999 999",
        TODAY).save(f"{OUT}/wrong_amount.png")
CASES["wrong_amount.png"] = {"expect": "fail", "amount": "39.000", "auth": "A1B2C3D4"}

# 3. Wrong authorization number. Must fail.
receipt("90.000", "ZZ99XX77", "20 123 456", "71 999 999",
        TODAY).save(f"{OUT}/wrong_auth.png")
CASES["wrong_auth.png"] = {"expect": "fail", "amount": "90.000", "auth": "ZZ99XX77"}

# 4. Paid to a different merchant. Review, not fail.
receipt("90.000", "A1B2C3D4", "20 123 456", "71 000 000",
        TODAY).save(f"{OUT}/wrong_receiver.png")
CASES["wrong_receiver.png"] = {"expect": "review", "amount": "90.000", "auth": "A1B2C3D4"}

# 5. A stale receipt reused a week later. Review.
receipt("90.000", "A1B2C3D4", "20 123 456", "71 999 999",
        STALE).save(f"{OUT}/stale_date.png")
CASES["stale_date.png"] = {"expect": "review", "amount": "90.000", "auth": "A1B2C3D4"}

# 6. Blurred past legibility. An earlier version of this fixture at
#    radius 4 was still readable and the model transcribed it correctly —
#    which proved nothing. Radius 14 makes the digits genuinely
#    unreadable, so the assertion is live: the reader must return nulls,
#    never guess. A guess here is the hallucination this pipeline must not
#    produce.
receipt("90.000", "A1B2C3D4", "20 123 456", "71 999 999",
        "19/11/2026").save(f"{OUT}/blurred.png", blur=14)
CASES["blurred.png"] = {"expect": "review_no_guess"}

# 7. Not a receipt at all — a photo of a desk. Everything null, review.
c = Canvas()
c.rect(0, 0, W, H, (168, 150, 128))
c.rect(120, 300, 660, 420, (110, 96, 80))
c.text(200, 500, "PHOTO", 6, (150, 140, 125))
c.save(f"{OUT}/not_a_receipt.png")
CASES["not_a_receipt.png"] = {"expect": "review_no_guess"}

with open(f"{OUT}/cases.json", "w") as f:
    json.dump(CASES, f, indent=2)

print(f"wrote {len(CASES)} fixtures to {OUT}")
for name in CASES:
    print(f"  {name:22s} {os.path.getsize(f'{OUT}/{name}')//1024} KB")
