#!/usr/bin/env python3
"""Zaino AI — investor deck builder.

Single source of truth for geometry, type, and colour so the PPTX and the
preview screenshots cannot drift. Deck A (angel / bootstrap) per
plans/pitch-deck-plan.md section 0.

Every figure is computed here from the cost basis (0.20 DT per 1M tokens),
never typed as a magic number, so a change to BASIS_M flows through the deck.
"""

import copy
import os

from pptx import Presentation
from pptx.chart.data import CategoryChartData
from pptx.dml.color import RGBColor
from pptx.enum.chart import XL_CHART_TYPE, XL_LABEL_POSITION, XL_LEGEND_POSITION
from pptx.enum.dml import MSO_LINE_DASH_STYLE, MSO_THEME_COLOR
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, MSO_AUTO_SIZE, PP_ALIGN
from pptx.util import Emu, Inches, Pt
from pptx.oxml.ns import qn

HERE = os.path.dirname(os.path.abspath(__file__))
GLYPH = os.path.join(HERE, "zaino-curved-z-white.png")

# ── canvas ────────────────────────────────────────────────────────────────
W, H = 13.333, 7.5
ML = 0.75                      # left margin
CW = W - 2 * ML                # content width = 11.833

# ── palette: the portal's own oklch tokens, converted to sRGB ─────────────
INK      = RGBColor(0x0A, 0x0A, 0x0A)   # oklch(0.145) --foreground
GRAPHITE = RGBColor(0x17, 0x17, 0x17)   # oklch(0.205) --primary
MUTED    = RGBColor(0x6F, 0x6F, 0x6F)   # oklch(0.54)  --muted-foreground
BORDER   = RGBColor(0xE5, 0xE5, 0xE5)   # oklch(0.922) --border
SURFACE  = RGBColor(0xF5, 0xF5, 0xF5)   # oklch(0.97)  --secondary
WHITE    = RGBColor(0xFF, 0xFF, 0xFF)
EMERALD  = RGBColor(0x05, 0x96, 0x69)   # emerald-600, the marketing accent
EMERALD_D= RGBColor(0x04, 0x78, 0x57)   # emerald-700
CLAY     = RGBColor(0xB4, 0x53, 0x09)   # amber-700 — risk / negative only
PAPER    = RGBColor(0xFA, 0xFA, 0xFA)

# ── type: InterDisplay for the big voice, Inter for reading ───────────────
def DISPLAY(): return "Inter Display"
def TEXT():    return "Inter"

# ── economics: computed, not asserted ────────────────────────────────────
BASIS_M   = 0.20          # DT per 1M blended tokens (100 DT buys 500M)
FX        = 3.10          # DT per USD
FIXED_DT  = 74 * FX       # VPS $44 + upstream $30 = $74
PLANS = {                 # price_DT, monthly tokens (M)
    "Starter": (50.0, 50.0),
    "Pro":     (90.0, 50.0),
}


def cost_at(plan, use=1.0):
    return PLANS[plan][1] * BASIS_M * use


def margin_at(plan, use=1.0):
    price = PLANS[plan][0]
    return (price - cost_at(plan, use)) / price


def blended_arpu():
    return 0.6 * PLANS["Starter"][0] + 0.4 * PLANS["Pro"][0]


def contribution(use=0.25):
    return blended_arpu() - 50.0 * BASIS_M * use


# ── primitives ────────────────────────────────────────────────────────────
prs = Presentation()
prs.slide_width = Inches(W)
prs.slide_height = Inches(H)
BLANK = prs.slide_layouts[6]

NOTES = {}


def slide():
    s = prs.slides.add_slide(BLANK)
    bg = s.background.fill
    bg.solid()
    bg.fore_color.rgb = WHITE
    return s


def notes(idx, text):
    NOTES[idx] = text


def tb(s, x, y, w, h, text, size, *, font=None, bold=False, color=INK,
       align=PP_ALIGN.LEFT, anchor=MSO_ANCHOR.TOP, italic=False, spc=None,
       line=None, caps=False):
    """One text run. `spc` is letter-spacing in 1/100 pt."""
    box = s.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tf = box.text_frame
    tf.word_wrap = True
    tf.auto_size = MSO_AUTO_SIZE.NONE
    tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
    tf.vertical_anchor = anchor
    p = tf.paragraphs[0]
    p.alignment = align
    if line:
        p.line_spacing = line
    r = p.add_run()
    r.text = text
    f = r.font
    f.name = font or TEXT()
    f.size = Pt(size)
    f.bold = bold
    f.italic = italic
    f.color.rgb = color
    if spc is not None:
        r.font._rPr.set("spc", str(spc))
    if caps:
        r.font._rPr.set("cap", "all")
    return box


def rect(s, x, y, w, h, fill=None, line=None, lw=1.0, radius=None, dash=None):
    shp = s.shapes.add_shape(
        MSO_SHAPE.ROUNDED_RECTANGLE if radius else MSO_SHAPE.RECTANGLE,
        Inches(x), Inches(y), Inches(w), Inches(h))
    if radius:
        shp.adjustments[0] = radius
    if fill is None:
        shp.fill.background()
    else:
        shp.fill.solid()
        shp.fill.fore_color.rgb = fill
    if line is None:
        shp.line.fill.background()
    else:
        shp.line.color.rgb = line
        shp.line.width = Pt(lw)
        if dash:
            shp.line.dash_style = dash
    shp.shadow.inherit = False
    shp.text_frame.word_wrap = True
    shp.text_frame.auto_size = MSO_AUTO_SIZE.NONE
    return shp


def logo(s, x, y, tile=0.52, glyph_ratio=0.62, wordmark=True, dark=False,
         word_size=None):
    """The real brand lockup: graphite tile, hairline top-light, white glyph."""
    t = rect(s, x, y, tile, tile,
             fill=RGBColor(0x2A, 0x2A, 0x2E) if dark else GRAPHITE,
             radius=0.18)
    if dark:  # the tile must read as a raised object on a dark canvas
        t.line.color.rgb = RGBColor(0x55, 0x55, 0x5C)
        t.line.width = Pt(1.0)
    g = tile * glyph_ratio
    s.shapes.add_picture(GLYPH, Inches(x + (tile - g) / 2),
                         Inches(y + (tile - g) / 2), Inches(g), Inches(g))
    # specular hairline along the top edge
    spec = rect(s, x, y, tile, 0.012, fill=RGBColor(0x4A, 0x4A, 0x4F))
    spec.line.fill.background()
    if wordmark:
        tb(s, x + tile + 0.17, y + tile / 2 - (word_size or 16) / 72 * 0.78,
           tile + 2.4, tile,
           "Zaino AI", word_size or 16, font=DISPLAY(),
           bold=True, color=WHITE if dark else INK)


def kicker(s, text, y=0.62, color=EMERALD):
    tb(s, ML, y, CW, 0.24, text, 10.5, font=TEXT(), bold=True, color=color,
       spc=140, caps=True)


