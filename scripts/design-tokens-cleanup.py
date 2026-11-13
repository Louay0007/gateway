#!/usr/bin/env python3
"""
Second pass: delete `dark:` overrides that a token already handles.

WHY. Pass 1 (design-tokens-migrate.py) collapsed light/dark PAIRS into one
token. But a bare class that had its own `dark:` sibling elsewhere on the
same element — or a `dark:` variant whose light twin was already a token —
left fragments like:

    border-t border-border/60 bg-white py-12 dark:border-border dark:bg-black

The token already flips; the `dark:` override is now either redundant or
actively wrong (it pins one theme's value onto a token that flips). This pass
removes the redundant ones and rewrites the status colours the first pass
could not see because they were written as `dark:text-green-700`.

Rules:
  - `dark:<prop>-<token>` where the same element already uses that token for
    the same property  -> drop it.
  - `dark:bg-black` / `dark:bg-white` next to `bg-background` -> drop.
  - `dark:text-green-*` / `dark:bg-green-*` / `dark:border-green-*`
    -> success (green and emerald were used for the same meaning).
  - `dark:text-red-*` / `dark:border-red-*` -> destructive.

Reports anything left.
"""

from __future__ import annotations

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent / "portal"
SCOPES = ["components", "app"]

# A `dark:` override of a token that already flips.
REDUNDANT_TOKEN = [
    "dark:bg-background", "dark:bg-primary", "dark:bg-muted", "dark:bg-card",
    "dark:bg-border", "dark:border-border", "dark:border-input",
    "dark:text-foreground", "dark:text-muted-foreground", "dark:text-primary",
    "dark:text-success", "dark:text-warning", "dark:text-destructive",
    "dark:border-success/30", "dark:border-warning/30",
    "dark:bg-success/10", "dark:bg-warning/10",
    "dark:bg-black", "dark:bg-white", "dark:text-white", "dark:text-black",
]

# Remaining named palette colours -> the semantic token that means the same.
COLOUR_MAP = [
    (r"dark:text-green-\d{2,3}", "text-success"),
    (r"dark:bg-green-\d{2,3}", "bg-success/10"),
    (r"dark:border-green-\d{2,3}", "border-success/30"),
    (r"text-green-\d{2,3}", "text-success"),
    (r"bg-green-\d{2,3}", "bg-success/10"),
    (r"border-green-\d{2,3}", "border-success/30"),
    (r"dark:text-emerald-\d{2,3}", "text-success"),
    (r"dark:bg-emerald-\d{2,3}", "bg-success/10"),
    (r"dark:border-emerald-\d{2,3}", "border-success/30"),
    (r"dark:text-amber-\d{2,3}", "text-warning"),
    (r"dark:bg-amber-\d{2,3}", "bg-warning/10"),
    (r"dark:border-amber-\d{2,3}", "border-warning/30"),
    (r"dark:text-red-\d{2,3}", "text-destructive"),
    (r"dark:bg-red-\d{2,3}", "bg-destructive/10"),
    (r"dark:border-red-\d{2,3}", "border-destructive/40"),
    # The long tail: dark-tinted surfaces of a status colour. Each was a
    # hand-picked shade of the same meaning; the /10 or /20 tint is what the
    # design actually wants, and it now flips with the theme.
    (r"dark:ring-emerald-\d{2,3}", "ring-success/30"),
    (r"dark:bg-emerald-9\d{2}/\d{1,3}", "bg-success/10"),
    (r"dark:bg-emerald-5\d{2}/10", "bg-success/10"),
    (r"dark:from-emerald-9\d{2}", "from-success/10"),
    (r"dark:bg-green-9\d{2}/\d{1,3}", "bg-success/10"),
    (r"dark:bg-red-9\d{2}/\d{1,3}", "bg-destructive/10"),
    (r"dark:text-orange-4\d{2}", "text-warning"),
    (r"dark:bg-amber-9\d{2}/\d{1,3}", "bg-warning/10"),
    # RED = destructive. Missed by the first pass because red had no
    # `dark:` sibling in the auth forms, so it never matched a pair.
    (r"text-red-600", "text-destructive"),
    (r"text-red-700", "text-destructive"),
    (r"text-red-500", "text-destructive"),
    (r"border-red-500", "border-destructive/50"),
    (r"border-red-200", "border-destructive/30"),
    (r"bg-red-50", "bg-destructive/10"),
    (r"text-emerald-900", "text-success-foreground"),
    (r"bg-emerald-300", "bg-success/30"),
    (r"border-emerald-400", "border-success/50"),
    # The 500/600/800 shades: same meaning, different hand-picked weight.
    (r"text-red-800", "text-destructive"),
    (r"text-amber-800", "text-warning"),
    (r"text-amber-900", "text-warning"),
    (r"text-amber-500", "text-warning"),
    (r"bg-emerald-500", "bg-success"),
    (r"border-emerald-600", "border-success"),
    (r"border-emerald-100", "border-success/30"),
    (r"border-amber-600", "border-warning/50"),
    (r"bg-green-900", "bg-success/20"),
]


def cleanup(text: str) -> tuple[str, list[str]]:
    for src in REDUNDANT_TOKEN:
        text = re.sub(re.escape(src) + r"(?![\w/-])", "", text)

    for pattern, dst in COLOUR_MAP:
        # The lookahead must not reject a preceding `-`: `hover:border-x`
        # and `dark:bg-x` both contain the class after a separator, and
        # `(?<![\w-])` anchors the START so `bg-emerald-500` does not match
        # inside `dark:bg-emerald-500` and leave a stranded `dark:`.
        text = re.sub(r"(?<![\w-])" + pattern + r"(?![\w/-])", dst, text)

    # Collapse the double spaces and stray leading/trailing spaces that
    # removing a class leaves inside a className string.
    text = re.sub(r'className="([^"]*)"', _tidy, text)
    text = re.sub(r"className=\{`([^`]*)`\}", _tidy_template, text)

    leftovers: list[str] = []
    for m in re.finditer(
        r"dark:(?:bg|text|border|ring|from|to|via)-"
        r"(?:gray|zinc|neutral|slate|stone|green|emerald|amber|red|orange)-"
        r"\d{2,3}(?:/\d{1,3})?",
        text,
    ):
        leftovers.append(m.group(0))
    return text, leftovers


def _tidy(m: re.Match[str]) -> str:
    value = re.sub(r"\s{2,}", " ", m.group(1)).strip()
    return f'className="{value}"'


def _tidy_template(m: re.Match[str]) -> str:
    value = re.sub(r"\s{2,}", " ", m.group(1)).strip()
    return "className={`" + value + "`}"


def main() -> int:
    dry = "--dry-run" in sys.argv
    changed = 0
    touched = 0
    leftovers: dict[str, int] = {}

    for scope in SCOPES:
        for path in sorted((ROOT / scope).rglob("*.tsx")):
            original = path.read_text()
            new, left = cleanup(original)
            for item in left:
                leftovers[item] = leftovers.get(item, 0) + 1
            touched += 1
            if new != original:
                changed += 1
                if not dry:
                    path.write_text(new)

    print(f"{'would change' if dry else 'changed'}: {changed} of {touched} files")
    if leftovers:
        print("\nSTILL UNMAPPED:")
        for cls, n in sorted(leftovers.items(), key=lambda kv: -kv[1]):
            print(f"  {n:4d}  {cls}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
