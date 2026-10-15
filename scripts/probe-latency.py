#!/usr/bin/env python3
"""Measure per-model latency, so the `fast` tier is placed on evidence.

Why this exists. All eleven agentic-qualified models tie on capability
(tool calling, the tool-result turn, reasoning tasks) and, once two buggy
regex checks were fixed, on coding quality too — 6/6 each. So quality cannot
justify which model sits in which tier, and picking by brand name or by
version number would be a guess dressed up as a decision.

Latency is measurable, reproducible, and it is literally what the `fast`
alias promises. This measures time-to-first-token (what an agent feels while
streaming) and total time (what a request costs in wall-clock), with a
median over N runs so one slow sample does not decide anything.

Usage:
    BASE=https://api.howtofix.id/v1 KEY=sk-... ./scripts/probe-latency.py "a b c"
"""
from __future__ import annotations

import json
import os
import statistics
import sys
import time
import urllib.error
import urllib.request

BASE = os.environ.get("BASE", "https://api.howtofix.id/v1").rstrip("/")
KEY = os.environ["KEY"]
RUNS = int(os.environ.get("RUNS", "5"))

PROMPT = (
    "Write a Python function that merges two sorted lists into one sorted "
    "list. Reply with code only."
)

HEADERS = {
    "Content-Type": "application/json",
    "Authorization": f"Bearer {KEY}",
    # Cloudflare returns "error code: 1010" for Python's default User-Agent,
    # which makes every model look like a hard 403.
    "User-Agent": "curl/8.7.1",
    "Accept": "application/json",
}


def one_run(model: str) -> tuple[float | None, float | None, str]:
    """Streamed: returns (ttft_seconds, total_seconds, note)."""
    body = json.dumps(
        {
            "model": model,
            "max_tokens": 1024,
            "stream": True,
            "messages": [{"role": "user", "content": PROMPT}],
        }
    ).encode()
    req = urllib.request.Request(f"{BASE}/chat/completions", data=body, headers=HEADERS)

    start = time.monotonic()
    ttft: float | None = None
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            for raw in r:
                if ttft is None and raw.startswith(b"data: ") and b"[DONE]" not in raw:
                    ttft = time.monotonic() - start
                if b"[DONE]" in raw:
                    break
    except urllib.error.HTTPError as e:
        return None, None, f"http_{e.code}"
    except Exception as e:  # noqa: BLE001
        return None, None, type(e).__name__
    return ttft, time.monotonic() - start, "ok"


def main() -> int:
    models = sys.argv[1:]
    if not models:
        print(__doc__)
        return 2

    print(f"  {len(models)} model(s) x {RUNS} streamed runs\n")
    print(f"  {'model':30} {'ttft p50':>9} {'total p50':>10} {'ok':>5}")
    rows = []
    for m in models:
        ttfts, totals, ok, notes = [], [], 0, []
        for _ in range(RUNS):
            ttft, total, note = one_run(m)
            if note != "ok":
                notes.append(note)
                continue
            ok += 1
            if ttft is not None:
                ttfts.append(ttft)
            totals.append(total)
            time.sleep(1)
        t50 = statistics.median(ttfts) if ttfts else float("nan")
        g50 = statistics.median(totals) if totals else float("nan")
        rows.append((t50, m, ok))
        flag = "" if ok == RUNS else f"  ({ok}/{RUNS} ok {','.join(sorted(set(notes)))})"
        print(f"  {m:30} {t50:8.2f}s {g50:9.2f}s {ok:>4}/{RUNS}{flag}")

    print("\n=== FASTEST FIRST (by time-to-first-token) ===")
    for t50, m, ok in sorted(rows, key=lambda r: (r[0] if r[0] == r[0] else 9e9)):
        label = "no measurement" if t50 != t50 else f"{t50:.2f}s ttft"
        print(f"  {m:30} {label}")
    print("\n  Note: these are FREE shared pools. Their latency moves with load,")
    print("  so treat this as one sample of a distribution, not a constant.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