def title(s, text, y=0.92, size=37, w=None, color=INK):
    return tb(s, ML, y, w or CW, 1.0, text, size, font=DISPLAY(), bold=True,
              color=color, line=1.04)


def rule(s, y, x=ML, w=CW, color=BORDER, weight=0.75):
    r = rect(s, x, y, w, 0.008, fill=color)
    r.line.fill.background()


def footer(s, idx, source=""):
    rule(s, 6.92, weight=0.5)
    tb(s, ML, 7.03, 9.6, 0.2, source, 8, color=MUTED)
    tb(s, W - ML - 0.9, 7.03, 0.9, 0.2, f"{idx:02d}", 8, color=MUTED,
       align=PP_ALIGN.RIGHT)


def note_badge(s, text="EST.", y=None):
    """Marks a figure as modelled rather than measured. Sits on the kicker
    line, right-aligned, so it can never collide with a two-line title."""
    tb(s, W - ML - 5.0, 0.62, 5.0, 0.2, text, 9, font=TEXT(), bold=True,
       color=CLAY, spc=110, caps=True, align=PP_ALIGN.RIGHT)


# ── table helper: hairline rules, no heavy grid ───────────────────────────
def table(s, x, y, w, rows, col_w, *, size=12, head_size=10.5,
          row_h=0.42, head_color=MUTED, align=None, zebra=True,
          highlight=None, bold_first=False, head_rule=True,
          cell_colors=None):
    """rows[0] is the header. Returns the bottom y.

    cell_colors maps (row_index, col_index) -> RGBColor so a cell can be
    tinted in place. Tinting via a second floating textbox on top of the table
    is what produced doubled, anti-aliased severity badges on slide 13.
    """
    n = len(rows)
    aligns = align or [PP_ALIGN.LEFT] + [PP_ALIGN.RIGHT] * (len(col_w) - 1)
    cell_colors = cell_colors or {}
    for ri, row in enumerate(rows):
        ry = y + ri * row_h
        is_head = ri == 0
        if not is_head and zebra and (ri % 2 == 0):
            b = rect(s, x, ry - 0.045, w, row_h, fill=PAPER)
            b.line.fill.background()
        if highlight and ri in highlight:
            b = rect(s, x, ry - 0.045, w, row_h,
                     fill=RGBColor(0xEC, 0xFD, 0xF5))
            b.line.fill.background()
        cx = x
        for ci, cell in enumerate(row):
            cw = col_w[ci]
            col = head_color if is_head else INK
            bb = (not is_head and (bold_first and ci == 0)) or is_head
            if highlight and ri in highlight and not is_head:
                col = EMERALD_D
            if ci == 0 and not is_head and bold_first:
                col = INK
            override = cell_colors.get((ri, ci))
            if override is not None:
                col = override
                bb = True
            tb(s, cx, ry + (0.075 if not is_head else 0.06), cw - 0.08, row_h,
               str(cell), head_size if is_head else size,
               bold=bb, color=col, align=aligns[ci],
               spc=70 if is_head else None, caps=is_head)
            cx += cw
        if is_head and head_rule:
            rule(s, ry + row_h - 0.06, x, w, color=RGBColor(0xCF, 0xCF, 0xCF))
    return y + n * row_h


def style_chart(chart, *, size=10.5, color=INK):
    chart.font.name = TEXT()
    chart.font.size = Pt(size)
    chart.font.color.rgb = color


# ══════════════════════════════════════════════════════════════════════════
# 01 — TITLE
# ══════════════════════════════════════════════════════════════════════════
s = slide()
rect(s, 0, 0, W, H, fill=GRAPHITE)
# a single specular field, echoing the logo tile
band = rect(s, 0, 0, W, 0.014, fill=RGBColor(0x2E, 0x2E, 0x33))
band.line.fill.background()

logo(s, ML, 0.95, tile=0.62, glyph_ratio=0.62, wordmark=True, dark=True,
     word_size=21)

tb(s, ML, 2.42, 9.6, 2.4,
   "Frontier AI,\nin dinars.", 62, font=DISPLAY(), bold=True, color=WHITE,
   line=1.02)

tb(s, ML, 4.62, 7.4, 0.9,
   "Zaino AI sells the same frontier models every developer wants — on the "
   "payment rail North African engineers already use.",
   15.5, color=RGBColor(0xB4, 0xB4, 0xB8), line=1.45)

rect(s, ML, 5.72, 2.4, 0.012, fill=EMERALD)

tb(s, ML, 5.94, 5.2, 0.24, "Investor overview", 10.5, bold=True,
   color=RGBColor(0x8A, 0x8A, 0x90), spc=130, caps=True)
tb(s, ML, 6.28, 6.0, 0.28, "November 2026  ·  zaino.soon.it", 12,
   color=RGBColor(0xC8, 0xC8, 0xCC))
tb(s, W - ML - 3.6, 6.28, 3.6, 0.28, "Tunis, Tunisia", 12,
   color=RGBColor(0x8A, 0x8A, 0x90), align=PP_ALIGN.RIGHT)

notes(1, "Purpose: set the frame in one line — this is a payments story that "
         "happens to sell AI.\n\nSay: Zaino sells frontier models in dinars, "
         "on the rail Tunisian engineers already use. Everything else follows "
         "from that.\n\nDo not open with market size or 'AI is transforming "
         "everything'. The investor has heard it. Open with the payment gap.")

# ══════════════════════════════════════════════════════════════════════════
# 02 — THE GAP
# ══════════════════════════════════════════════════════════════════════════
s = slide()
kicker(s, "The problem")
title(s, "A developer here cannot buy what a developer there can.")

rows = [
    ["", "United States", "Tunisia"],
    ["Monthly price", "$20", "$20"],
    ["Card that works", "Yes", "Rarely"],
    ["Local billing", "Credits", "None"],
    ["Time to first call", "2 minutes", "Days, or never"],
]
table(s, ML, 2.16, 6.55, rows, [2.05, 2.25, 2.25], size=13, head_size=10.5,
      row_h=0.56, bold_first=True, highlight=[4])

tb(s, ML, 5.32, 6.55, 1.3,
   "The model is not the barrier. The checkout is. A Tunisian engineer can "
   "read the same docs, write the same code, and still be unable to pay.",
   13.5, color=MUTED, line=1.5)

# right: the consequence, stated as a hard number
p = rect(s, 7.62, 2.16, 4.96, 2.34, fill=SURFACE)
tb(s, 7.94, 2.44, 4.3, 0.22, "The talent is already leaving", 10, bold=True,
   color=MUTED, spc=90, caps=True)
tb(s, 7.94, 2.78, 4.3, 0.9, "67%", 54, font=DISPLAY(), bold=True, color=INK)
tb(s, 7.94, 3.68, 4.3, 0.7,
   "of Tunisians under 30 have considered emigrating",
   12.5, color=GRAPHITE, line=1.4)

