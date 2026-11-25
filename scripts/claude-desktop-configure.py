#!/usr/bin/env python3
"""Point Claude Desktop at api.zaino.soon.it with every alias and 1M context.

    python3 scripts/claude-desktop-configure.py            # write + apply
    python3 scripts/claude-desktop-configure.py --dry-run   # show the plan
    python3 scripts/claude-desktop-configure.py --revert    # back to Default

WHY A SCRIPT AND NOT A SNIPPET IN THE DOCS. Two fields decide whether Claude
Desktop honours the 1M toggle, and neither is guessable:

  `supports1m: true`      declares that the gateway serves a 1M window.
  `prefer1m: true`        asks for it by default. With this false the client
                          keeps its ~200K working window and auto-compacts
                          early, which is exactly the "160K / 200K" symptom.
  `anthropicFamilyTier`   what the CLIENT maps context size and thinking
                          effort from. A custom name with no tier gets no
                          native entry, so the toggle is ignored. The working
                          Default profile pairs supports1m with a tier.

WHERE IT LIVES. Claude Desktop keeps named profiles under
`~/Library/Application Support/Claude-3p/configLibrary/<uuid>.json` and the
active one is `appliedId` in `_meta.json`. The `zaino` profile is written in
place (its sealed API key is preserved byte for byte) and then applied.

The key is never read, printed or rewritten: it is stored by Claude as
`__sealed__:v1:...` and is copied through untouched. Re-run this any time the
gateway's model list changes.

The app must be restarted to pick up an applied profile.
"""
from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

APP_SUPPORT = Path.home() / "Library/Application Support/Claude-3p"
LIB = APP_SUPPORT / "configLibrary"
META = LIB / "_meta.json"

BASE_URL = "https://api.zaino.soon.it"

# The gateway serves four tiers under two spellings each. `claude-*` comes
# first because that is what Claude Desktop's own picker expects; the plain
# alias follows so an SDK-style name resolves too.
MODELS = [
    ("claude-frontier", "opus"),
    ("claude-smart", "sonnet"),
    ("claude-fast", "haiku"),
    ("claude-fable", "fable"),
    ("frontier", "opus"),
    ("smart", "sonnet"),
    ("fast", "haiku"),
    ("fable", "fable"),
]


def profile_id(name: str) -> str:
    meta = json.loads(META.read_text())
    for entry in meta["entries"]:
        if entry["name"] == name:
            return entry["id"]
    raise SystemExit(f"profile {name!r} not found in {META}")


def build_models() -> list[dict]:
    return [
        {
            "name": n,
            "labelOverride": n,
            # Declares a 1M window AND asks for it by default. `prefer1m`
            # false is the setting that silently keeps the 200K working
            # window and auto-compacts early.
            "supports1m": True,
            "prefer1m": True,
            # What the client derives native context size and effort from.
            "anthropicFamilyTier": tier,
        }
        for n, tier in MODELS
    ]


def main() -> int:
    dry = "--dry-run" in sys.argv
    revert = "--revert" in sys.argv

    if not LIB.is_dir():
        raise SystemExit(f"Claude Desktop profile directory not found: {LIB}")

    zaino = profile_id("zaino")
    default = profile_id("Default")
    target = LIB / f"{zaino}.json"
    donor = LIB / f"{default}.json"

    if revert:
        meta = json.loads(META.read_text())
        meta["appliedId"] = default
        if dry:
            print(f"[dry-run] would apply Default ({default})")
        else:
            shutil.copy2(META, META.with_suffix(".json.bak"))
            META.write_text(json.dumps(meta, indent=2) + "\n")
            print(f"applied Default ({default}) — restart Claude Desktop")
        return 0

    doc = json.loads(target.read_text())
    donor_doc = json.loads(donor.read_text())

    doc["inferenceGatewayBaseUrl"] = BASE_URL
    doc["inferenceModels"] = build_models()
    doc.setdefault("inferenceProvider", "gateway")
    doc.setdefault("inferenceCredentialKind", "static")

    # Fields the working Default profile carries that a hand-written one
    # forgets. MCP servers are copied so the tool surface matches.
    for key in (
        "isDesktopExtensionEnabled",
        "defaultModelEffort",
        "disableEssentialTelemetry",
        "disableNonessentialTelemetry",
        "disableNonessentialServices",
        "coworkEgressAllowedHosts",
        "managedMcpServers",
    ):
        if key in donor_doc:
            doc.setdefault(key, donor_doc[key])

    sealed = doc.get("inferenceGatewayApiKey", "")
    if not str(sealed).startswith("__sealed__:v1:"):
        print("warning: no sealed API key in this profile; keeping as-is", file=sys.stderr)

    if dry:
        print(json.dumps({k: v for k, v in doc.items() if k != "inferenceGatewayApiKey"}, indent=1))
        print(f"[dry-run] would write {target} and apply {zaino}")
        return 0

    shutil.copy2(target, target.with_suffix(".json.bak"))
    target.write_text(json.dumps(doc, indent=1, ensure_ascii=False) + "\n")

    meta = json.loads(META.read_text())
    meta["appliedId"] = zaino
    shutil.copy2(META, META.with_suffix(".json.bak"))
    META.write_text(json.dumps(meta, indent=2) + "\n")

    print(f"wrote {len(doc['inferenceModels'])} models to {target.name}")
    print(f"applied profile zaino ({zaino})")
    print("restart Claude Desktop to load it")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
