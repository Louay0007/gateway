#!/usr/bin/env python3
"""Provision one verified trial account per recipient in the prospect list.

    python3 outreach/provision.py --dry-run
    python3 outreach/provision.py --send          # provisions, then mails
    python3 outreach/provision.py                  # provisions only

Calls portal/scripts/provision-trial-account.ts once with the whole batch on
stdin and writes the credentials it returns to outreach/accounts.json (0600,
gitignored — that file is 100 live passwords).

WHY A REAL PASSWORD AND NOT A MAGIC LINK. The offer says "your account is
already open, here are the credentials". A one-click magic link would be the
nicer UX, but it is a URL in a cold email, and every spam filter and link
scanner on the way will spend it before the recipient clicks. A password
survives that; the email tells them to change it on first sign-in.

RESUMABLE. Accounts already in accounts.json are not re-provisioned (that
would restart their 72h clock), and the TypeScript side is itself idempotent
per email, so a batch that died halfway can simply be run again.
"""

import argparse
import json
import os
import secrets
import string
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HERE = Path(__file__).resolve().parent
LIST = ROOT / "PROSPECT-LIST-2026-11.md"
ACCOUNTS = HERE / "accounts.json"
PORTAL = ROOT / "portal"

# Unambiguous by design: no O/0, l/1/I. These get read off a screen and typed
# by a human who did not ask to be doing this.
ALPHABET = "".join(c for c in string.ascii_letters + string.digits if c not in "O0lI1")
PASSWORD_LEN = 16

ROW_RE = __import__("re").compile(
    r"^\|\s*(\d+)\s*\|\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|\s*`([^`]+@[^`]+)`"
)


def load_recipients():
    seen, out = set(), []
    for line in LIST.read_text(encoding="utf-8").splitlines():
        m = ROW_RE.match(line)
        if not m:
            continue
        _num, company, _sector, email = m.groups()
        key = email.strip().lower()
        if key in seen:
            continue
        seen.add(key)
        out.append({"company": company.strip(), "email": email.strip()})
    return out


def load_accounts():
    if not ACCOUNTS.exists():
        return {}
    raw = json.loads(ACCOUNTS.read_text(encoding="utf-8"))
    return {a["email"].strip().lower(): a for a in raw if a.get("email")}


def save_accounts(accounts):
    rows = sorted(accounts.values(), key=lambda a: a["email"])
    ACCOUNTS.write_text(json.dumps(rows, indent=2) + "\n", encoding="utf-8")
    # 100 live passwords. Owner-only, before anything else can read it.
    ACCOUNTS.chmod(0o600)


def new_password():
    return "".join(secrets.choice(ALPHABET) for _ in range(PASSWORD_LEN))


def provision(batch, compose=False):
    """Run the TypeScript provisioner with `batch` on stdin.

    Stdin, not argv: argv is visible in `ps` to every user on the box and this
    payload is a list of passwords.

    `compose=True` runs the same script inside the `jobs` container instead of
    on the host. The production box has no node_modules in the checkout and
    keeps the database unreachable from the host, so the container is the only
    place the script has both its dependencies and its network.
    """
    inner = [
        "node",
        "--experimental-transform-types",
        "--import",
        "./scripts/register-ts-resolve.mjs",
        "scripts/provision-trial-account.ts",
    ]
    if compose:
        # -T: no TTY, so stdin reaches the container as a pipe. Without it
        # compose attaches a terminal and the JSON never arrives.
        cmd = ["docker", "compose", "run", "--rm", "-T", "--no-deps", "jobs", *inner]
        cwd = ROOT
    else:
        cmd = inner
        cwd = PORTAL

    proc = subprocess.run(
        cmd,
        cwd=cwd,
        input=json.dumps(batch),
        capture_output=True,
        text=True,
    )
    if proc.stderr.strip():
        # Warnings (entitlement sync, team repair) are expected to be visible.
        for line in proc.stderr.strip().splitlines():
            print(f"  ! {line}")
    if proc.returncode != 0:
        sys.exit(f"provisioner failed (exit {proc.returncode})")
    try:
        return json.loads(proc.stdout)
    except json.JSONDecodeError:
        sys.exit(f"provisioner returned non-JSON:\n{proc.stdout[:2000]}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--company", help="provision one company only (substring, case-insensitive)")
    ap.add_argument(
        "--compose",
        action="store_true",
        help="run the provisioner inside the jobs container (use on the production box)",
    )
    args = ap.parse_args()

    recipients = load_recipients()
    accounts = load_accounts()
    print(f"{len(recipients)} unique recipients from {LIST.name}")
    print(f"{len(accounts)} already provisioned")

    todo = []
    for r in recipients:
        if r["email"].lower() in accounts:
            continue
        if args.company and args.company.lower() not in r["company"].lower():
            continue
        todo.append(r)
    if args.limit:
        todo = todo[: args.limit]

    if not todo:
        print("nothing to provision")
        return

    print(f"provisioning {len(todo)}")
    if args.dry_run:
        for r in todo:
            print(f"[dry-run] {r['company'][:40]:<40} {r['email']}")
        return

    # One password per recipient, generated here and kept only if the
    # provisioner reports the account as created/resumed.
    batch = [
        {
            "email": r["email"],
            "company": r["company"],
            "password": new_password(),
            "keys": ["default"],
        }
        for r in todo
    ]

    results = provision(batch, compose=args.compose)
    by_email = {a["email"].lower(): a for a in batch}

    made = failed = 0
    for res in results:
        key = res["email"].lower()
        if res["status"] in ("created", "resumed"):
            accounts[key] = {
                "email": res["email"],
                "company": res["company"],
                "password": by_email[key]["password"],
                "orgId": res.get("orgId"),
                "expiresAt": res.get("expiresAt"),
                # Plaintext, returned once by the provisioner. Recorded so a
                # resend of the same email can quote the same key instead of
                # minting a second one.
                "keys": res.get("keys") or [],
            }
            made += 1
            print(f"  ok    {res['company'][:40]:<40} {res['email']}")
        else:
            failed += 1
            print(f"  FAIL  {res['company'][:40]:<40} {res['email']}  {res.get('error')}")

    save_accounts(accounts)
    print(f"done: {made} provisioned, {failed} failed — {ACCOUNTS.name} now holds {len(accounts)}")
    sys.exit(0 if failed == 0 else 1)


if __name__ == "__main__":
    main()