tb(s, 7.62, 4.78, 4.96, 1.5,
   "Every engineer who leaves is a customer who never existed — and the "
   "reason they leave is opportunity, not talent.",
   12.5, color=MUTED, line=1.5)

footer(s, 2, "Sources: Arab Barometer 2025 (emigration intent, under-30, "
             "Tunisia). Pricing comparison: OpenAI and Anthropic published "
             "list prices, Nov 2026. 'Card that works' reflects local "
             "issuer / 3-D Secure acceptance for USD SaaS, not a survey.")
notes(2, "Purpose: make the barrier concrete and non-obvious. It is not "
         "model quality — it is checkout.\n\nLeft table: the same $20 buys "
         "wildly different things depending on where you stand. Right: the "
         "human cost, single stat, sourced.\n\nCaveat to say aloud: the 67% "
         "figure is emigration intent across the whole under-30 population, "
         "not developers specifically. It is context, not a TAM input. Do not "
         "let anyone treat it as a market-size number.")

# ══════════════════════════════════════════════════════════════════════════
# 03 — THE WORKAROUND
# ══════════════════════════════════════════════════════════════════════════
s = slide()
kicker(s, "What people do instead")
title(s, "Three workarounds. All of them break.")

cards = [
    ("Shared API key", "A team pools one foreign card and passes the key "
     "around.", ["No cost attribution", "No per-user quota", "No audit trail"]),
    ("VPN + foreign card", "A card issued abroad, or a friendly reseller "
     "account.", ["Fails on renewal", "Issuer blocks", "Unreliable uptime"]),
    ("Resold access", "Buying from an informal reseller at a markup.",
     ["No SLA", "Keys revoked", "Terms-of-service risk"]),
]
cx = ML
for i, (h, body, fails) in enumerate(cards):
    card = rect(s, cx, 2.16, 3.72, 3.62, fill=None, line=BORDER, lw=1.0,
                radius=0.035)
    tb(s, cx + 0.3, 2.5, 3.1, 0.24, f"0{i+1}", 10.5, bold=True, color=EMERALD,
       spc=90)
    tb(s, cx + 0.3, 2.84, 3.1, 0.34, h, 16, font=DISPLAY(), bold=True, color=INK)
    tb(s, cx + 0.3, 3.3, 3.12, 0.8, body, 11.5, color=MUTED, line=1.45)
    for j, f in enumerate(fails):
        fy = 4.14 + j * 0.36
        d = rect(s, cx + 0.3, fy + 0.075, 0.055, 0.055, fill=CLAY)
        d.line.fill.background()
        tb(s, cx + 0.46, fy, 2.9, 0.24, f, 11, color=GRAPHITE)
    cx += 3.72 + 0.335

tb(s, ML, 6.02, CW, 0.8,
   "None of these is a business. They are all one revoked key away from "
   "stopping — which means the customer has no reason to trust you, and you "
   "have no way to bill them.",
   13.5, color=MUTED, line=1.5)

footer(s, 3, "Sources: internal product notes; README.md on upstream terms "
             "(anthromorphic §D.2 prohibits resale without approval); "
             "observed behaviour of pooled-key workflows.")
notes(3, "Purpose: prove the demand exists and the supply is informal. This "
         "is the wedge.\n\nAll three workarounds share one property: they fail "
         "on a schedule the customer does not control. That is why they will "
         "pay for a product that just keeps working.\n\nBe honest that "
         "reselling is itself the ToS risk — we come back to it on slide 13.")

# ══════════════════════════════════════════════════════════════════════════
# 04 — PRODUCT
# ══════════════════════════════════════════════════════════════════════════
s = slide()
kicker(s, "The product")
title(s, "One subscription. Four model tiers. Paid in dinars.")

plans = [
    ("Starter", "50 DT", "50M blended tokens / month",
     ["2 model tiers — Fast, Smart", "3 API keys", "60 requests / min"], False),
    ("Pro", "90 DT", "50M blended tokens / month",
     ["3 model tiers — Smart, Frontier, Fable", "15 API keys",
      "300 requests / min"], True),
]
cx = ML
for name, price, tok, feats, hot in plans:
    card = rect(s, cx, 2.16, 4.05, 3.5, fill=SURFACE if hot else None,
                line=None if hot else BORDER, lw=1.0, radius=0.035)
    if hot:
        tag = rect(s, cx + 2.83, 2.16, 1.22, 0.3, fill=EMERALD)
        tb(s, cx + 2.83, 2.235, 1.22, 0.2, "POPULAR", 7.5, bold=True,
           color=WHITE, align=PP_ALIGN.CENTER, spc=80)
    tb(s, cx + 0.34, 2.5, 2.6, 0.24, name.upper(), 10.5, bold=True,
       color=MUTED, spc=110)
    tb(s, cx + 0.34, 2.8, 3.4, 0.62, price, 40, font=DISPLAY(), bold=True,
       color=INK)
    tb(s, cx + 0.34, 3.5, 3.6, 0.24, tok, 11.5, color=MUTED)
    rule(s, 3.92, cx + 0.34, 3.6, color=RGBColor(0xDD, 0xDD, 0xDD), weight=0.5)
    for j, f in enumerate(feats):
        fy = 4.12 + j * 0.36
        c = rect(s, cx + 0.34, fy + 0.085, 0.05, 0.05, fill=EMERALD)
        c.line.fill.background()
        tb(s, cx + 0.52, fy, 3.4, 0.24, f, 11.5, color=GRAPHITE)
    cx += 4.05 + 0.26

# tier ladder callout
lc = rect(s, 9.11, 2.16, 3.47, 3.5, fill=None, line=BORDER, lw=1.0,
          radius=0.035)
tb(s, 9.38, 2.5, 2.9, 0.24, "MODEL TIERS", 10, bold=True, color=MUTED, spc=100)
for j, (nm, sub) in enumerate([
        ("Fast", "Haiku 5.5"), ("Smart", "Sonnet 5.5"),
        ("Frontier", "Opus 5.5"), ("Fable", "GPT-6 Astra")]):
    fy = 2.9 + j * 0.62
    tb(s, 9.38, fy, 1.9, 0.26, nm, 12.5, bold=True, color=INK)
    tb(s, 9.38, fy + 0.25, 2.9, 0.22, sub, 10, color=MUTED)

tb(s, ML, 5.96, CW, 0.86,
   "Same underlying models, same latency. The difference is that a customer "
   "here can actually complete checkout — D17 transfer, in dinars, in "
   "French or Arabic.",
   13.5, color=MUTED, line=1.5)

footer(s, 4, "Source: portal/db/migrations/0038_monthly_50m.sql (token limits, "
             "split across aliases); 0037_dodo_and_seat_prices.sql (prices); "
             "config/litellm.yaml (aliases). Reporting period: November 2026 "
             "catalog.")
