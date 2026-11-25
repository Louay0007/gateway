/**
 * Retention must not archive a conversation someone holds a live link to.
 *
 * This is a source test, not a behavioural one, and the reason is the bug it
 * covers: `enforceRetention` builds the same eligibility predicate twice —
 * once to COUNT what will expire, once inside the UPDATE that archives it.
 * They had drifted. Only the count excluded a conversation with a non-revoked
 * share, so a run reported `expired: 0` and then archived the chat anyway,
 * turning a URL its owner handed to a colleague into a 404 with nothing in
 * the log to explain it.
 *
 * A node-only suite has no Postgres, so the property asserted here is the one
 * that actually failed: the two statements must share ONE predicate, and the
 * archive statement must not carry a hand-written copy of its own.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "..");
const SERVICE = readFileSync(resolve(ROOT, "lib/chat/service.ts"), "utf8");

/** The body of `enforceRetention`, from its signature to the closing brace. */
function retentionBody(): string {
  const start = SERVICE.indexOf("export async function enforceRetention");
  expect(start).toBeGreaterThan(-1);
  // The next top-level `export` — or end of file — bounds the function, so a
  // predicate added to a sibling never satisfies an assertion about this one.
  const next = SERVICE.indexOf("\nexport ", start + 1);
  return SERVICE.slice(start, next === -1 ? undefined : next);
}

describe("retention and live shares", () => {
  it("declares the eligibility predicate exactly once", () => {
    const body = retentionBody();
    const declarations = body.match(/const expiredSince = sql`/g) ?? [];
    expect(declarations).toHaveLength(1);
  });

  it("excludes a conversation with a live share from the predicate", () => {
    const body = retentionBody();
    const predicate = body.slice(
      body.indexOf("const expiredSince"),
      body.indexOf("const expiredRows"),
    );
    expect(predicate).toContain("NOT EXISTS");
    expect(predicate).toContain("conversation_shares");
    expect(predicate).toContain("sh.revoked_at IS NULL");
  });

  it("uses that one predicate for BOTH the count and the archive", () => {
    const body = retentionBody();
    // Only two interpolations should exist beyond the declaration itself.
    const uses = body.match(/\$\{expiredSince\}/g) ?? [];
    expect(uses).toHaveLength(2);
    // Both live in a WHERE clause — a predicate pasted into a comment or a
    // projection would satisfy a bare count without gating anything.
    expect(body).toMatch(/WHERE \$\{expiredSince\}/);
  });

  it("the archive statement has no hand-written copy of the predicate", () => {
    const body = retentionBody();
    const archive = body.slice(body.indexOf("UPDATE conversations", body.indexOf("expiredRows")));
    // A second, drifting copy is exactly the regression this file exists for.
    expect(archive).not.toContain("conversation_shares");
    expect(archive).not.toContain("pinned_at");
    expect(archive).not.toContain("history_days");
  });

  it("archives rather than deletes, so the ledger can still reconcile", () => {
    const body = retentionBody();
    const archive = body.slice(body.indexOf("UPDATE conversations", body.indexOf("expiredRows")));
    expect(archive).toContain("SET archived_at = now()");
    expect(archive).not.toContain("DELETE FROM conversations");
  });
});
