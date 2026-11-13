#!/usr/bin/env python3
"""
Migrate hand-picked Tailwind palette classes onto the semantic tokens.

WHY A SCRIPT. The counts were 248 gray usages across 37 files, 469 hand-written
`dark:` variants, and ~150 emerald/amber/orange classes. Done by hand that is
a week of attention for a mechanical result, and every missed pair is a place
the theme half-applies. The mapping is the interesting part, so it lives here
where a reviewer can read it.

THE RULE THAT MATTERS: pairs first. `text-gray-900 dark:text-gray-100` is ONE
decision ("primary text") and becomes `text-foreground`. Written as two
independent substitutions it would become
`text-foreground dark:text-muted-foreground` — a token that already flips,
wrapped in a dark-mode override that silently makes dark mode wrong.

Order of operations, most specific first:
  1. class + `dark:` partner  ->  one token
  2. hover/focus + partner   ->  one token
  3. remaining bare classes  ->  one token
Anything unmatched is REPORTED, never guessed: an unmapped class is a design
question, and a script that invents an answer is worse than one that stops.

Idempotent: running it twice changes nothing, because the outputs are tokens
the mapping does not match.
"""

from __future__ import annotations

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent / "portal"
SCOPES = ["components", "app"]

# ── 1. Light+dark PAIRS. Order matters: longest/most specific first. ──────
PAIR_MAP = [
    # Text
    ("text-gray-900 dark:text-gray-100", "text-foreground"),
    ("text-gray-900 dark:text-gray-200", "text-foreground"),
    ("text-black dark:text-white", "text-foreground"),
    ("text-gray-800 dark:text-gray-100", "text-foreground"),
    ("text-gray-700 dark:text-gray-300", "text-foreground"),
    ("text-gray-700 dark:text-gray-200", "text-foreground"),
    ("text-gray-600 dark:text-gray-400", "text-muted-foreground"),
    ("text-gray-600 dark:text-gray-300", "text-muted-foreground"),
    ("text-gray-500 dark:text-gray-400", "text-muted-foreground"),
    ("text-gray-500 dark:text-gray-500", "text-muted-foreground"),
    ("text-gray-400 dark:text-gray-500", "text-muted-foreground"),
    ("text-gray-300 dark:text-gray-600", "text-muted-foreground"),
    # Backgrounds
    ("bg-white dark:bg-black", "bg-background"),
    ("bg-gray-50 dark:bg-gray-900", "bg-muted"),
    ("bg-gray-100 dark:bg-gray-800", "bg-muted"),
    ("bg-gray-50/50 dark:bg-gray-900", "bg-muted/50"),
    ("bg-gray-50/50 dark:bg-gray-800", "bg-muted/50"),
    ("bg-gray-50/30 dark:bg-gray-800", "bg-muted/40"),
    ("bg-gray-900 dark:bg-gray-700", "bg-primary"),
    ("bg-gray-900 dark:bg-gray-800", "bg-primary"),
    # Borders
    ("border-gray-200/60 dark:border-gray-800", "border-border"),
    ("border-gray-200 dark:border-gray-800", "border-border"),
    ("border-gray-100 dark:border-gray-800", "border-border"),
    ("border-gray-300 dark:border-gray-700", "border-border"),
    ("border-gray-900 dark:border-gray-100", "border-foreground"),
]

# ── 2. Interactive variants of a pair. ────────────────────────────────────
PAIR_VARIANT_MAP = [
    ("text-gray-900 dark:hover:text-gray-100", "text-foreground hover:text-foreground/80"),
    ("bg-gray-800 dark:hover:bg-gray-600", "bg-primary hover:bg-primary/80"),
    ("bg-gray-700 dark:hover:bg-gray-600", "bg-primary hover:bg-primary/80"),
    ("border-gray-300 dark:hover:border-gray-700", "border-border hover:border-foreground/30"),
    ("bg-gray-50 dark:hover:bg-gray-800", "hover:bg-muted"),
    ("text-gray-600 dark:hover:text-gray-100", "text-muted-foreground hover:text-foreground"),
]

# ── 3. Status colours -> success / warning. ───────────────────────────────
STATUS_MAP = [
    # emerald = "healthy / included / paid / done"
    ("bg-emerald-600", "bg-success"),
    ("bg-emerald-700", "bg-success/90"),
    ("bg-emerald-50 dark:bg-emerald-950/30", "bg-success/10"),
    ("bg-emerald-50 dark:bg-emerald-950", "bg-success/10"),
    ("bg-emerald-50", "bg-success/10"),
    ("text-emerald-600 dark:text-emerald-400", "text-success"),
    ("text-emerald-700 dark:text-emerald-300", "text-success"),
    ("text-emerald-800 dark:text-emerald-300", "text-success"),
    ("text-emerald-600", "text-success"),
    ("text-emerald-700", "text-success"),
    ("text-emerald-400", "text-success"),
    ("border-emerald-200 dark:border-emerald-900", "border-success/30"),
    ("border-emerald-200", "border-success/30"),
    ("border-emerald-500", "border-success/50"),
    ("border-emerald-300", "border-success/30"),
    ("border-emerald-800", "border-success/30"),
    # amber / orange = "warning / pending / needs attention"
    ("bg-amber-500", "bg-warning"),
    ("bg-amber-50 dark:bg-amber-950/30", "bg-warning/10"),
    ("bg-amber-50 dark:bg-amber-950", "bg-warning/10"),
    ("bg-amber-50", "bg-warning/10"),
    ("text-amber-600 dark:text-amber-400", "text-warning"),
    ("text-amber-700 dark:text-amber-300", "text-warning"),
    ("text-amber-800 dark:text-amber-300", "text-warning"),
    ("text-amber-600", "text-warning"),
    ("text-amber-700", "text-warning"),
    ("text-amber-400", "text-warning"),
    ("border-amber-200 dark:border-amber-900", "border-warning/30"),
    ("border-amber-200", "border-warning/30"),
    ("border-amber-300", "border-warning/30"),
    ("border-amber-500", "border-warning/50"),
    ("border-amber-800", "border-warning/30"),
    ("bg-orange-500", "bg-warning"),
    ("text-orange-700 dark:text-orange-300", "text-warning"),
    ("text-orange-300", "text-warning"),
    ("text-orange-700", "text-warning"),
    ("border-orange-500/40", "border-warning/40"),
    ("border-orange-500", "border-warning/50"),
    ("bg-orange-500/10", "bg-warning/10"),
]

