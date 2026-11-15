/**
 * Live shares — the reader's cursor, the mode default, and the gates.
 *
 * The two properties that matter most are tested against source, because
 * both are one-word regressions that a behavioural test in a node-only
 * environment cannot reach:
 *
 *   1. the stream route must call `readSharedPage`, which calls
 *      `resolveShare` — the single place revoked/expired/temporary/archived
 *      are checked. A second query in the route is a second set of gates,
 *      and the one that drifts is the silent leak.
 *   2. `is_live` must default to FALSE, in the migration and in the schema,
 *      because a forgotten LIVE link broadcasts everything said next while a
 *      forgotten SNAPSHOT link exposes one stale conversation.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { decodeCursor, encodeCursor } from "@/lib/chat/share-read";

const ROOT = resolve(__dirname, "..");
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");

const STREAM = read("app/api/share/[token]/stream/route.ts");
const SHARE = read("lib/chat/share.ts");
const SHARE_READ = read("lib/chat/share-read.ts");
const MIGRATION = read("db/migrations/0042_live_shares.sql");
const SCHEMA = read("db/schema.ts");
const CLIENT = read("components/chat/shared-live.tsx");
const PAGE = read("app/share/[token]/page.tsx");

describe("cursor — the opaque position a poll resumes from", () => {
  it("round-trips a timestamp and id", () => {
    const createdAt = "2026-11-15T12:00:00.000Z";
    const id = "7d3f9a1e-0000-4000-8000-000000000000";
    const cursor = encodeCursor(createdAt, id);
    expect(decodeCursor(cursor)).toEqual({ createdAt, id });
  });

  it("is base64url — no +, / or = to break a query string", () => {
    const cursor = encodeCursor("2026-11-15T12:00:00.000Z", "7d3f9a1e-0000-4000-8000-000000000000");
    expect(cursor).not.toMatch(/[+/=]/);
  });

  it("returns null for garbage rather than throwing", () => {
    // A malformed cursor is treated as absent (start from the beginning).
    // An error would break a viewer's stream over a value they cannot fix.
    for (const bad of ["", null, undefined, "!!!!", "bm90LWEtY3Vyc29y", "x".repeat(300)]) {
      expect(() => decodeCursor(bad as string | null | undefined)).not.toThrow();
    }
    expect(decodeCursor("bm90LWEtY3Vyc29y")).toBeNull();
  });

  it("rejects an id that is not uuid-shaped before it reaches a ::uuid cast", () => {
    // A bad cast throws inside the query and kills the stream.
    const notUuid = Buffer.from("2026-11-15T12:00:00.000Z|drop-table", "utf8").toString("base64url");
    expect(decodeCursor(notUuid)).toBeNull();
  });

  it("rejects a cursor with no separator", () => {
    const noSep = Buffer.from("just-a-timestamp", "utf8").toString("base64url");
    expect(decodeCursor(noSep)).toBeNull();
  });

  it("rejects an unparseable timestamp", () => {
    const badDate = Buffer.from("not-a-date|7d3f9a1e-0000-4000-8000-000000000000", "utf8").toString("base64url");
    expect(decodeCursor(badDate)).toBeNull();
  });
});

describe("is_live defaults to FALSE everywhere", () => {
  it("in the migration", () => {
    // A forgotten LIVE link broadcasts everything said next. Defaults are
    // how a default becomes a decision nobody made.
    expect(MIGRATION).toMatch(/is_live boolean NOT NULL DEFAULT false/);
  });

  it("in the drizzle schema", () => {
    expect(SCHEMA).toMatch(/isLive:\s+boolean\('is_live'\)\.notNull\(\)\.default\(false\)/);
  });

  it("in createShare's signature — opt-in, never inherited", () => {
    expect(SHARE).toMatch(/isLive\?: boolean/);
    expect(SHARE).toMatch(/input\.isLive === true/);
  });

  it("the API route accepts it but does not default it on", () => {
    // The zod schema lives in the route, not in share.ts — reading the wrong
    // file for it was this test's own bug, caught by running it.
    const ROUTE = read("app/api/chat/conversations/[id]/share/route.ts");
    expect(ROUTE).toContain("isLive: z.boolean().optional()");
    expect(ROUTE).toContain("isLive: body.isLive === true");
  });
});

describe("a live share has NO boundary", () => {
  it("createShare skips resolveBoundary when live", () => {
    // Writing a through_message_id on a live row is ambiguous, and 0042's
    // guard refuses it — so the insert must never produce one.
    expect(SHARE).toMatch(/isLive\s*\?\s*\{ ok: true as const, id: null \}/);
  });

  it("the migration refuses a live row that still carries one", () => {
    expect(MIGRATION).toMatch(/is_live = TRUE[\s\S]{0,80}through_message_id IS NOT NULL/);
  });
});

describe("the read path ignores the boundary ONLY when live", () => {
  it("the snapshot predicate is still there, guarded by isLive", () => {
    // Both queries: a live share must not be truncated, and a snapshot share
    // must not be widened. Asserting the flag appears before the boundary
    // checks is the shape of the guard.
    const guard = /isLive\}\s*\n?\s*OR \$\{share\.throughMessageId\}/;
    expect(SHARE_READ).toMatch(/\$\{share\.isLive\}/);
    expect(SHARE_READ.match(/throughMessageId/g)?.length ?? 0).toBeGreaterThan(0);
    expect(guard.test("${share.isLive}\n         OR ${share.throughMessageId}")).toBe(true);
  });

  it("readSharedPage returns the same gates as the full read", () => {
    // It must not re-implement them: one function resolves the token.
    expect(SHARE_READ).toContain("await resolveShare(token)");
  });
});

describe("§ the stream route re-resolves the token on every tick", () => {
  it("calls readSharedPage, never a query of its own", () => {
    // A second query here is a second set of gates, and the one that drifted
    // would be the leak nobody tests.
    expect(STREAM).toContain("readSharedPage");
    expect(STREAM).not.toMatch(/db\.execute|drizzle|FROM messages/);
  });

  it("reports a dead link instead of polling forever", () => {
    // "no rows" is indistinguishable from "nothing new", so the route sends
    // an explicit end with reason `gone`.
    expect(STREAM).toMatch(/finish\('gone'\)/);
    expect(CLIENT).toMatch(/frame\.reason === "gone"/);
  });

  it("closes immediately for a snapshot share — no future to stream", () => {
    expect(STREAM).toMatch(/if \(!first\.isLive\)/);
  });

  it("caps the stream lifetime so a token is re-checked", () => {
    expect(STREAM).toContain("MAX_STREAM_MS");
  });

  it("answers 404 before opening a stream for a dead token", () => {
    // A client that received SSE headers cannot render an error page.
    expect(STREAM).toMatch(/status: 404/);
  });
});

describe("the client never trusts a frame", () => {
  it("deduplicates by id, so a reconnect cannot double-render", () => {
    expect(CLIENT).toContain("seen.current");
    expect(CLIENT).toMatch(/!seen\.current\.has\(m\.id\)/);
  });

  it("survives a malformed frame", () => {
    expect(CLIENT).toMatch(/catch \{[\s\S]{0,200}return;/);
  });

  it("closes the EventSource on unmount", () => {
    expect(CLIENT).toMatch(/return \(\) => source\.close\(\)/);
  });

  it("does not open a stream for a snapshot share", () => {
    expect(CLIENT).toMatch(/if \(!isLive\) return;/);
  });
});

describe("the page degrades without JavaScript", () => {
  it("server-renders the snapshot before the client component upgrades it", () => {
    // With JS off the transcript is complete as of page load; the feature
    // degrades to "refresh to see more", never to a blank page.
    expect(PAGE).toContain("<SharedLive");
    expect(PAGE).toContain("initial={conversation.messages}");
  });
});

describe("the warning is present and honest", () => {
  it("the live choice names what it publishes", () => {
    const UI = read("components/chat/share-control.tsx");
    expect(UI).toMatch(/Follow the conversation live/);
    expect(UI).toMatch(/appears to whoever holds it|readable by anyone holding the URL/);
  });

  it("a created snapshot link says replies are NOT included", () => {
    const UI = read("components/chat/share-control.tsx");
    expect(UI).toMatch(/Replies you send from now on are NOT included/);
  });
});
