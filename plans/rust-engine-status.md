# Rust engine — what shipped, what is verified, what is next

**Date:** 3 November 2026
**Scope of this pass:** the two audit items where Rust is the right tool — document extraction (#1) and conversation search (#6) — plus the deploy bug found in the audit.
**Read with:** `plans/competitive-audit-chatgpt-codex.md` (the feature gap list).

---

## 1. Why Rust here, and nowhere else

Not a language preference. Two specific jobs fail badly in Node:

| Job | In Next.js | In the engine |
|---|---|---|
| Parsing a 200-page PDF | blocks the event loop for seconds, or needs a worker per upload | runs on a blocking pool; one pathological file costs one request |
| Full-text search | `ILIKE '%q%'` — full scan per keystroke, no ranking, no stemming | tantivy: ranked, stemmed, <10ms |
| A malformed upload | panic/crash risk in the request path | isolated; a parser panic is a 500 on that request only |

Everything else in the audit (memory, projects, share, temporary chat, tool calling, custom instructions, cost footer) is CRUD and UI over Postgres. Writing that in Rust would add a compile step and a deploy target for no gain. **The rule applied: Rust owns the CPU-bound, untrusted-input, or algorithmic parts; TypeScript owns the product surface.**

---

## 2. What was built

`engine/` — a standalone service, 1,795 lines, 5 modules:

| File | Responsibility |
|---|---|
| `src/extract.rs` | PDF, docx, xlsx/xlsm/ods, csv, plain text, images. Magic-byte sniffing, head+tail truncation, typed errors. |
| `src/search.rs` | tantivy index: upsert, delete, ranked search, tenant-filtered. |
| `src/api.rs` | axum routes: `/health`, `/extract`, `/search`, `/index`, `/index/{id}`. Bearer auth, typed status codes. |
| `src/server.rs` | Config, boot, graceful shutdown. Fails closed without `ENGINE_TOKEN`. |
| `src/main.rs` | Entry; `--version` for the container healthcheck. |

Plus, on the portal side:

| File | Responsibility |
|---|---|
| `portal/lib/engine/client.ts` | Typed client that **degrades instead of throwing**. |
| `portal/db/migrations/0030_attachments.sql` | `attachments`, `message_attachments`, `messages.content_tsv` + GIN, `attachment_chars`. |
| `portal/db/schema.ts` | Drizzle mirror of the two new tables. |
| `portal/tests/engine-client.test.ts` | 21 tests, mostly degradation and tenancy. |

Deployment: `engine/Dockerfile` (2-stage, non-root, LTO), compose service `engine` (no published port), `engineindex` volume, `.gitignore` `target/`, `make verify-engine`.

---

## 3. What is actually verified

Not claims — commands run and their results.

| Check | Result |
|---|---|
| `cargo test -p zaino-engine` | **35 passed, 0 failed** (24 unit + 11 HTTP integration) |
| `cargo clippy -p zaino-engine --all-targets -- -D warnings` | **clean** |
| `./target/debug/zaino-engine --version` | `zaino-engine 0.1.0` |
| fail-closed boot without `ENGINE_TOKEN` | exit code **2**, logs the reason |
| live smoke test (`curl`) | `/health` 200; authenticated `/extract` on a real **19MB PDF** returned text; unauthenticated request **401** |
| `make verify-engine` | all three stages pass |
| `npx tsc --noEmit` | **clean** |
| `npx vitest run` | **460 passed** (was 439; +21 new) |
| `docker compose config` | **valid** (with required env set) |

### Not verified — stated plainly

1. **`0030_attachments.sql` has never been applied to a Postgres.** No server or Docker daemon was available. The risky construct is the generated column: `to_tsvector('simple', …)` uses an explicit `regconfig`, which is the immutable form required, but this needs `make db-migrate` against a real database before it is trusted.
2. **`engine/Dockerfile` has never been built.** The daemon is down. The dependency-layer trick (`COPY` manifests, stub `src`, build, then copy real source) is a standard pattern but unproven here.
3. **A local `--release` build was abandoned** — `lto = "thin"` + `codegen-units = 1` filled the 228GB volume at 117MB free. Release builds belong in Docker. Do not run `cargo build --release` on this machine without ~5GB spare.
4. **No UI yet.** The composer has no attach button; the sidebar has no search box. The backend and the client exist; nothing calls them.

---

## 4. Next: the wiring (no new architecture)

This is the gap between "the engine works" and "a user can attach a PDF."

1. **`POST /api/attachments`** — `requireActiveOrg` → size/shape check → `extractDocument()` → insert `attachments` on `(organization_id, content_hash)` conflict → return the row. Org from the session, never the body.
2. **`app/api/chat/route.ts`** — accept `attachmentIds[]`, verify each belongs to the caller's org (the IDOR rule; the engine cannot do this), join the text into the prompt, increment `messages.attachment_chars`.
3. **`components/chat/composer.tsx`** — attach control + drag-drop + chips with per-file extract status. `engineConfigured() === false` must hide the control, not disable it — a disabled button with no explanation reads as a bug.
4. **`components/chat/conversation-list.tsx`** — a filter box hitting `searchConversations()`, debounced, with an "unavailable" state that does not look like "no results".
5. **Index on turn completion** — `indexConversation()` after the message commits. Fire-and-forget by design; a slow index must never add latency to a reply.
6. **CSP** — the attach route needs no new directive, but a rendered snippet from search must stay text-only.

Then the remaining audit items in their own passes: tool calling (the prerequisite for web search), projects, memory, message edit/branch, share/export, temporary chat.

---

## 5. Two things to decide

1. **`ENGINE_TOKEN` optional or required?** Currently optional by design: an operator who does not run the engine gets chat with attachments and search hidden. If you would rather attachments be a hard product promise, the compose `:?` changes and the portal stops degrading — but then a missing token becomes a portal outage instead of a hidden feature.
2. **Reindex strategy.** The index is derived and disposable, so today there is no backfill: conversations from before this pass are not searchable. A `jobs` task calling `indexConversation()` per conversation fixes it. Worth doing before anyone turns search on in production, or the first impression is "search does not find my old chats."

---

## 6. Unrelated, but needs your attention

The working tree has **19 tracked deletions** that predate this pass and that I did not make:
`BLUEPRINT.md`, `CONTEXT.md`, `DESIGN.md`, `HANDOFF.md`, `IMPLEMENTATION.md`, `LATENCY.md`, `MASTER_PROMPT.md`, `PLATFORM.md`, `PORTAL_PRODUCT_AUDIT.md`, `VPS_CLONE_PROMPT.md`, `OPENCODE_DESKTOP_CLIENT_PROMPT.md`, plus `docs/*` and `plans/*`.

All 19 are recoverable from `HEAD` (`git restore --source=HEAD --worktree -- <path>`). Several are cited as required reading by the audit and the handoff docs — including `PLATFORM.md` (the IDOR rule) and `PORTAL_PRODUCT_AUDIT.md` (§1 conversion gap, §10 playground). **Decide whether that was intentional before anyone commits**, because a commit made now would silently delete the project's own specification.

---

# Capability layer — what shipped after the engine

**Date:** 3 November 2026
**Scope:** audit §2 items 1–6, 11–15 and the §3 depth items, on top of the engine.
**Rule held throughout:** Rust owns the engine (extraction, search); TypeScript owns the product surface (CRUD, streaming, UI over Postgres).

## Data (migration `0031_capabilities.sql`)

Additive only. Nothing drops, nothing rewrites history.

| Table / column | Why it is shaped that way |
|---|---|
| `projects` | Optional context layer. `archived_at`, never a hard delete: `conversations.project_id` is `ON DELETE SET NULL`, so deleting a folder would silently unparent its chats. |
| `memories` | **One row per fact**, not a jsonb blob. The audit's requirement is "delete one thing", and a blob cannot do that without a read-modify-write racing the extractor. `source_conversation_id` is `SET NULL` so a memory outlives the chat it was learned in. |
| `conversation_shares` | Token stored as **sha256 only**. A database dump yields no working links. Revoke is a row update, expiry is a column. |
| `custom_instructions` | One row per **user**, deliberately not in `chat_presets`: "who I am" must not be overridable from one chat's settings. |
| `scheduled_prompts` | Runs on the existing `scripts/jobs.ts` loop, so this is a table, not a second scheduler. |
| `messages.parent_message_id` | Makes edit/branch a **fact**, not a UI trick: the visible transcript is one path through a DAG. |
| `conversations.active_branch_head` | Which leaf is shown — one nullable read instead of a tree walk per render. |
| `messages.attachment_chars` | Explains a large `input_tokens` value: 50k tokens on a two-line question only confuses if you cannot see the 180k-char PDF. |

## New modules

- `lib/chat/prompt.ts` — pure. Builds the system prompt in a fixed order (**custom instructions → memories → project → per-chat → attachment notice → web notice**). Later layers win. Unit-tested because a missing section is invisible: it produces a plausible answer that merely forgets a preference.
- `lib/chat/web-search.ts` — SearXNG / Brave / Tavily behind one interface. Results are treated as untrusted: http(s) URLs only, bidi and zero-width characters stripped, everything length-capped. `none` is an honest provider — no backend means the toggle is not rendered, rather than shown broken.
- `lib/chat/memory-rules.ts` — **pure**, split out like `preset.ts`, because `memory.ts` imports `@/db` and would otherwise make the only logic worth testing untestable. `containsSecret` and `looksLikeFact` are the two filters between "the model said something" and "a row prepended to every future turn".
- `lib/chat/memory-extract.ts` — one `fast`-alias, bounded, metered call **after** the answer is on screen. Refuses temporary chats, runs the three filters, dedupes by `memoryKey`.
- `lib/chat/projects.ts`, `share.ts`, `share-read.ts`, `instructions.ts`, `schedule-run.ts`.
- `gateway.ts` gains `completeOnce()` — non-streaming, for callers that need the whole answer (extraction, schedules). Same gateway, same key: **never an unmetered path**.

## Routes

`POST|GET /api/attachments`, `GET /api/chat/search`, `/api/chat/projects[/id]`, `/api/chat/conversations/[id]/project`, `/api/chat/conversations/[id]/share`, `/api/chat/memories[/id]`, `/api/chat/instructions`, `/api/chat/scheduled[/id]`, and the public `app/share/[token]`.

Every handler starts with `requireActiveOrg`, and ownership is a **WHERE clause** rather than a post-fetch check, so a forgotten guard cannot become a cross-tenant read.

## UI

Attachment chips + drag-drop + paste; ⌘K palette and an inline sidebar filter that **replaces** the list; Projects section; Share control and public page; a new **AI** settings tab (memory viewer + custom instructions); a Search toggle in the composer; a Temporary chat entry in the sidebar.

## Decisions worth keeping

- **Attachments store text, not bytes.** The engine parses in memory; the original is discarded. This product is not secretly a file host with a retention problem.
- **`webSearch` defaults off** and is stated in the composer. A search result is untrusted text entering the prompt, so it is opt-in rather than a background behaviour discovered via a citation.
- **Editing a message is a new turn**, not an UPDATE. The assistant answer that followed was generated from text that no longer exists and was billed for; masking the old path keeps the transcript and the ledger in agreement.
- **Retention archives, not deletes.** Retention is about what the product keeps readable; `usage_records` still needs the rows to reconcile. Real deletion is per conversation.
- **Share reads re-check `temporary` at read time**, so marking a chat private retroactively kills an old link.

## Verified

- `cargo test` 35 passed, `clippy --all-targets -D warnings` clean, binary `v0.1.0`.
- `npx tsc --noEmit` clean.
- `npx vitest run` **503 passed / 33 files** (was 460). New: `chat-prompt` (15), `chat-memory` (16), `chat-web-search` (12).

## NOT verified — stated as such

- **Migration `0031` has never run against a Postgres.** No server, no Docker daemon on this machine. The SQL is additive and guarded by `IF NOT EXISTS`, but it is unexecuted.
- **`engine/Dockerfile` has never been built** (same reason).
- **No live web search has been performed** — no `SEARXNG_URL` and no provider key is configured here. The provider code paths, timeouts and sanitisation are unit-tested; the HTTP round trip is not.
- **Memory extraction has never called a live model** in this environment. Its parsing and filters are tested; the call itself is not.

## Still open, and not mine to close

**19 tracked deletions predate this work** and are still in the working tree: `BLUEPRINT.md`, `CONTEXT.md`, `DESIGN.md`, `HANDOFF.md`, `IMPLEMENTATION.md`, `LATENCY.md`, `MASTER_PROMPT.md`, `PLATFORM.md`, `PORTAL_PRODUCT_AUDIT.md`, `VPS_CLONE_PROMPT.md`, `OPENCODE_DESKTOP_CLIENT_PROMPT.md`, plus `docs/*` and `plans/*`. All are recoverable from `HEAD`. **A commit made now would silently delete the project's own specification.** Restore with `git restore -- <paths>` before committing.

Explicitly deferred, unchanged: canvas, image generation, voice, deep research, agent mode, and the Codex sandbox/approval architecture.
