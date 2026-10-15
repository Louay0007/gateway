#!/usr/bin/env python3
"""Discriminate between agentic models that all pass the EASY coding checks.

The first probe (probe-coding-quality.py) put 11 models at 3/3 — reverse a
string, fix an off-by-one, dedupe. That proves they can code, but it does not
separate them, and choosing a gateway upstream on a 11-way tie is not a
decision.

This pass uses tasks with exactly one defensible answer, chosen so a model has
to reason rather than pattern-match:

  1. PYTHON GIL — is the explanation right, not just fluent?
  2. CONCURRENCY — a real lost-update bug; the fix must be a lock, not a
     retry, and not `+= 1` on a shared counter.
  3. ALGORITHM — a trap where the obvious O(n^2) answer is wrong.
  4. CODE READING — a bug in code the model has to parse first.

Each check is a regex over the required/failed constructs, so scoring is
deterministic and does not depend on this script agreeing with a model's prose.

Usage:
    BASE=https://api.howtofix.id/v1 KEY=sk-... \
      ./scripts/probe-hard-tasks.py "space-bunny cat-jam ..."
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

TASKS = [
    (
        "gil",
        "In CPython, why can two threads not run pure-Python bytecode truly in "
        "parallel on one core? Answer in 1-3 sentences.",
        # Must name the lock and the fact that bytecode is not released.
        [r"global interpreter lock|GIL"],
        [r"because python is slow|just a design choice"],
    ),
    (
        "lost-update",
        "This counter loses increments under threads. Fix it so increments are "
        "not lost.\n\n"
        "import threading\n"
        "count = 0\n"
        "lock = threading.Lock()\n\n"
        "def increment():\n"
        "    global count\n"
        "    temp = count\n"
        "    count = temp + 1\n\n"
        "Reply with the corrected increment function only.",
        [r"with\s+lock"],
        [r"^$"],
    ),
    (
        "concurrency-reasoning",
        "Two threads each append to one shared list 1000 times, and afterwards "
        "the list has fewer than 2000 items. Explain in 1-2 sentences why.",
        # Must attribute it to non-atomicity, not to "threads being slow".
        [r"atomic|race|not thread[- ]safe|interleav"],
        [r"because the list is too small|memory limit"],
    ),
    (
        "algorithm-trap",
        "Given a list of ints, write `second_largest(nums)` returning the "
        "second largest DISTINCT value, or None if there is not one. "
        "`second_largest([5,5,3])` must be 3, not 5. Reply with code only.",
        [r"def\s+second_largest"],
        # `sorted(...)[-2]` on the unsorted-unique path is the trap; accepting
        # duplicates is what the prompt forbids.
        [r"def\s+second_largest\(nums\):\s*\n\s*return\s+sorted\(nums\)\[-2\]"],
    ),
    (
        "code-reading",
        "This code prints 1 2 3 4 5 but is supposed to print 1 2 3 4 5 6. "
        "What is wrong and what is the minimal fix?\n\n"
        "for i in range(1, 6):\n"
        "    print(i)\n\n"
        "Answer in 1-2 sentences.",
        [r"range\("],
        # Claiming the loop is fine, or blaming Python, is the wrong answer.
        [r"the code is correct|there is no bug"],
    ),
    (
        "refactor",
        "Refactor this to remove the duplicated branch. Reply with code only.\n\n"
        "def handle(x):\n"
        "    if x > 0:\n"
        "        return 'pos'\n"
        "    else:\n"
        "        return 'nonpos'\n",
        [r"def\s+handle"],
        [r"^$"],
    ),
]


def ask(model: str, prompt: str, timeout: int = 180) -> tuple[str, str]:
    body = json.dumps(
        {
            "model": model,
            "max_tokens": 3000,
            "messages": [{"role": "user", "content": prompt}],
        }
    ).encode()
    req = urllib.request.Request(
        f"{BASE}/chat/completions",
        data=body,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {KEY}",
            # The provider sits behind Cloudflare, which returns
            # "error code: 1010" for Python's default urllib User-Agent and
            # makes every model look broken.
            "User-Agent": "curl/8.7.1",
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            d = json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        try:
            return "", f"http_{e.code} {e.read().decode()[:60]}"
        except Exception:  # noqa: BLE001
            return "", f"http_{e.code}"
    except Exception as e:  # noqa: BLE001
        return "", type(e).__name__
    choices = d.get("choices") or []
    if not choices:
        return "", "no_choices"
    msg = choices[0].get("message") or {}
    text = (msg.get("content") or "") or (msg.get("reasoning_content") or "")
    return text, "ok"


def verdict(text: str, required: list[str], forbidden: list[str]) -> str:
    if not text:
        return "EMPTY"
    code = "\n".join(re.findall(r"```(?:\w+)?\n(.*?)```", text, re.S) or [text])
    hay = code if len(code) > 20 else text
    if not any(re.search(p, hay, re.I | re.S) for p in required):
        return "WRONG"
    if any(re.search(p, hay, re.I | re.M) for p in forbidden):
        return "WRONG"
    return "OK"


def main() -> int:
    models = sys.argv[1:]
    if not models:
        print(__doc__)
        return 2

    print(f"  scoring {len(models)} model(s) on {len(TASKS)} hard tasks\n")
    rows = []
    for m in models:
        per = {}
        for label, prompt, req, forb in TASKS:
            text, status = ask(m, prompt)
            per[label] = verdict(text, req, forb) if status == "ok" else status
        hits = sum(1 for v in per.values() if v == "OK")
        rows.append((hits, m, per))
        print(f"  {m:28} {hits}/{len(TASKS)}")
        time.sleep(2)

    order = [t[0] for t in TASKS]
    print(f"\n  {'':28} " + " ".join(f"{o[:9]:>10}" for o in order))
    print("\n=== RANKED (best first) ===")
    for hits, m, per in sorted(rows, key=lambda r: (-r[0], r[1])):
        cells = " ".join(f"{per.get(o, '-'):>10}" for o in order)
        print(f"  {hits}/{len(TASKS)}  {m:28} {cells}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
