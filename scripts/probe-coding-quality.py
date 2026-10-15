#!/usr/bin/env python3
"""Rank agentic-qualified models on ACTUAL CODING, not just tool-calling.

Tool-calling capability only proves the model can emit a function call. It says
nothing about whether the resulting code is correct. This runs three small but
real programming tasks and scores each output with an objective check -- no
model-as-judge, no vibes -- so the choice of what goes into the `fast` alias
is made on evidence rather than on a brand name.

Usage:
    BASE=https://api.howtofix.id/v1 KEY=sk-... \
      ./scripts/probe-coding-quality.py "space-bunny cat-jam deepseek-v4.1-flash"
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

BASE = os.environ.get("BASE", "https://api.howtofix.id/v1").rstrip("/")
KEY = os.environ["KEY"]

# (label, prompt, [all required patterns], [forbidden patterns])
TASKS = [
    (
        "reverse",
        "Write a Python function reverse_string(s) that returns the input "
        "reversed. Reply with code only, no explanation.",
        [r"def\s+reverse_string"],
        # s[::-1] reversed twice, or a no-op, is not a solution.
        [r"return\s+s\b(?!\s*\[)"],
    ),
    (
        "offbyone",
        "This Python function drops the last character. Fix it so it returns "
        "the first n characters.\n\ndef take(s, n):\n    return s[:n-1]\n\n"
        "Reply with the corrected function only.",
        [r"def\s+take", r"\[:\s*n\s*\]"],
        [r"\[:\s*n\s*-\s*1\s*\]"],
    ),
    (
        "dedupe",
        "Write a Python function dedupe(items) that removes duplicates while "
        "preserving the original order. Reply with code only.",
        [r"def\s+dedupe"],
        # `set(items)` alone is the wrong answer -- it loses order.
        [r"return\s+list\(set\("],
    ),
]


def ask(model: str, prompt: str) -> tuple[str, str]:
    body = json.dumps(
        {
            "model": model,
            "max_tokens": 2048,
            "messages": [{"role": "user", "content": prompt}],
        }
    ).encode()
    req = urllib.request.Request(
        f"{BASE}/chat/completions",
        data=body,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {KEY}",
            # REQUIRED. The provider sits behind Cloudflare, which returns
            # "error code: 1010" — a browser-signature ban — for Python's
            # default `Python-urllib/3.x`. Every model then looks like a hard
            # 403 failure, which reads as "all these models are broken" when
            # in fact the probe is what was blocked.
            "User-Agent": "curl/8.7.1",
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            d = json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        detail = ""
        try:
            detail = e.read().decode()[:80]
        except Exception:  # noqa: BLE001
            pass
        return "", f"http_{e.code}{(' ' + detail) if detail else ''}"
    except Exception as e:  # noqa: BLE001 - reported, not raised
        return "", type(e).__name__
    choices = d.get("choices") or []
    if not choices:
        return "", "no_choices"
    msg = choices[0].get("message") or {}
    # Reasoning models put the answer in `content`, but some return it in
    # `reasoning_content` when content is empty. Check both so a model is not
    # scored zero for putting its answer somewhere we did not look.
    text = (msg.get("content") or "") or (msg.get("reasoning_content") or "")
    return text, "ok"


def score(text: str, required: list[str], forbidden: list[str]) -> bool:
    if not text:
        return False
    # Strip the fences so a check never fails on markdown, only on code.
    code = "\n".join(re.findall(r"```(?:\w+)?\n(.*?)```", text, re.S) or [text])
    if not all(re.search(p, code, re.S) for p in required):
        return False
    if any(re.search(p, code) for p in forbidden):
        return False
    return True


def main() -> int:
    models = sys.argv[1:]
    if not models:
        print(__doc__)
        return 2

    print(f"  scoring {len(models)} model(s) on {len(TASKS)} coding tasks\n")
    rows = []
    for m in models:
        per = {}
        for label, prompt, req, forb in TASKS:
            text, status = ask(m, prompt)
            per[label] = "OK" if score(text, req, forb) else ("MISS" if status == "ok" else status)
        hits = sum(1 for v in per.values() if v == "OK")
        rows.append((hits, m, per))
        detail = "  ".join(f"{k}={v}" for k, v in per.items())
        print(f"  {m:28} {hits}/{len(TASKS)}   {detail}")
        time.sleep(2)

    print("\n=== RANKED (best first) ===")
    for hits, m, per in sorted(rows, key=lambda r: -r[0]):
        flag = "AGENTIC-QUALIFIED" if hits == len(TASKS) else ""
        print(f"  {hits}/{len(TASKS)}  {m:28} {flag}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