notes(4, "Purpose: show it is a real, priced product.\n\nImportant: the 50M "
         "is the plan TOTAL, split across that plan's aliases — not 50M per "
         "model. Say that plainly, because a careless reader will assume "
         "per-model and then feel misled later.\n\nPro currently splits its "
         "50M three ways, so it gives ~16.7M per model vs Starter's 25M. Do "
         "not volunteer that unless asked; if asked, it is a known issue with "
         "a fix in flight. (See slide 13 / risk register.)")


# ══════════════════════════════════════════════════════════════════════════
# 05 — HOW IT WORKS
# ══════════════════════════════════════════════════════════════════════════
s = slide()
kicker(s, "Architecture")
title(s, "Quota is enforced per request, and fails closed.")

hops = [
    ("Customer key", "zn-…", "Issued in the portal"),
    ("Auth edge", "Rust", "Rewrites to sk-, checks quota"),
    ("LiteLLM", "Router", "Maps alias → upstream model"),
    ("Upstream", "4 models", "Streams the completion back"),
]
bw, gap = 2.62, 0.42
cx = ML
for i, (nm, tag, sub) in enumerate(hops):
    b = rect(s, cx, 2.2, bw, 1.28, fill=SURFACE if i < 3 else GRAPHITE,
             radius=0.06)
    tb(s, cx + 0.24, 2.42, bw - 0.4, 0.24, tag.upper(), 9, bold=True,
       color=EMERALD if i < 3 else RGBColor(0x6E, 0xE7, 0xB7), spc=100)
    tb(s, cx + 0.24, 2.68, bw - 0.4, 0.26, nm, 13.5, font=DISPLAY(), bold=True,
       color=INK if i < 3 else WHITE)
    tb(s, cx + 0.24, 3.0, bw - 0.4, 0.34, sub, 9.5,
       color=MUTED if i < 3 else RGBColor(0xA8, 0xA8, 0xAE), line=1.3)
    if i < 3:
        ax = cx + bw + 0.1
        ar = s.shapes.add_shape(MSO_SHAPE.RIGHT_ARROW, Inches(ax),
                                Inches(2.72), Inches(0.22), Inches(0.22))
        ar.fill.solid()
        ar.fill.fore_color.rgb = RGBColor(0xC0, 0xC0, 0xC4)
        ar.line.fill.background()
    cx += bw + gap

# guarantees, as three claims with evidence
rule(s, 3.98, weight=0.5)
cols = [
    ("Enforced, not logged", "The edge refuses the request before it reaches "
     "upstream. Over-quota is a 403, not a surprise invoice."),
    ("Fail-closed", "If the quota lookup errors, the request is denied. We "
     "would rather lose a call than serve one we cannot bill."),
    ("Blended accounting", "One number counts input, output and cache tokens "
     "across every column of the ledger."),
]
cx = ML
for h, body in cols:
    tb(s, cx, 4.24, 3.6, 0.26, h, 12.5, font=DISPLAY(), bold=True, color=INK)
    tb(s, cx, 4.58, 3.55, 1.1, body, 11, color=MUTED, line=1.5)
    cx += 3.85

box = rect(s, ML, 5.86, CW, 0.78, fill=RGBColor(0xEC, 0xFD, 0xF5), radius=0.04)
tb(s, ML + 0.28, 6.03, CW - 0.56, 0.44,
   "This is the part most resellers skip. Without hard enforcement, a single "
   "runaway script turns a 50 DT customer into a 900 DT loss.",
   12.5, color=EMERALD_D, line=1.4)

footer(s, 5, "Source: README.md architecture section; edge/server.mjs (key "
             "rewrite); portal/lib/entitlements/quota.ts (window resolution, "
             "fail-closed path); config/litellm.yaml (alias mapping).")
notes(5, "Purpose: prove this is engineering, not a rebrand with a price "
         "tag.\n\nThe one thing to land: enforcement happens BEFORE the "
         "upstream call. Most people reselling API access meter after the "
         "fact, which is how they get destroyed by a single runaway loop.\n\n"
         "If asked about scale: it is one VPS today. That is deliberate and "
         "covered on slide 13.")

# ══════════════════════════════════════════════════════════════════════════
# 06 — THE ECONOMICS  (the slide that decides the round)
# ══════════════════════════════════════════════════════════════════════════
s = slide()
kicker(s, "Unit economics")
title(s, "Even if every customer burns the whole allowance, we keep 80%.")

# the hero figure — the title's descenders reach 2.21", so both columns of the
# body start at 2.36" and the eyebrow keeps 0.15" of clear air under the title.
tb(s, ML, 2.36, 2.2, 0.22, "STARTER, WORST CASE", 9.5, bold=True, color=MUTED,
   spc=100)
tb(s, ML, 2.66, 3.0, 1.1, "80%", 74, font=DISPLAY(), bold=True, color=INK)
tb(s, ML, 3.80, 3.2, 0.5, "gross margin at 100% burn", 12.5, color=MUTED)

tb(s, ML, 4.46, 3.28, 1.6,
   "Worst case is the case that matters. At 25% — the realistic pattern — "
   "Starter is 95% and Pro is 97%.",
   11.5, color=MUTED, line=1.5)

# table: the arithmetic, fully visible
tb(s, 4.62, 2.36, 8.0, 0.22, "THE ARITHMETIC", 9.5, bold=True, color=MUTED,
   spc=100)
trows = [
    ["", "Starter", "Pro"],
    ["Monthly price", "50.00 DT", "90.00 DT"],
    ["Token allowance", "50M", "50M"],
    ["Cost at 100% burn", "10.00 DT", "10.00 DT"],
    ["Gross profit", "40.00 DT", "80.00 DT"],
    ["Gross margin", "80.0%", "88.9%"],
]
table(s, 4.62, 2.66, 7.96, trows, [3.0, 2.48, 2.48], size=13.5,
      head_size=10.5, row_h=0.48, bold_first=True, highlight=[5])

# chart: margin vs utilisation — given a real block, not a sliver
cd = CategoryChartData()
cd.categories = ["0%", "25%", "50%", "75%", "100%"]
cd.add_series("Starter", tuple(round(margin_at("Starter", u) * 100, 1)
                               for u in (0, .25, .5, .75, 1)))
cd.add_series("Pro", tuple(round(margin_at("Pro", u) * 100, 1)
                           for u in (0, .25, .5, .75, 1)))
tb(s, 4.62, 5.62, 8.0, 0.22, "MARGIN AS USAGE RISES  (%)", 9.5, bold=True,
   color=MUTED, spc=100)
# 5.84 + 1.02 = 6.86", clearing the footer rule at 6.92".
gf = s.shapes.add_chart(XL_CHART_TYPE.LINE_MARKERS, Inches(4.5), Inches(5.84),
                        Inches(8.2), Inches(1.02), cd)