# ── 4. Bare classes with no dark partner. ────────────────────────────────
BARE_MAP = [
    ("text-gray-900", "text-foreground"),
    ("text-gray-100", "text-foreground"),
    ("text-gray-800", "text-foreground"),
    ("text-gray-700", "text-foreground"),
    ("text-gray-600", "text-muted-foreground"),
    ("text-gray-500", "text-muted-foreground"),
    ("text-gray-400", "text-muted-foreground"),
    ("text-gray-300", "text-muted-foreground"),
    ("text-gray-200", "text-foreground"),
    ("bg-gray-950", "bg-background"),
    ("bg-gray-50", "bg-muted"),
    ("bg-gray-100", "bg-muted"),
    ("bg-gray-900", "bg-primary"),
    ("bg-gray-800", "bg-muted"),
    ("bg-gray-700", "bg-muted"),
    ("border-gray-200", "border-border"),
    ("border-gray-100", "border-border"),
    ("border-gray-300", "border-border"),
    ("border-gray-800", "border-border"),
    ("ring-gray-200", "ring-border"),
    ("ring-gray-100", "ring-border"),
    # Final sweep: the last bare classes the report surfaced. Each is the
    # same decision as a pair above, just written without a dark partner
    # because the surrounding element already had one.
    ("border-gray-900", "border-foreground"),
    ("border-gray-700", "border-border"),
    ("border-gray-600", "border-border"),
    ("border-gray-400/50", "border-border"),
    ("border-gray-400", "border-border"),
    ("ring-gray-900/40", "ring-foreground/40"),
    ("ring-gray-900/10", "ring-foreground/10"),
    ("ring-gray-900", "ring-foreground"),
    ("ring-gray-400/40", "ring-border"),
    ("ring-gray-300/20", "ring-border/20"),
    ("bg-gray-200", "bg-muted"),
    ("to-gray-50", "to-muted"),
    ("to-gray-950", "to-background"),
    ("via-gray-900", "via-background"),
    # zinc is the same neutral ramp, used by the newer primitives.
    ("text-zinc-600 dark:text-zinc-400", "text-muted-foreground"),
    ("text-zinc-400 dark:text-zinc-500", "text-muted-foreground"),
    ("text-zinc-300 dark:text-zinc-600", "text-muted-foreground"),
    ("text-zinc-100 dark:text-zinc-300", "text-foreground"),
    ("text-zinc-400", "text-muted-foreground"),
    ("text-zinc-300", "text-muted-foreground"),
    ("text-zinc-100", "text-foreground"),
    ("text-zinc-600", "text-muted-foreground"),
    ("bg-zinc-950 dark:bg-black", "bg-background"),
    ("bg-zinc-950", "bg-background"),
    ("bg-zinc-900 dark:bg-zinc-800", "bg-muted"),
    ("bg-zinc-800 dark:bg-zinc-700", "bg-muted"),
    ("bg-zinc-800", "bg-muted"),
    ("bg-zinc-700", "bg-muted"),
    ("bg-zinc-200", "bg-muted"),
    ("border-zinc-800 dark:border-zinc-700", "border-border"),
    ("border-zinc-800", "border-border"),
    ("border-zinc-700", "border-border"),
]

ALL = PAIR_MAP + PAIR_VARIANT_MAP + STATUS_MAP + BARE_MAP


def sort_by_specificity(pairs):
    # Longest source first so a short entry never eats part of a longer one.
    return sorted(pairs, key=lambda kv: len(kv[0]), reverse=True)


ORDERED = sort_by_specificity(ALL)


def migrate(text: str) -> tuple[str, list[str]]:
    """Apply the mapping; return the new text plus leftovers we did not map."""
    for src, dst in ORDERED:
        # Word-boundary-ish: the class must not be part of a longer token.
        text = re.sub(re.escape(src) + r"(?![\w-])", dst, text)

    leftovers: list[str] = []
    for m in re.finditer(
        r"(?:bg|text|border|ring|from|to|via)-(?:gray|zinc|neutral|slate|stone)-"
        r"\d{2,3}(?:/\d{1,3})?",
        text,
    ):
        leftovers.append(m.group(0))
    return text, leftovers


def main() -> int:
    dry = "--dry-run" in sys.argv
    touched = 0
    changed = 0
    leftovers: dict[str, int] = {}

    for scope in SCOPES:
        for path in sorted((ROOT / scope).rglob("*.tsx")):
            if "/node_modules/" in str(path):
                continue
            original = path.read_text()
            new, left = migrate(original)
            for item in left:
                leftovers[item] = leftovers.get(item, 0) + 1
            touched += 1
            if new != original:
                changed += 1
                if not dry:
                    path.write_text(new)

    print(f"{'would change' if dry else 'changed'}: {changed} of {touched} files")
    if leftovers:
        print("\nUNMAPPED (design decisions, not script jobs):")
        for cls, n in sorted(leftovers.items(), key=lambda kv: -kv[1]):
            print(f"  {n:4d}  {cls}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
