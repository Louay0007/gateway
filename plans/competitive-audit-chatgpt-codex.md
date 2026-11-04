# Competitive audit — Zaino AI vs ChatGPT (web) vs Codex (desktop/agent)

**Date:** 2 November 2026
**Scope:** what `portal/` and `desktop/` ship today, measured against the ChatGPT web product and the Codex app.
**Method:** every claim about *our* side is read from the code, not from the earlier plans. The plans describe intent; this audits the tree.

---

## 0. What changed since the last audit, and why it matters

The last handoff (`plans/CLAUDE_CODE_HANDOFF.md`) assumed a revert was still pending and the dashboard was the only working surface. **That is out of date.** The revert landed and Phase 1–5 are substantially built:

| Evidence | Value |
|---|---|
| `git log` | `feat(desktop): build the Zaino AI desktop app on the Cline shell`, `test(chat): assert a real model reply reaches the transcript` |
| Chat routes | `app/(chat)/chat/page.tsx`, `app/(chat)/chat/[id]/page.tsx`, `app/(chat)/layout.tsx`, `app/(chat)/settings/page.tsx` |
| Chat API | `app/api/chat/route.ts`, `conversations/`, `conversations/[id]/`, `presets/` |
| Chat lib | `gateway.ts`, `key.ts`, `preset.ts`, `quota.ts`, `screen.ts`, `service.ts`, `settings.ts`, `sse.ts` |
| Chat UI | `chat-view`, `composer`, `conversation-list`, `model-picker`, `chat-settings`, `quota-hint`, `starter-prompts` |
| Migrations | `0026_chat`, `0027_chat_ui` (pin, settings, reasoning, meta, `chat_presets`), `0028_fresh_input_tokens`, `0029_grandfathered_daily_window` |
| Test suite | **439 passed, 0 failed** (29 files) — the two pre-existing failures are fixed |
| Desktop | Tauri 2 shell, 16 commands, keychain key storage, on-disk conversations |

So the gap is no longer "build the chat product." It is **"the chat product is missing the capability layer that makes ChatGPT/Codex feel like more than a textbox."**

---

## 1. Where we are already at parity

Do not rebuild these. They are done, and several are better than a naive port.

| Capability | Ours | Note |
|---|---|---|
| Streaming with reasoning split | Yes | `messages.reasoning` is a separate column; `ReasoningPanel` collapses it, `Brain` icon pulses live. ChatGPT does this; most clones concatenate it into the answer. |
| Stop mid-stream, honest persistence | Yes | `AbortController` in `chat-view.tsx:89`; `route.ts:44-45` persists as `aborted` rather than lying or discarding. |
| Per-turn cost/token attribution | Yes | `messages.gatewayRequestId` joins `usage_records`; `inputTokens`, `outputTokens`, `costUsd`, `latencyMs` all typed. This is **ahead** of ChatGPT, which does not expose per-message cost on the web. |
| Model picker bound to entitlement | Yes | `getAllowedModels` is the single wall; disabled aliases + `quota-hint`. |
| Conversation pin / rename / delete / archive | Yes | `pinned_at` with a partial index; optimistic-by-refetch delete. |
| Auto-title from first message | Yes | Derived server-side, deliberately **without** a model call (`service.ts:217-229`) — a titling request would be a metered request. |
| Per-chat generation settings | Yes | Three-layer merge global → model → chat (`chat_presets` + `conversations.settings`), validated by `GenerationSettings`. |
| Settings: 6 tabs | Yes | plan, usage, keys, billing, profile, danger — shared by both shells via `SettingsPanel`. |
| CSP | Yes | Real policy now in `next.config.ts:57-69`, incl. `frame-ancestors 'none'`, `object-src 'none'`. |
| Markdown rendering | Yes | `streamdown@2.7.1`. |
| Desktop client | Yes | Tauri 2, keychain (`keyring`), device-code sign-in, on-disk JSON conversations. |
| Dark/light, a11y basics | Yes | `aria-label`s throughout, skip-link, live regions. |

**The honest summary: the v1 shape is done well.** The gaps below are the difference between "a good chat app" and "the product category leader."

---

## 2. Missing — capability layer

These are the features that define the ChatGPT/Codex experience. None are present in our tree; each was probed for explicitly.