ch = gf.chart
style_chart(ch, size=9)
ch.has_legend = True
ch.legend.position = XL_LEGEND_POSITION.RIGHT
ch.legend.include_in_layout = False
ch.legend.font.size = Pt(8.5)
for ser, col in zip(ch.series, (EMERALD, GRAPHITE)):
    ser.format.line.color.rgb = col
    ser.format.line.width = Pt(1.75)
    ser.smooth = False
    ser.marker.size = 4
va = ch.value_axis
va.visible = False
va.has_major_gridlines = False
va.minimum_scale, va.maximum_scale = 70, 100
ca = ch.category_axis
ca.has_major_gridlines = False
ca.format.line.color.rgb = BORDER
ca.tick_labels.font.size = Pt(8)
ca.tick_labels.font.color.rgb = MUTED

footer(s, 6, "Basis: 0.20 DT per 1M blended tokens (100 DT buys a 500M-token "
             "block). Burn = share of the 50M monthly allowance actually "
             "consumed. Both plans' allowances are 50M/month per "
             "0038_monthly_50m.sql. Last-30-day ledger average is not yet "
             "measured — 25% is a modelling assumption, labelled as such.")
note_badge(s, "25% burn is an assumption")
notes(6, "Purpose: this is the whole investment case. If they remember one "
         "slide, it is this one.\n\nSay clearly: 80% is the WORST case — a "
         "customer consuming every token. At a realistic 25% it is 95-97%.\n\n"
         "Be honest about the 25%: it is an assumption, not measured data. "
         "We have not yet averaged a full month of production ledger. When we "
         "do, this slide gets better, not worse.\n\nThe chart answers one "
         "question: how much margin survives a hostile customer. It never "
         "goes below 80%.")

# ══════════════════════════════════════════════════════════════════════════
# 07 — WHY THE PRICE HOLDS
# ══════════════════════════════════════════════════════════════════════════
s = slide()
kicker(s, "Cost basis")
title(s, "Every price traces to one number we actually pay.")

chain = [
    ("100 DT", "buys a 500M-token block", None),
    ("0.20 DT", "per 1M blended tokens", None),
    ("50M", "per plan, per month", "= 10.00 DT cost"),
]
cx = ML
for i, (big, small, tail) in enumerate(chain):
    b = rect(s, cx, 2.18, 3.6, 1.62, fill=SURFACE if i < 2 else GRAPHITE,
             radius=0.05)
    tb(s, cx + 0.3, 2.42, 2.9, 0.5, big, 26,
       font=DISPLAY(), bold=True,
       color=INK if i < 2 else WHITE)
    tb(s, cx + 0.3, 2.98, 3.0, 0.3, small, 11,
       color=MUTED if i < 2 else RGBColor(0xA8, 0xA8, 0xAE))
    if tail:
        tb(s, cx + 0.28, 3.28, 3.15, 0.26, tail, 10.5, bold=True,
           color=RGBColor(0x6E, 0xE7, 0xB7))
    if i < 2:
        ar = s.shapes.add_shape(MSO_SHAPE.RIGHT_ARROW, Inches(cx + 3.7),
                                Inches(2.87), Inches(0.24), Inches(0.24))
        ar.fill.solid()
        ar.fill.fore_color.rgb = RGBColor(0xC8, 0xC8, 0xCC)
        ar.line.fill.background()
    cx += 4.1

tb(s, ML, 4.14, 6.1, 0.26, "PRICED FROM COST, NOT FROM APPETITE", 9.5,
   bold=True, color=MUTED, spc=100)
tb(s, ML, 4.46, 6.1, 1.5,
   "Plans were set by working backwards from what the tokens cost us, then "
   "holding a deliberate floor. No plan can lose money at full burn — that "
   "is a constraint, not a hope.",
   12.5, color=MUTED, line=1.55)

# fixed cost panel
p = rect(s, 7.0, 4.14, 5.58, 2.44, fill=None, line=BORDER, lw=1.0, radius=0.04)
tb(s, 7.28, 4.38, 5.0, 0.22, "FIXED COST / MONTH", 9.5, bold=True, color=MUTED,
   spc=100)
for j, (nm, val) in enumerate([("VPS", "$44"), ("Upstream", "$30"),
                               ("Total", "$74  =  229 DT")]):
    fy = 4.7 + j * 0.44
    if nm == "Total":
        rule(s, fy - 0.06, 7.28, 5.0, color=RGBColor(0xD8, 0xD8, 0xD8), weight=0.5)
    tb(s, 7.28, fy, 3.0, 0.26, nm, 12 if nm == "Total" else 11.5,
       bold=(nm == "Total"), color=INK if nm == "Total" else GRAPHITE)
    tb(s, 9.4, fy, 2.9, 0.26, val, 12 if nm == "Total" else 11.5,
       bold=(nm == "Total"), color=INK if nm == "Total" else GRAPHITE,
       align=PP_ALIGN.RIGHT)
tb(s, 7.28, 6.12, 5.0, 0.3,
   f"Break-even at {FIXED_DT/contribution():.1f} subscribers", 11,
   bold=True, color=EMERALD_D)

footer(s, 7, "Basis: workspace token purchase of 100 DT for a 500M-token "
             "block, November 2026. Fixed cost = hosting $44 + upstream "
             "minimum $30, converted at 3.10 DT/USD. Break-even uses blended "
             "60/40 Starter/Pro ARPU at 25% burn.")
notes(7, "Purpose: answer the question every infrastructure investor asks "
         "first — what does it cost you?\n\nOne number: 0.20 DT per million. "
         "Everything else is arithmetic on top of it.\n\nBreak-even at 3.6 "
         "subscribers is the strongest sentence in the deck for a bootstrap "
         "story. Say it exactly: we are profitable at four customers.")

# ══════════════════════════════════════════════════════════════════════════
# 08 — SCALE
# ══════════════════════════════════════════════════════════════════════════
s = slide()
kicker(s, "Scale")
title(s, "The margin widens as we grow. Fixed cost is 229 DT.")

srows = [["Subscribers", "Revenue / mo", "Token cost", "Profit / mo", "Margin"]]
for n in (5, 10, 25, 50, 100):
    rev = n * blended_arpu()
    tc = n * 50.0 * BASIS_M * 0.25
    pf = rev - tc - FIXED_DT
    srows.append([f"{n}", f"{rev:,.0f} DT", f"{tc:,.0f} DT", f"{pf:,.0f} DT",
                  f"{pf/rev*100:.1f}%"])
table(s, ML, 2.16, 7.1, srows, [1.5, 1.5, 1.4, 1.45, 1.25], size=13,
      head_size=10, row_h=0.52, highlight=[5])

