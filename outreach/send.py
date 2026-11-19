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
import imaplib
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
IMAP_HOST = "mail.privateemail.com"
IMAP_PORT = 993
DRAFTS_MAILBOX = "Drafts"
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

# Provider ceiling for this mailbox: the plan is a Namecheap trial, which is
# 20 outgoing messages per rolling hour. Exceeding it is not a soft failure —
# the server rejects with 554 and keeps rejecting until the window rolls, so
# an hour of a batch can be lost to it. Pacing under the ceiling is the only
# way to send ~115 messages from here without a second provider.
RATE_LIMIT = 20
RATE_WINDOW = 3600


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


def recent_send_times():
    """When this mailbox last sent, oldest first, from the send log.

    The log is the only record that survives a restarted process, so it is
    what the rolling window is measured against. A run that begins straight
    after an earlier one must inherit that one's spend.
    """
    if not SENT_LOG.exists():
        return []
    out = []
    for line in SENT_LOG.read_text(encoding="utf-8").splitlines():
        stamp = line.split("\t", 1)[0].strip()
        try:
            out.append(time.mktime(time.strptime(stamp, "%Y-%m-%dT%H:%M:%S")))
        except ValueError:
            continue
    return sorted(out)


def waits_for_rate_limit():
    """Seconds to wait before the next send fits the rolling hourly window."""
    now = time.time()
    recent = [t for t in recent_send_times() if now - t < RATE_WINDOW]
    if len(recent) < RATE_LIMIT:
        return 0.0
    # The slot frees up when the 20th-most-recent send ages out of the window.
    oldest_holding_a_slot = recent[-RATE_LIMIT]
    return max(0.0, oldest_holding_a_slot + RATE_WINDOW - now) + 5


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


def send_one(msg, password):
    """One message on its own connection.

    A long-lived session left the batch indistinguishable from a hang: the
    process sat in select() between sends while the provider was silently
    throttling it, and nothing in the log said which. A fresh session per
    message costs one TLS handshake and makes every message's outcome — sent
    or rejected — attributable to that message in the log.
    """
    ctx = ssl.create_default_context()
    s = smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, context=ctx, timeout=45)
    try:
        s.login(FROM_ADDR, password)
        s.send_message(msg)
    finally:
        try:
            s.quit()
        except Exception:
            s.close()


def draft_message_ids(imap):
    """Message-IDs already sitting in Drafts.

    IMAP APPEND has no duplicate suppression, so without this a second run
    would double every draft and leave the user sending each prospect twice.
    """
    typ, _ = imap.select(DRAFTS_MAILBOX)
    if typ != "OK":
        return set()
    typ, data = imap.search(None, "ALL")
    if typ != "OK" or not data or not data[0]:
        return set()
    ids = set()
    for num in data[0].split():
        typ, parts = imap.fetch(num, "(BODY.PEEK[HEADER.FIELDS (MESSAGE-ID)])")
        if typ != "OK":
            continue
        for part in parts:
            if isinstance(part, tuple):
                raw = part[1].decode("utf-8", "replace")
                _, _, value = raw.partition(":")
                ids.add(value.strip().strip("<>"))
    return ids


def save_draft(imap, msg):
    raw = msg.as_bytes()
    typ, resp = imap.append(
        DRAFTS_MAILBOX,
        r"(\Draft)",
        imaplib.Time2Internaldate(time.time()),
        raw,
    )
    if typ != "OK":
        raise RuntimeError(f"append refused: {resp}")


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
    ap.add_argument(
        "--delay",
        type=float,
        default=185.0,
        help="seconds between sends (default paces evenly under RATE_LIMIT)",
    )
    ap.add_argument("--company", default="Zaino AI partner", help="company label for --test")
    ap.add_argument(
        "--drafts",
        action="store_true",
        help="write one draft per unsent recipient into the mailbox Drafts folder",
    )
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
    elif args.send or args.drafts:
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

    if args.drafts:
        if not password:
            sys.exit("ZAINO_SMTP_PASSWORD is not set")
        imap = imaplib.IMAP4_SSL(IMAP_HOST, IMAP_PORT, ssl_context=ssl.create_default_context())
        imap.login(FROM_ADDR, password)
        try:
            existing = draft_message_ids(imap)
            made = skipped = 0
            for i, r in enumerate(queue, 1):
                msg = build(r)
                if msg["Message-ID"].strip("<>") in existing:
                    skipped += 1
                    continue
                save_draft(imap, msg)
                existing.add(msg["Message-ID"].strip("<>"))
                made += 1
                print(f"[{i}/{len(queue)}] draft {r['company'][:34]:<34} {r['email']}", flush=True)
        finally:
            try:
                imap.logout()
            except Exception:
                pass
        print(f"done: {made} drafts written, {skipped} already present", flush=True)
        return

    if not password:
        sys.exit("ZAINO_SMTP_PASSWORD is not set")

    ok = failed = 0
    for i, r in enumerate(queue, 1):
        wait = waits_for_rate_limit()
        if wait > 0:
            until = time.strftime("%H:%M:%S", time.localtime(time.time() + wait))
            print(f"rate limit: hourly quota spent, holding {wait/60:.0f}m until {until}", flush=True)
            time.sleep(wait)
        try:
            send_one(build(r), password)
            ok += 1
            stamp = time.strftime("%Y-%m-%dT%H:%M:%S")
            with SENT_LOG.open("a", encoding="utf-8") as fh:
                fh.write(f"{stamp}\t{r['email']}\t{r['company']}\n")
            print(f"[{i}/{len(queue)}] sent  {r['company'][:34]:<34} {r['email']}", flush=True)
        except smtplib.SMTPDataError as e:
            # 554 at DATA time is the provider's throttle, not a bad address.
            # Retrying the rest of the queue would only collect more of them.
            print(f"[{i}/{len(queue)}] HALT  provider refused the message: {e}", flush=True)
            break
        except Exception as e:
            failed += 1
            print(f"[{i}/{len(queue)}] FAIL  {r['company'][:34]:<34} {r['email']}  {e}", flush=True)
        if i < len(queue):
            time.sleep(args.delay)
    print(f"done: {ok} sent, {failed} failed", flush=True)
    sys.exit(0 if failed == 0 else 1)


if __name__ == "__main__":
    main()