| # | Capability | ChatGPT / Codex | Ours | Impact |
|---|---|---|---|---|
| 1 | **File & image input** | upload, parse, vision, attach to a turn | **absent.** `messages` has no `parts`/attachment column; no `multipart`/`FormData` route under `app/api/chat`; composer has no attach control | **Critical.** This is the single largest gap. Without it there is no "read this PDF," "debug this screenshot," "analyse this CSV." |
| 2 | **Web search / browsing** | first-class, cited | **absent.** Zero `search` capability in chat code; no tool-call plumbing | **Critical.** Without it the model is frozen at its cutoff and answers "I can't check." |
| 3 | **Tool calling / MCP / connectors** | `tools`, function calls, plugins, connectors | **absent.** `tools: 0`. `gateway.ts` sends plain completions | **Critical** for Codex parity; high for ChatGPT parity. |
| 4 | **Memory** | remembers facts, viewable/editable/deletable | **absent.** No table, no column, no route | High. Every conversation restarts from zero. |
| 5 | **Projects / folders** | group chats + files + instructions under one objective, shareable | **absent.** Flat conversation list only; no project table | High. Power users hit a wall at ~50 conversations. |
| 6 | **Conversation search** | ⌘K full-text | **absent.** `conversations` route has no `q=`; no search in sidebar | High. Cheap to add; the pain is immediate and daily. |
| 7 | **Message edit / branch / fork** | edit a prompt, regenerate from there, fork a thread | **partial: regenerate only.** No edit, no branch, no fork | Medium-high. Regenerate re-answers the *last* turn only — you cannot fix an earlier prompt without starting over. |
| 8 | **Canvas / artifacts** | editable doc/code side panel | **absent** | Medium. |
| 9 | **Image generation** | in-chat | **absent** | Medium (may be deliberately out of scope). |
| 10 | **Voice** | hands-free in/out | **absent** | Low-medium. |
| 11 | **Share / public link / export** | shareable conversation, export | **absent.** No share route, no export of a conversation | Medium. Note `/api/usage/export` exists — that is usage CSV, **not** conversation export. Do not confuse them. |
| 12 | **Temporary / incognito chat** | not saved, not used for training | **absent** | Medium — and it is a trust feature, not a nice-to-have. |
| 13 | **Custom instructions (global)** | persona/tone applied everywhere | **partial.** `chat_presets` with `scope=''` can hold a global `systemPrompt`, but there is no dedicated UI, and no separate "about me / how to respond" pair | Low-medium; mostly a UI surface on data we already store. |
| 14 | **Reasoning-effort control** | per-model effort selector | **absent.** `gateway.ts:34` notes the deployment default; nothing lets the user choose | Medium. Cheap: it is a request param. |
| 15 | **Scheduled tasks / automation** | recurring prompts, monitors | **absent** | Low for now. |
| 16 | **Deep research / agent mode** | multi-step, steered, cited report | **absent** | Low for now; large build. |

### The Codex-specific column

Codex is an *agent*, not a chat. If the desktop app is meant to compete there, the missing pieces are structural:

| Capability | Codex | Ours |
|---|---|---|
| Sandbox (read-only / workspace-write, network off by default) | core | **absent** — no `Sandbox` concept, no fs policy |
| Approval flow (request → approve/deny, per-action or per-session) | core | **absent** — no approval queue in `main.rs` |
| Auto-review subagent for escalations | yes | **absent** |
| Diff review, changed files, test results in-app | yes | **absent** |
| AGENTS.md / rules files | yes | **absent** |
| Local code execution + terminal | yes | **absent** |
| MCP tool servers | yes | **absent** |
| Remote/mobile handoff | yes | **absent** |

Our desktop app today is a **thin native chat client** (16 commands, streamed turn, on-disk transcripts, keychain). That is a legitimate product — but it is not Codex, and the delta is a sandbox + approval + execution architecture, not a feature or two. **Recommendation: do not frame the desktop app as a Codex competitor until items 1–3 above land and a sandbox story exists.** Framing it as "the fast native client for your gateway" is defensible today.

---

## 3. Missing — depth on things we already have

These are cheaper than §2 and improve the product more per unit of work.