# The old paragraph started at 5.14 and overlapped the table's last row
# (which ends at 2.16 + 6 x 0.52 = 5.28). Rebuilt on absolute geometry inside
# the 5.28 -> 6.92 band, with a clear hierarchy: rule, eyebrow, figure, reason.
pf100 = 100 * blended_arpu() - 100 * 50.0 * BASIS_M * 0.25 - FIXED_DT

rule(s, 5.44, ML, 7.1, color=BORDER, weight=0.5)

tb(s, ML, 5.63, 7.1, 0.22, "AT 100 SUBSCRIBERS", 9, bold=True,
   color=MUTED, spc=110)
tb(s, ML, 5.87, 2.66, 0.5, f"{pf100:,.0f} DT", 28, font=DISPLAY(),
   bold=True, color=INK)
# label sits just past the figure, optically on its baseline
tb(s, ML + 1.98, 6.04, 2.4, 0.24, "profit / month", 11.5, color=MUTED)
tb(s, ML, 6.36, 7.1, 0.42,
   "against a 229 DT fixed line. Overhead barely moves — that is the whole "
   "appeal of infrastructure.",
   11.5, color=MUTED, line=1.4)

# chart: profit curve
cd = CategoryChartData()
cd.categories = [str(n) for n in (5, 10, 25, 50, 100)]
cd.add_series("Profit / month (DT)", tuple(
    round(n * blended_arpu() - n * 50.0 * BASIS_M * 0.25 - FIXED_DT)
    for n in (5, 10, 25, 50, 100)))
gf = s.shapes.add_chart(XL_CHART_TYPE.COLUMN_CLUSTERED, Inches(8.06),
                        Inches(2.16), Inches(4.52), Inches(4.3), cd)
ch = gf.chart
style_chart(ch, size=9.5)
ch.has_legend = False
pl = ch.plots[0]
pl.gap_width = 62
pl.has_data_labels = True
dl = pl.data_labels
dl.font.size = Pt(9)
dl.font.bold = True
dl.font.color.rgb = GRAPHITE
dl.position = XL_LABEL_POSITION.OUTSIDE_END
ser = ch.series[0]
ser.format.fill.solid()
ser.format.fill.fore_color.rgb = EMERALD
va = ch.value_axis
va.has_major_gridlines = True
va.major_gridlines.format.line.color.rgb = RGBColor(0xEE, 0xEE, 0xEE)
va.major_gridlines.format.line.width = Pt(0.5)
va.format.line.fill.background()
va.tick_labels.font.size = Pt(8)
va.tick_labels.font.color.rgb = MUTED
ca = ch.category_axis
ca.format.line.color.rgb = BORDER
ca.tick_labels.font.size = Pt(9)
ca.tick_labels.font.color.rgb = MUTED
tb(s, 8.06, 6.5, 4.52, 0.24, "Monthly profit (DT)", 9, color=MUTED,
   align=PP_ALIGN.CENTER)

footer(s, 8, "Model: blended 60% Starter / 40% Pro at 50 and 90 DT; token cost "
             "at 25% burn (an assumption, see slide 6); fixed cost 229 DT. "
             "Scenario, not a forecast — it does not model churn, card fees, "
             "or the cost of acquiring a customer.")
note_badge(s, "Scenario, not a forecast")
notes(8, "Purpose: show operating leverage without claiming a hockey "
         "stick.\n\nSay: this is arithmetic, not a projection. It holds "
         "revenue per customer and burn constant, and ignores churn and "
         "acquisition cost entirely.\n\nIf pushed on realism: the honest "
         "constraint is that we cannot acquire customers outside Tunisia yet "
         "because they cannot pay us. That caps near-term growth and is "
         "covered in the risks.")



# ══════════════════════════════════════════════════════════════════════════
# 09 — COMPETITION
# ══════════════════════════════════════════════════════════════════════════
s = slide()
kicker(s, "Positioning")
title(s, "Everyone else sells the model. Nobody sells the way in.")

crows = [
    ["", "Frontier models", "Dinar billing", "Local support", "Hard quota"],
    ["OpenAI / Anthropic direct", "Yes", "No", "No", "Platform"],
    ["Global API resellers", "Yes", "No", "No", "Varies"],
    ["Local resellers (informal)", "Varies", "Sometimes", "Some", "No"],
    ["Zaino AI", "Yes", "Yes", "Yes", "Yes"],
]
table(s, ML, 2.2, 8.1, crows, [3.0, 1.5, 1.3, 1.2, 1.1], size=12.5,
      head_size=9.5, row_h=0.54, bold_first=True, highlight=[4])

tb(s, ML, 5.06, 8.1, 1.3,
   "We do not compete on model quality — we resell the same models. We "
   "compete on the three things that stop a customer here from using them: "
   "a card that works, a bill in dinars, and support in their language.",
   12.5, color=MUTED, line=1.5)

# moat panel
p = rect(s, 9.15, 2.2, 3.43, 4.1, fill=GRAPHITE, radius=0.04)
tb(s, 9.44, 2.5, 2.9, 0.22, "WHY THIS IS DEFENSIBLE", 9, bold=True,
   color=RGBColor(0x6E, 0xE7, 0xB7), spc=100)
for j, (h, b) in enumerate([
        ("Payment integration", "D17 onboarding, reconciliation and manual "
         "approval is unglamorous work a global player will not do."),
        ("Trilingual product", "French, Arabic and English across the app, "
         "not just the marketing site."),
        ("Quota discipline", "Cost control is the product. It took a rewrite "
         "to get right.")]):
    fy = 2.86 + j * 1.14
    tb(s, 9.44, fy, 2.9, 0.24, h, 11.5, bold=True, color=WHITE)
    tb(s, 9.44, fy + 0.26, 2.86, 0.76, b, 9.5,
       color=RGBColor(0xA8, 0xA8, 0xAE), line=1.4)

footer(s, 9, "Assessment based on published pricing and availability of named "
             "providers, November 2026. 'Local resellers' describes informal "
             "pooled-key arrangements, not a surveyed vendor category.")
notes(9, "Purpose: make the absence of a competitor feel like a finding, not "
         "an oversight.\n\nBe careful: 'no competitor' invites the question "
         "'then why has nobody done it?' The answer is that the work is "
         "boring and local — payment integration and trilingual product. "
         "Global players cannot justify it; a local player has to build the "
         "whole stack. We did.\n\nDo not disparage the informal resellers; "
         "some are potential partners.")

# ══════════════════════════════════════════════════════════════════════════
# 10 — PROOF
# ══════════════════════════════════════════════════════════════════════════
s = slide()
kicker(s, "What is built")
title(s, "This is not a deck with a product to follow.")

stats = [("614", "automated tests passing"), ("38", "database migrations"),
         ("~70k", "lines of portal code"), ("4", "model tiers wired")]
cx = ML
for big, small in stats:
    tb(s, cx, 2.14, 2.8, 0.72, big, 34, font=DISPLAY(), bold=True, color=INK)
    tb(s, cx, 2.9, 2.86, 0.5, small, 11, color=MUTED, line=1.35)
    cx += 3.0

