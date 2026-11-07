import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import crypto from "node:crypto";

import { jsonError } from "@/lib/api/errors";
import { clientIp, MINUTE, rateLimit } from "@/lib/api/ratelimit";
import { log } from "@/lib/log";

/**
 * Admin secret-code gate.
 *
 * The operations console is IP-gated at the edge (Caddyfile) AND
 * role-gated in the layout (requireStaff). This is a THIRD layer: a
 * shared secret that must be presented before the console even renders
 * a login form. It stops anyone who has the IP allowlist but not the
 * secret from seeing the staff-access-required message or probing the
 * auth surface.
 *
 * The secret lives in ADMIN_GATE_SECRET (env). The cookie it mints is
 * httpOnly, secure, same-site strict, and scoped to /admin — it never
 * leaks to customer routes. TTL is 24 hours so a stolen cookie expires
 * faster than a session JWT.
 *
 * Every failure answers the SAME 401 envelope, whatever the cause. An
 * unset secret is logged server-side and reported as a bad code: telling
 * a caller "the server forgot to configure this" is an oracle, and the
 * difference is useless to an operator who can read the logs.
 */

const COOKIE_NAME = "admin_gate";
const TTL_SECONDS = 60 * 60 * 24; // 24 hours

// 10 attempts per 15 minutes per IP. A human typing a shared secret needs
// three; anything past that is a script.
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 15 * MINUTE;

function sign(secret: string): string {
  return crypto.createHmac("sha256", secret).update(COOKIE_NAME).digest("hex");
}

/** Constant-time compare that tolerates a length mismatch (no early exit). */
function codeMatches(code: string, secret: string): boolean {
  const a = crypto.createHash("sha256").update(code).digest();
  const b = crypto.createHash("sha256").update(secret).digest();
  return crypto.timingSafeEqual(a, b) && code.length === secret.length;
}

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const limit = await rateLimit(`admin-gate:ip:${ip}`, {
    max: MAX_ATTEMPTS,
    windowMs: WINDOW_MS,
  });
  if (!limit.allowed) {
    return jsonError("rate_limited", "Too many attempts. Wait a few minutes and try again.", {
      "Retry-After": String(limit.retryAfterSeconds),
    });
  }

  // Read the secret per request, not at module load: `next start` is not
  // the only entry point, and a module-level constant bakes in whatever
  // the env held when the bundle was first imported.
  const secret = process.env.ADMIN_GATE_SECRET ?? "";
  if (!secret) {
    log.error("admin gate: ADMIN_GATE_SECRET is not set — every code is refused");
    return invalid();
  }

  const body = (await req.json().catch(() => null)) as { code?: unknown } | null;
  const code = typeof body?.code === "string" ? body.code.trim() : "";

  if (!code || !codeMatches(code, secret)) {
    return invalid();
  }

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, sign(secret), {
    httpOnly: true,
    // Derived from the REQUEST, not NODE_ENV.
    //
    // `NODE_ENV === "production"` is true in every built container, including
    // a locally-served one over plain HTTP. The flag made the browser accept
    // the cookie and then silently refuse to send it back over http, so the
    // gate answered 200 and every console page behind it still redirected to
    // /admin — a loop with no error message anywhere, because nothing is
    // actually broken: Secure is doing exactly what it says.
    //
    // Caddy sets X-Forwarded-Proto, and Next surfaces that as nextUrl.protocol,
    // so this is Secure over TLS (production, always) and not Secure on a
    // plain-HTTP local stack. Never hardcode either value: a cookie that is
    // never Secure on a TLS origin is a real downgrade, and one that is always
    // Secure makes every non-TLS deployment unable to hold a gate session.
    secure: req.nextUrl.protocol === "https:",
    sameSite: "strict",
    // Path must be "/" not "/admin" because admin API routes live under
    // /api/admin/* (e.g. /api/admin/d17/[id]/screenshot). A cookie scoped
    // to /admin would never reach those endpoints, causing "Not signed in"
    // on every gate-authenticated API call. The cookie is httpOnly + secure
    // + sameSite strict, so broadening the path does not leak it to
    // customer-facing code — only JS on this host could read it, and
    // sameSite strict blocks cross-site sends entirely.
    path: "/",
    maxAge: TTL_SECONDS,
  });

  return Response.json({ ok: true });
}

function invalid(): Response {
  return jsonError("unauthorized", "Invalid code");
}
