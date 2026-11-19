#!/usr/bin/env python3
"""Send the Zaino partner offer.

Reads PROSPECT-LIST-2026-11.md, renders outreach/proposal.html per company,
and sends over Namecheap Private Email SMTP.

    python3 outreach/send.py --test louay.rjilii@gmail.com
    python3 outreach/send.py --send --limit 20
    python3 outreach/send.py --send

The password comes from ZAINO_SMTP_PASSWORD (or --password). It is never
written to disk here and never printed.

PER-RECIPIENT CREDENTIALS. The email no longer carries a redeem code; it
carries the account's sign-in address and generated password, both read from
outreach/accounts.json (written by outreach/provision.py). A recipient with
no entry there is SKIPPED, not sent a mail with a blank password field: the
failure mode of a template typo here is 100 companies receiving an account
that does not exist, which is worse than a short batch.
"""

import argparse
import json
import mimetypes
import os
import re
import smtplib
import ssl
import sys
import time
from email.message import EmailMessage
from email.utils import formataddr, formatdate, make_msgid
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HERE = Path(__file__).resolve().parent
LIST = ROOT / "PROSPECT-LIST-2026-11.md"
HTML = HERE / "proposal.html"
TEXT = HERE / "proposal.txt"
SENT_LOG = HERE / "sent.log"
ACCOUNTS = HERE / "accounts.json"
LOGO = ROOT / "portal/public/logo/zaino-curved-z-white.png"

SMTP_HOST = "mail.privateemail.com"
SMTP_PORT = 465
FROM_ADDR = "ceo-louayrjili@sohabi.app"
FROM_NAME = "Louay Rjili, Zaino AI"
REPLY_TO = "ceo-louayrjili@sohabi.app"
SUBJECT = "A 3-day API trial for {{COMPANY}} — no card"

# Must match the <img src="cid:..."> in proposal.html.
LOGO_CID = "zaino-logo"

# Wave 5 (rows 105-115) is accelerators and investors. They get the same
# product email: several run venture programmes whose portfolio companies
# build software, so the offer is relevant to them as a referral channel
# even though they are not themselves API customers.
ROW_RE = re.compile(r"^\|\s*(\d+)\s*\|\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|\s*`([^`]+@[^`]+)`")

# Anything the template can interpolate. A placeholder left unresolved after
# substitution is a bug, and it must stop the send rather than reach an inbox.
PLACEHOLDER_RE = re.compile(r"\{\{[A-Z_]+\}\}")


def load_recipients():
    seen, out = set(), []
    for line in LIST.read_text(encoding="utf-8").splitlines():
        m = ROW_RE.match(line)
        if not m:
            continue
        num, company, _sector, email = m.groups()
        email = email.strip()
        key = email.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append({"num": int(num), "company": company.strip(), "email": email})
    return out


def load_accounts():
    """Provisioned credentials, keyed by lowercased email.

    Missing file is not an error here: --test and the listing mode both work
    without provisioning. Only an actual send to a recipient without an entry
    is refused, at the point where it matters.
    """
    if not ACCOUNTS.exists():
        return {}
    raw = json.loads(ACCOUNTS.read_text(encoding="utf-8"))
    return {a["email"].strip().lower(): a for a in raw if a.get("email")}


def render(text, company, account):
    out = text.replace("{{COMPANY}}", company)
    out = out.replace("{{LOGIN_EMAIL}}", account["email"])
    out = out.replace("{{LOGIN_PASSWORD}}", account["password"])
    left = PLACEHOLDER_RE.findall(out)
    if left:
        raise ValueError(f"unresolved placeholders: {', '.join(sorted(set(left)))}")
    return out


def already_sent(addresses):
    if not SENT_LOG.exists():
        return set()
    done = set()
    for line in SENT_LOG.read_text(encoding="utf-8").splitlines():
        parts = line.split("\t")
        if len(parts) >= 2 and parts[1].strip().lower() in addresses:
            done.add(parts[1].strip().lower())
    return done