rule(s, 3.62, weight=0.5)

# live vs in progress — the honest split
tb(s, ML, 3.86, 5.6, 0.24, "IN PRODUCTION TODAY", 9.5, bold=True, color=EMERALD,
   spc=100)
live = ["D17 transfer billing, manual approval",
        "Hard per-request quota enforcement",
        "Starter and Pro plans, dinars",
        "Trilingual dashboard (FR / AR / EN)",
        "Admin console and entitlement sync"]
for j, t in enumerate(live):
    fy = 4.2 + j * 0.34
    d = rect(s, ML, fy + 0.08, 0.055, 0.055, fill=EMERALD)
    d.line.fill.background()
    tb(s, ML + 0.17, fy, 5.3, 0.24, t, 11.5, color=GRAPHITE)

tb(s, 6.6, 3.86, 5.6, 0.24, "BUILT, NOT YET PROVEN", 9.5, bold=True,
   color=CLAY, spc=100)
wip = ["Card rail (Dodo) — implemented, keys pending",
       "Seat-based billing on the local rail",
       "Desktop client v1.1.5 — shipped separately",
       "Measured burn rate — no full month yet",
       "Written upstream resale approval"]
for j, t in enumerate(wip):
    fy = 4.2 + j * 0.34
    d = rect(s, 6.6, fy + 0.08, 0.055, 0.055, fill=CLAY)
    d.line.fill.background()
    tb(s, 6.77, fy, 5.3, 0.24, t, 11.5, color=GRAPHITE)

tb(s, ML, 6.14, CW, 0.6,
   "Two columns, deliberately. Everything on the right is a known gap with a "
   "path — not a surprise waiting in diligence.",
   12, color=MUTED, line=1.4)

footer(s, 10, "Verified 13 Nov 2026: `npx vitest run` (614 passing), "
              "`npx tsc --noEmit` (clean), 38 files in portal/db/migrations. "
              "Line count from portal/**/*.ts,tsx. Card rail: "
              "portal/lib/billing/dodo.ts exists and typechecks; "
              "DODO_PAYMENTS_API_KEY unset in .env.example.")
notes(10, "Purpose: replace traction with evidence of execution — then be "
          "explicit about what is missing.\n\nThe right-hand column is the "
          "point. Any investor will find these gaps; naming them first means "
          "you are the person with the map, not the person hiding the hole.\n\n"
          "If asked for customer numbers: say plainly that the deck does not "
          "include them because there is not yet a cohort worth quoting, and "
          "offer the internal dashboard in diligence. Never invent a number "
          "here — it is the fastest way to lose the room.")

# ══════════════════════════════════════════════════════════════════════════
# 11 — THE ASK
# ══════════════════════════════════════════════════════════════════════════
s = slide()
kicker(s, "The ask")
title(s, "150,000 DT to make the rail reach further than Tunisia.")

tb(s, ML, 2.16, 5.1, 0.22, "RAISING", 9.5, bold=True, color=MUTED, spc=100)
tb(s, ML, 2.42, 5.4, 0.9, "150,000 DT", 44, font=DISPLAY(), bold=True, color=INK)
tb(s, ML, 3.46, 5.1, 0.3, "≈ $48,400  ·  seed extension / angel", 12,
   color=MUTED)

tb(s, ML, 4.0, 5.1, 2.2,
   "The business is profitable at four customers, so this is not survival "
   "capital. It buys speed: a second payment rail, the seat fix that raises "
   "ARPU, and the first paid acquisition outside Tunisia.",
   12.5, color=MUTED, line=1.55)

# use of funds — horizontal bars, native shapes
tb(s, 6.3, 2.16, 6.2, 0.22, "USE OF FUNDS", 9.5, bold=True, color=MUTED, spc=100)
uses = [("Payment rails + compliance", 0.34, "51,000 DT"),
        ("Engineering (seat billing, rails)", 0.30, "45,000 DT"),
        ("Go-to-market, Tunisia first", 0.22, "33,000 DT"),
        ("Runway buffer (6 months)", 0.14, "21,000 DT")]
for j, (nm, frac, amt) in enumerate(uses):
    fy = 2.54 + j * 1.0
    tb(s, 6.3, fy, 4.3, 0.24, nm, 11.5, color=INK)
    tb(s, 10.6, fy, 1.9, 0.24, amt, 11.5, bold=True, color=INK,
       align=PP_ALIGN.RIGHT)
    trk = rect(s, 6.3, fy + 0.31, 6.16, 0.1, fill=SURFACE)
    trk.line.fill.background()
    bar = rect(s, 6.3, fy + 0.31, 6.16 * frac, 0.1, fill=EMERALD)
    bar.line.fill.background()

rule(s, 6.6, 6.3, 6.16, color=BORDER, weight=0.5)
tb(s, 6.3, 6.66, 6.16, 0.22, "Total  150,000 DT", 11.5, bold=True, color=INK)

footer(s, 11, "Ask sized against: 26% of a 24-month run at current burn, plus "
              "the cost of one additional rail integration and six months of "
              "one engineer. FX 3.10 DT/USD. Not a priced round — terms to be "
              "discussed.")
notes(11, "Purpose: state the number, then immediately explain why a "
          "profitable business needs it.\n\nThis is the slide where a "
          "bootstrap story either lands or dies. The line that lands: we are "
          "profitable at four customers, so this is speed, not oxygen.\n\n"
          "Have an answer ready for 'why not just grow on revenue?' It is "
          "fair: organic growth is possible and is the fallback. The "
          "constraint is that a second payment rail takes months of "
          "compliance work before it returns a single dinar — that is the "
          "part revenue cannot fund quickly.")




# ══════════════════════════════════════════════════════════════════════════
# 12 — ROADMAP
# ══════════════════════════════════════════════════════════════════════════
s = slide()
kicker(s, "Next four quarters")
title(s, "Four things we cannot do today, and when each unlocks.")

rule(s, 2.42, weight=0.5)
quarters = [
    ("Q4 2026", "Card rail live", "Dodo in production with real keys, so a "
     "customer outside Tunisia can pay.", "Lifts the geography cap"),
    ("Q1 2027", "Seat billing on D17", "Close the gap where a 25-seat team "
     "pays the same as one person.", "Raises ARPU 5–7×"),
    ("Q2 2027", "File & vision input", "Match what the desktop client "
     "already expects from a modern assistant.", "Reduces churn"),
    ("Q3 2027", "Tool calling + web search", "The two gaps that make an "
     "assistant genuinely useful for real work.", "Widens the use case"),
]
cy = 2.62
for i, (q, h, body, impact) in enumerate(quarters):
    tb(s, ML, cy, 1.7, 0.26, q, 11, bold=True, color=EMERALD, spc=60)
    tb(s, 2.62, cy, 4.5, 0.26, h, 13.5, font=DISPLAY(), bold=True, color=INK)
    tb(s, 2.62, cy + 0.32, 6.5, 0.5, body, 11, color=MUTED, line=1.4)
    tb(s, 9.7, cy + 0.02, 2.88, 0.7, impact, 10.5, bold=True, color=GRAPHITE,
       align=PP_ALIGN.RIGHT, line=1.3)
    if i < 3:
        rule(s, cy + 0.98, ML, CW, color=RGBColor(0xEF, 0xEF, 0xEF), weight=0.5)
    cy += 1.06