1. **No conversation search.** The sidebar has pin/rename/delete but no filter. At 100+ conversations this is the top complaint. Full-text over `messages.content` is a Postgres `tsvector` + one index; the UI is a filtered list. **Best value-to-effort item in this document.**
2. **`screen.ts` is doing something important quietly.** Read it before touching the prompt path — but there is no visible moderation/refusal state in the UI beyond a generic error. ChatGPT shows a distinct "this request was declined" state.
3. **Errors are generic.** `finish: "stop" | "length" | "aborted" | "error"` is tracked, but the UI converges them. ChatGPT distinguishes: rate-limited / out-of-tokens / model-refused / network. We *have* the data (`exhaustedByModel`); we are not surfacing the distinctions the way the 402 plan-wall work intended.
4. **No token/turn counter in the composer.** `quota-hint` shows `% of alias used` but not "this conversation: 41k tokens, 3.2¢" — which we can compute exactly and ChatGPT cannot. An easy differentiator left on the table.
5. **Starter prompts are static.** ChatGPT personalises suggestions to usage. Low priority but visible.
6. **`danger` tab is the only destructive surface** — no per-conversation bulk cleanup, no retention policy UI even though `plans.features.history_days` exists (90/365) and is still unenforced.

---

## 4. Correctness and risk items found while auditing

Not feature gaps, but things to fix regardless. Each verified in code.

1. **`messages.meta` and `messages.reasoning` are jsonb/text with no read path in the billing ledger.** Fine, and the migration comment says money reads `cost_usd` + token columns only. Just do not let analytics start reading `meta` — it is telemetry, not truth.
2. **`CHAT_KEY_SECRET` is required but not documented — this is a live deploy bug, not a maybe.** `docker-compose.yml:135` hard-requires it (`${CHAT_KEY_SECRET:?set in .env}`), so `docker compose up` fails fast without it. It is **absent from `.env.example`**, while all 14 other required secrets are present there (checked one by one). A fresh deploy following the repo's own onboarding therefore hits a hard stop with no hint that `openssl rand -base64 32` is the fix. The rotation logic itself is sound — `lib/chat/key.ts:250` retires the credential on a gateway 401, and `sealed.ts:59-68` fails closed with an actionable message. **Fix: add `CHAT_KEY_SECRET=` to `.env.example` with the generation command as a comment.** One line; prevents every future deploy from stalling.
3. **`chat_presets` is keyed by `user_id`, not org** — deliberate and correct ("these are preferences, not tenant data"). Confirm no future per-org default gets bolted onto the same table, which would leak one member's temperature to a colleague.
4. **Two clock domains remain.** `0029_grandfathered_daily_window` suggests this was addressed; confirm the UI labels from `period.start/end` rather than a hardcoded "today" before calling it closed.
5. **Desktop app has no CSP of its own** (`desktop/next.config.mjs`). It is a Tauri webview loading a static export, so the portal's CSP does not apply. Worth a check given it renders model output.

---

## 5. Recommended sequence

Ordered by (user impact × confidence) ÷ effort. Items 1–3 are the tier that changes the category.

**Tier 1 — makes it a real product**
1. **File and image input.** Schema (`messages.parts jsonb`), multipart route, composer attach + drag-drop, vision pass-through for image aliases, and a per-message attachment list. Everything else in §2 assumes this exists.
2. **Conversation search.** Postgres FTS + sidebar filter + ⌘K. Days, not weeks; disproportionate payoff.
3. **Web search as a tool.** Needs tool-call plumbing in `gateway.ts` and a citations renderer. This is also the prerequisite for #4–5.

**Tier 2 — makes it competitive**
4. **Tool calling / MCP plumbing.** Unlocks search, connectors, and any future agent mode. Architectural: do it once, properly, in `gateway.ts`.
5. **Projects.** Reuses `conversations` with a `project_id`; adds project-level instructions and files.
6. **Message edit + branch.** Makes regenerate a *model* of the conversation rather than a special case.
7. **Memory.** Table + extraction job + a settings tab to view/delete. Trust-sensitive: ship the delete UI in the same release.

**Tier 3 — polish and differentiation**
8. **Per-conversation cost/token footer** (we have exact data; ChatGPT does not).
9. **Distinct error states** from `exhaustedByModel` / refusal / 402.
10. **Reasoning-effort selector** (a request param away).
11. **Share link + conversation export.**
12. **Global custom-instructions UI** on the existing `chat_presets` scope `''`.
13. **Temporary chat.**

**Explicitly deferred:** canvas, image generation, voice, deep research, agent mode. Each is a product in itself; none is on the critical path to "credible ChatGPT-class web app."

**Desktop:** keep it as the native chat client. Do not start a sandbox/approval architecture until Tier 1 is complete — it would compete for the same attention and ship neither.

---

## 6. The one-line answer

We are **at parity on the chat shell and ahead on cost attribution, quota honesty, and entitlement enforcement**, and **behind on the input and knowledge layer** — no files, no search, no tools, no memory, no projects. The shell is finished; the next quarter of value is entirely in §2 items 1–3 and the search fix in §3.
