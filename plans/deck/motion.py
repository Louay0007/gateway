#!/usr/bin/env python3
"""PowerPoint-native motion for the Zaino deck.

Two layers:
  1. <p:transition>  a 500ms cross-fade between slides. Invisible by design.
  2. <p:timing>      staggered Fade entrances (presetID 10), auto-starting on
                     slide entry, ordered top-to-bottom so the eye is led
                     through the argument rather than everything arriving at
                     once.

Why raw XML: python-pptx has no animation API, so the timing tree is injected
directly. The OOXML schema is order-sensitive and id-uniqueness is enforced by
PowerPoint (a duplicate cTn/@id makes the file unopenable, not merely ugly),
so ids are allocated from a single counter per slide and the element order is
fixed. Everything here is validated by reopening the file afterwards.
"""

from lxml import etree
from pptx.oxml.ns import qn

P_NS = "http://schemas.openxmlformats.org/presentationml/2006/main"
A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main"

# Entrance preset ids from PowerPoint's own table.
FADE = 10
FADE_DUR = 400          # ms, per element
STAGGER = 130           # ms between visual BANDS, not between elements
MAX_START = 1100        # ms ceiling, so the slide is settled in ~1.5s


def _el(tag, **attrs):
    e = etree.SubElement if False else None
    return None


def _mk(tag, **attrs):
    e = etree.Element(qn(tag), nsmap={"p": P_NS, "a": A_NS})
    for k, v in attrs.items():
        e.set(k, str(v))
    return e


def _sub(parent, tag, **attrs):
    e = etree.SubElement(parent, qn(tag))
    for k, v in attrs.items():
        e.set(k, str(v))
    return e


def _band(shape):
    """Group shapes into visual bands (half-inch buckets by top edge).

    A table row shares a top edge, so its cells land in one band and fade in
    together. Animating each cell separately reads as chaos; cascading rows
    reads as intent."""
    return round((shape.top / 914400.0) * 2) / 2.0


def _order_key(shape):
    """Reading order: down the slide, then left to right within a band."""
    return (_band(shape), shape.left / 914400.0)


def _skip(shape):
    """Chrome and hairlines should not animate — movement there reads as noise."""
    try:
        top = shape.top / 914400.0
        w = shape.width / 914400.0
        h = shape.height / 914400.0
    except TypeError:
        return True
    if shape.shape_type is not None and shape.has_text_frame is False:
        pass
    if w >= 13.0 and h >= 7.0:          # full-bleed background
        return True
    if top >= 6.82:                      # footer band + footer rule
        return True
    if h <= 0.035 or w <= 0.09:          # hairlines, dots, arrows
        return True
    return False


def animate_slide(slide, *, transition="fade", speed="med"):
    """Attach a transition and staggered Fade entrances to one slide."""
    sld = slide._element

    # ── 1. transition (schema order: cSld, clrMapOvr, transition, timing) ──
    for old in sld.findall(qn("p:transition")):
        sld.remove(old)
    tr = _mk("p:transition", spd=speed)
    _sub(tr, "p:fade")
    clr = sld.find(qn("p:clrMapOvr"))
    if clr is not None:
        clr.addnext(tr)
    else:
        sld.append(tr)

    # ── 2. gather targets in reading order ────────────────────────────────
    targets = [sh for sh in slide.shapes if not _skip(sh)]
    targets.sort(key=_order_key)
    if not targets:
        return 0

    # one delay per band, so co-planar shapes arrive as a unit
    bands = []
    for sh in targets:
        b = _band(sh)
        if b not in bands:
            bands.append(b)
    band_index = {b: i for i, b in enumerate(bands)}

    # ── 3. timing tree ───────────────────────────────────────────────────
    for old in sld.findall(qn("p:timing")):
        sld.remove(old)
    timing = _mk("p:timing")
    tnLst = _sub(timing, "p:tnLst")
    par0 = _sub(tnLst, "p:par")
    ctn0 = _sub(par0, "p:cTn", id=1, dur="indefinite", restart="never",
                nodeType="tmRoot")
    child0 = _sub(ctn0, "p:childTnLst")
    seq = _sub(child0, "p:seq", concurrent=1, nextAc="seek")
    ctn1 = _sub(seq, "p:cTn", id=2, dur="indefinite", nodeType="mainSeq")
    child1 = _sub(ctn1, "p:childTnLst")

    grp = _sub(child1, "p:par")
    # delay=0 so the whole sequence plays on slide entry; no clicking.
    grp_ctn = _sub(grp, "p:cTn", id=3, fill="hold")
    st = _sub(grp_ctn, "p:stCondLst")
    _sub(st, "p:cond", delay=0)
    grp_child = _sub(grp_ctn, "p:childTnLst")

    nxt = 4
    for sh in targets:
        delay = min(MAX_START, band_index[_band(sh)] * STAGGER)
        spid = sh.shape_id
        par = _sub(grp_child, "p:par")
        ctn = _sub(par, "p:cTn", id=nxt, presetID=FADE, presetClass="entr",
                   presetSubtype=0, fill="hold", grpId=0,
                   nodeType="withEffect")
        nxt += 1
        stc = _sub(ctn, "p:stCondLst")
        _sub(stc, "p:cond", delay=delay)
        kids = _sub(ctn, "p:childTnLst")

        # visibility -> visible, so the fade has a defined start state
        setn = _sub(kids, "p:set")
        beh = _sub(setn, "p:cBhvr")
        sctn = _sub(beh, "p:cTn", id=nxt, dur=1, fill="hold")
        nxt += 1
        sst = _sub(sctn, "p:stCondLst")
        _sub(sst, "p:cond", delay=0)
        tg = _sub(beh, "p:tgtEl")
        _sub(tg, "p:spTgt", spid=spid)
        anl = _sub(beh, "p:attrNameLst")
        an = _sub(anl, "p:attrName")
        an.text = "style.visibility"
        to = _sub(setn, "p:to")
        sv = _sub(to, "p:strVal", val="visible")

        # the fade itself
        eff = _sub(kids, "p:animEffect", transition="in", filter="fade")
        ebeh = _sub(eff, "p:cBhvr")
        _sub(ebeh, "p:cTn", id=nxt, dur=FADE_DUR)
        nxt += 1
        etg = _sub(ebeh, "p:tgtEl")
        _sub(etg, "p:spTgt", spid=spid)

    _sub(seq, "p:prevCondLst").append(
        _mk("p:cond", evt="onPrev", delay=0))
    prev = seq.find(qn("p:prevCondLst"))
    ptg = _sub(prev, "p:tgtEl")
    _sub(ptg, "p:sldTgt")

    nl = _sub(seq, "p:nextCondLst")
    _sub(nl, "p:cond", evt="onNext", delay=0)
    ntg = _sub(nl, "p:tgtEl")
    _sub(ntg, "p:sldTgt")

    sld.append(timing)
    return len(targets)


def animate_deck(prs):
    total = 0
    for slide in prs.slides:
        total += animate_slide(slide)
    return total