def build(msg):
    m = EmailMessage()
    m["From"] = formataddr((FROM_NAME, FROM_ADDR))
    m["To"] = formataddr((msg["company"], msg["email"]))
    m["Reply-To"] = REPLY_TO
    m["Subject"] = render(SUBJECT, msg["company"], msg["account"])
    m["Date"] = formatdate(localtime=True)
    m["Message-ID"] = make_msgid(domain="sohabi.app")
    m["List-Unsubscribe"] = f"<mailto:{REPLY_TO}?subject=unsubscribe>"

    text = render(TEXT.read_text(encoding="utf-8"), msg["company"], msg["account"])
    html = render(HTML.read_text(encoding="utf-8"), msg["company"], msg["account"])

    m.set_content(text)
    m.add_alternative(html, subtype="html")
    # Inline (CID) rather than remote: the mark is white-on-transparent, and a
    # blocked remote image is a broken box in the header of a cold email.
    # add_related() on the HTML part turns it into multipart/related, which is
    # the structure clients expect for a body that references cid: images.
    html_part = m.get_body(preferencelist=("html",))
    if LOGO.exists() and html_part is not None:
        ctype, _ = mimetypes.guess_type(LOGO.name)
        maintype, subtype = (ctype or "image/png").split("/", 1)
        html_part.add_related(
            LOGO.read_bytes(),
            maintype=maintype,
            subtype=subtype,
            cid=f"<{LOGO_CID}>",
            filename=LOGO.name,
        )
    return m


def connect(password):
    ctx = ssl.create_default_context()
    s = smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, context=ctx, timeout=30)
    s.login(FROM_ADDR, password)
    return s


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--test", metavar="ADDRESS", help="send one copy to this address")
    ap.add_argument(
        "--as-account",
        metavar="ACCOUNT_EMAIL",
        help="with --test: use this provisioned account's real credentials "
        "instead of a placeholder password, so the proof copy is openable",
    )
    ap.add_argument("--send", action="store_true", help="send to the list")
    ap.add_argument("--limit", type=int, default=0, help="stop after N sends")
    ap.add_argument("--delay", type=float, default=45.0, help="seconds between sends")
    ap.add_argument("--company", default="Zaino AI partner", help="company label for --test")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    password = os.environ.get("ZAINO_SMTP_PASSWORD", "")

    recipients = load_recipients()
    accounts = load_accounts()
    print(f"{len(recipients)} unique recipients from {LIST.name}")
    if accounts:
        print(f"{len(accounts)} provisioned accounts from {ACCOUNTS.name}")

    if args.test:
        addr = args.test.strip().lower()
        if args.as_account:
            account = accounts.get(args.as_account.strip().lower())
            if not account:
                sys.exit(f"--as-account {args.as_account}: no provisioned account with that address")
        else:
            account = accounts.get(addr) or {
                "email": args.test,
                "password": "TEST-PASSWORD-CHANGE-ME",
            }
        queue = [{"num": 0, "company": args.company, "email": args.test, "account": account}]
    elif args.send:
        done = already_sent({r["email"].lower() for r in recipients})
        queue, unprovisioned = [], []
        for r in recipients:
            if r["email"].lower() in done:
                continue
            account = accounts.get(r["email"].lower())
            if not account:
                unprovisioned.append(r)
                continue
            queue.append({**r, "account": account})
        if done:
            print(f"{len(done)} already sent, skipping")
        if unprovisioned:
            # Loud, because this is the difference between "batch finished" and
            # "batch silently covered two thirds of the list".
            print(
                f"{len(unprovisioned)} recipient(s) have no provisioned account "
                f"and are being skipped — run outreach/provision.py first:"
            )
            for r in unprovisioned:
                print(f"    {r['num']:>3}  {r['company'][:40]:<40} {r['email']}")
        if args.limit:
            queue = queue[: args.limit]
    else:
        for r in recipients:
            mark = " " if r["email"].lower() in accounts else "!"
            print(f" {mark}{r['num']:>3}  {r['company'][:40]:<40} {r['email']}")
        print("\n! = no provisioned account; that recipient cannot be mailed yet")
        return

    if args.dry_run:
        for r in queue:
            print(f"[dry-run] {r['company']} <{r['email']}>")
        return

    if not queue:
        sys.exit("nothing to send")

    if not password:
        sys.exit("ZAINO_SMTP_PASSWORD is not set")

    server = connect(password)
    ok = failed = 0
    try:
        for i, r in enumerate(queue, 1):
            try:
                server.send_message(build(r))
                ok += 1
                stamp = time.strftime("%Y-%m-%dT%H:%M:%S")
                with SENT_LOG.open("a", encoding="utf-8") as fh:
                    fh.write(f"{stamp}\t{r['email']}\t{r['company']}\n")
                print(f"[{i}/{len(queue)}] sent  {r['company'][:34]:<34} {r['email']}")
            except Exception as e:
                failed += 1
                print(f"[{i}/{len(queue)}] FAIL  {r['company'][:34]:<34} {r['email']}  {e}")
            if i < len(queue):
                time.sleep(args.delay)
    finally:
        server.quit()
    print(f"done: {ok} sent, {failed} failed")
    sys.exit(0 if failed == 0 else 1)


if __name__ == "__main__":
    main()
