import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import crypto from "node:crypto";

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
 */

const SECRET = process.env.ADMIN_GATE_SECRET ?? "";
const COOKIE_NAME = "admin_gate";
const TTL_SECONDS = 60 * 60 * 24; // 24 hours

function sign(secret: string): string {
  return crypto.createHmac("sha256", secret).update(COOKIE_NAME).digest("hex");
}

export async function POST(req: NextRequest) {
  if (!SECRET) {
    return NextResponse.json(
      { error: "ADMIN_GATE_SECRET is not configured on the server" },
      { status: 503 },
    );
  }

  const body = await req.json().catch(() => null);
  const code = typeof body?.code === "string" ? body.code.trim() : "";

  if (
    !code ||
    code.length !== SECRET.length ||
    !crypto.timingSafeEqual(Buffer.from(code), Buffer.from(SECRET))
  ) {
    return NextResponse.json({ error: "Invalid code" }, { status: 401 });
  }

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