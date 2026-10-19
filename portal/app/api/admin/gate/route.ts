import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import crypto from "node:crypto";

import {
  checkGateThrottle,
  clientIp,
  recordGateFailure,
  recordGateSuccess,
} from "@/lib/admin/gate-throttle";

/**
 * Admin secret-code gate.
 *
 * The operations console is gated HERE and role-gated in the layout
 * (requireStaff). This used to be a THIRD layer behind an IP allowlist at
 * the edge; that allowlist has been removed, so this shared secret is now
 * the ONLY thing between the public internet and a staff login form.
 *
 * That change makes two things load-bearing, and both are implemented here:
 *
 *   1. THE SECRET MUST BE SET. `gatePassed()` in app/admin/layout.tsx
 *      returns TRUE when ADMIN_GATE_SECRET is unset — the gate is disabled,
 *      not locked. With the IP allowlist gone, an unset secret means the
 *      console is simply open. Hence the 503 below rather than a silent
 *      fail-open, and the check that runs before anything else.
 *   2. THE GATE MUST BE THROTTLED. A single shared secret with no rate
 *      limit is a brute-force target. `lib/admin/gate-throttle.ts` applies
 *      progressive backoff keyed on the caller's IP.
 *
 * The cookie minted below is httpOnly, secure, same-site strict, and scoped
 * to /admin — it never leaks to customer routes. TTL is 24 hours so a stolen
 * cookie expires faster than a session JWT.
 */

const SECRET = process.env.ADMIN_GATE_SECRET ?? "";
const COOKIE_NAME = "admin_gate";
const TTL_SECONDS = 60 * 60 * 24; // 24 hours

function sign(secret: string): string {
  return crypto.createHmac("sha256", secret).update(COOKIE_NAME).digest("hex");
}

export async function POST(req: NextRequest) {
  // Fail LOUD, not open. `gatePassed()` treats an unset secret as "gate
  // disabled", so answering anything else here would let the console be
  // walked straight through by anyone who can POST.
  if (!SECRET) {
    return NextResponse.json(
      { error: "ADMIN_GATE_SECRET is not configured on the server" },
      { status: 503 },
    );
  }

  const ip = clientIp(req.headers);

  // Checked BEFORE the compare so a locked-out caller spends no CPU on
  // the secret, and after the SECRET check so an unconfigured deployment
  // never touches the throttle table.
  const before = await checkGateThrottle(ip);
  if (before.blocked) {
    return NextResponse.json(
      { error: "Too many attempts. Try again later." },
      {
        status: 429,
        headers: { "Retry-After": String(before.retryAfterSeconds) },
      },
    );
  }

  const body = await req.json().catch(() => null);
  const code = typeof body?.code === "string" ? body.code.trim() : "";

  const matches =
    code.length === SECRET.length &&
    crypto.timingSafeEqual(Buffer.from(code), Buffer.from(SECRET));

  if (!matches) {
    const after = await recordGateFailure(ip);
    if (after.blocked) {
      return NextResponse.json(
        { error: "Too many attempts. Try again later." },
        { status: 429, headers: { "Retry-After": String(after.retryAfterSeconds) } },
      );
    }
    return NextResponse.json({ error: "Invalid code" }, { status: 401 });
  }

  // Correct code clears the streak, so a fumbled-then-correct operator is
  // not left one bad guess away from a lockout on the next attempt.
  await recordGateSuccess(ip);

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, sign(SECRET), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/admin",
    maxAge: TTL_SECONDS,
  });

  return NextResponse.json({ ok: true });
}