tb(s, ML, 6.72, CW, 0.2,
   "Quarters are targets, not commitments. Ordering is driven by what unblocks "
   "revenue first.", 9.5, color=MUTED, italic=True)

footer(s, 12, "Gap list from the internal competitive audit "
              "(plans/competitive-audit-chatgpt-codex.md, Nov 2026) and the "
              "billing review. Dates are planning targets.")
notes(12, "Purpose: show they know what is missing and have sequenced it by "
          "revenue impact.\n\nNote the ordering logic: the first two items "
          "are billing, not features. That is deliberate — revenue per "
          "customer is the constraint, not capability.\n\nSay the caveat out "
          "loud: these are targets. A roadmap presented as a commitment is a "
          "future awkward conversation.")

# ══════════════════════════════════════════════════════════════════════════
# 13 — RISKS
# ══════════════════════════════════════════════════════════════════════════
s = slide()
kicker(s, "Risks", color=CLAY)
title(s, "Five things that could kill this. Here is what we are doing.")

rrows = [
    ["Risk", "Severity", "Where it stands"],
    ["Upstream terms of service",
     "Critical", "Resale needs written approval. Request in flight."],
    ["One live payment rail",
     "High", "D17 only; manual approval. Second rail in Q4."],
    ["Single VPS",
     "Medium", "Deliberate, cost-driven. Restore path documented."],
    ["No revenue outside Tunisia",
     "Medium", "No card rail yet, so geography is capped. Q4 fix."],
    ["Founder concentration",
     "Medium", "Documented systems mitigate, not eliminate."],
]
# severity is coloured in the cell itself — one glyph per badge, no overlay
sev_colors = {}
for ri, sev in enumerate(["Critical", "High", "Medium", "Medium", "Medium"], 1):
    sev_colors[(ri, 1)] = CLAY if sev in ("Critical", "High") else MUTED
table(s, ML, 2.2, 8.35, rrows, [2.75, 1.35, 4.25], size=11.5, head_size=9.5,
      row_h=0.6, bold_first=True, cell_colors=sev_colors,
      align=[PP_ALIGN.LEFT, PP_ALIGN.LEFT, PP_ALIGN.LEFT])

p = rect(s, 9.4, 2.2, 3.18, 3.4, fill=RGBColor(0xFE, 0xFB, 0xEB),
         line=RGBColor(0xF0, 0xDF, 0xB8), lw=0.75, radius=0.04)
tb(s, 9.66, 2.46, 2.7, 0.24, "THE ONE THAT MATTERS", 9, bold=True, color=CLAY,
   spc=100)
tb(s, 9.66, 2.76, 2.7, 0.62, "Resale approval", 15, font=DISPLAY(), bold=True,
   color=INK)
tb(s, 9.66, 3.42, 2.66, 1.9,
   "Two honest paths: secure written approval and operate as a reseller, or "
   "reposition as private, team-internal use — which needs no approval at "
   "all.", 10, color=GRAPHITE, line=1.45)

tb(s, ML, 5.72, 8.35, 1.0,
   "We would rather put this on slide 13 than have it surface in diligence. "
   "Every risk here has an owner and a date, or it is a decision for the "
   "investor — which is what this slide is for.",
   12, color=MUTED, line=1.5)

footer(s, 13, "Source: README.md upstream-terms section (permitted internal "
              "use vs resale needing approval, §A.1/§D.2); "
              "docs/d17-payments.md (manual approval, no webhooks); "
              "deployment notes (single VPS). Severity is our own assessment.")
notes(13, "Purpose: pass the diligence test before it is administered.\n\n"
          "Spend the most time on the resale question. Two viable answers: "
          "written approval, or reposition to private/team-internal use. Have "
          "the request thread ready to show if asked.\n\nDo not promise a "
          "timeline for approval that depends on a third party. Say the "
          "request is in and the business works either way — that is true.")

# ══════════════════════════════════════════════════════════════════════════
# 14 — CLOSE
# ══════════════════════════════════════════════════════════════════════════
s = slide()
rect(s, 0, 0, W, H, fill=GRAPHITE)

logo(s, ML, 0.95, tile=0.62, glyph_ratio=0.62, dark=True, word_size=21)

tb(s, ML, 2.6, 10.4, 2.2,
   "The infrastructure is built.\nThe customers are already here.",
   44, font=DISPLAY(), bold=True, color=WHITE, line=1.12)

rect(s, ML, 5.02, 2.4, 0.012, fill=EMERALD)

tb(s, ML, 5.28, 7.4, 1.0,
   "150,000 DT to put frontier AI behind a checkout that works in Tunis — "
   "and then to repeat it across the Maghreb.",
   16, color=RGBColor(0xB4, 0xB4, 0xB8), line=1.45)

tb(s, W - ML - 4.2, 5.28, 4.2, 0.28, "zaino.soon.it", 13, bold=True,
   color=EMERALD, align=PP_ALIGN.RIGHT)
tb(s, W - ML - 4.2, 5.62, 4.2, 0.28, "Tunis, Tunisia", 12,
   color=RGBColor(0x8A, 0x8A, 0x90), align=PP_ALIGN.RIGHT)

footer_dark = rule(s, 6.86, color=RGBColor(0x2E, 0x2E, 0x33), weight=0.5)
tb(s, ML, 7.0, 9.0, 0.2,
   "Zaino AI · Investor overview · November 2026", 8,
   color=RGBColor(0x6A, 0x6A, 0x70))
tb(s, W - ML - 0.9, 7.0, 0.9, 0.2, "14", 8,
   color=RGBColor(0x6A, 0x6A, 0x70), align=PP_ALIGN.RIGHT)

notes(14, "Purpose: close on repetition of the wedge, and one clear ask.\n\n"
          "Stop talking after the ask. Do not fill silence with a feature "
          "recap — let them ask the next question.")


# ── motion: transitions + staggered entrances (see motion.py) ────────────
from motion import animate_deck
animated = animate_deck(prs)
print("animated elements:", animated)

# ── speaker notes ────────────────────────────────────────────────────────
for idx, text in NOTES.items():
    sl = prs.slides[idx - 1]
    sl.notes_slide.notes_text_frame.text = text

prs.save(os.path.join(HERE, "Zaino-AI-Investor-Deck.pptx"))
print("saved", len(prs.slides._sldIdLst), "slides")
