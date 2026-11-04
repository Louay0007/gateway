/**
 * The portal's client for the Rust engine (`engine/`), exported once.
 *
 * WHY THIS DEGRADES INSTEAD OF THROWING. The engine does two things and
 * neither may become a single point of failure for chat:
 *
 *   extract → an upload fails, and the user is told why. Chat keeps working
 *             with text-only turns.
 *   search  → the sidebar search returns nothing and says it is unavailable.
 *             A user must never see "search is broken" as a chat outage.
 *
 * So every function here returns a discriminated result rather than
 * throwing into the route. The distinction matters: a 500 from the engine
 * is OUR problem and reads as "try again"; a 415 is the USER's file and
 * reads as "that format is not supported". Collapsing both into `null` is
 * how an upload silently disappears.
 *
 * THE TOKEN NEVER LEAVES THE SERVER. `ENGINE_TOKEN` is read here, on the
 * server, and is never part of a response body — the browser never talks to
 * the engine directly. That is what makes the engine's bearer-only auth
 * safe with no user context inside it.
 */

/** Matches DEFAULT_PORT in engine/src/server.rs. */
const DEFAULT_ENGINE_PORT = 8099;

/**
 * Resolved at call time, not module load, so a test can set the environment
 * after import — and so a boot-time read cannot cache an unset variable for
 * the life of the process.
 */
export function engineBase(): string {
  const explicit = process.env.ENGINE_URL;
  if (explicit) return explicit.replace(/\/$/, '');
  // Compose service name; the container is not on the host's loopback.
  if (process.env.NODE_ENV === 'production') return 'http://engine:8099';
  return `http://127.0.0.1:${DEFAULT_ENGINE_PORT}`;
}

function engineToken(): string | null {
  const token = process.env.ENGINE_TOKEN;
  return token && token.trim() ? token : null;
}

/** True when the engine is configured at all, for UI that hides itself. */
export function engineConfigured(): boolean {
  return engineToken() !== null;
}

/** The engine's typed error codes, mirrored from engine/src/api.rs. */
export type EngineErrorCode =
  | 'unsupported_type'
  | 'encrypted'
  | 'malformed'
  | 'too_large'
  | 'empty'
  | 'no_file'
  | 'unauthorized'
  | 'unavailable'
  | 'timeout';

export type EngineResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: EngineErrorCode; message: string };

export interface ExtractedDocument {
  kind: 'text' | 'pdf' | 'docx' | 'sheet' | 'image';
  text: string;
  truncated: boolean;
  pages: number | null;
  chars: number;
  filename: string | null;
}

export interface SearchHit {
  conversation_id: string;
  title: string;
  snippet: string;
  role: string;
  score: number;
  created_at: string | null;
}

export interface SearchResults {
  hits: SearchHit[];
  total: number;
}

/** Default ceiling; mirrors ENGINE_MAX_UPLOAD_BYTES's compose default. */
const DEFAULT_MAX_UPLOAD = 25 * 1024 * 1024;
/** Extraction is CPU-bound on the far side; bounded well under the 60s
 *  engine timeout so the portal reports a clean failure first. */
const EXTRACT_TIMEOUT_MS = 55_000;
const SEARCH_TIMEOUT_MS = 5_000;

/**
 * The size ceiling, shared with the route so the refusal and the error
 * message cannot disagree about what the limit is.
 */
export function maxUploadBytes(): number {
  const raw = process.env.ENGINE_MAX_UPLOAD_BYTES;
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_UPLOAD;
}

/**
 * Map a fetch failure onto a code the UI can act on.
 * `AbortError` is our own timeout; anything else is genuinely unreachable.
 */
function transportError(err: unknown): { code: EngineErrorCode; message: string } {
  const name = (err as { name?: string })?.name;
  if (name === 'AbortError' || name === 'TimeoutError') {
    return { code: 'timeout', message: 'The document service took too long. Try a smaller file.' };
  }
  return { code: 'unavailable', message: 'The document service is unavailable.' };
}

/**
 * POST one file to the engine and return its extracted text.
 *
 * `filename` matters even though the engine sniffs magic bytes: docx and
 * xlsx share the same zip signature, so the extension is the only signal
 * that tells them apart.
 */
export async function extractDocument(
  bytes: Uint8Array,
  filename: string,
  mimeType = 'application/octet-stream',
): Promise<EngineResult<ExtractedDocument>> {
  const token = engineToken();
  if (!token) {
    // Not an outage: an operator chose not to run the engine. Say so
    // plainly rather than blaming the network.
    return {
      ok: false,
      code: 'unavailable',
      message: 'File attachments are not enabled on this deployment.',
    };
  }

  const limit = maxUploadBytes();
  if (bytes.byteLength === 0) {
    return { ok: false, code: 'empty', message: 'That file is empty.' };
  }
  if (bytes.byteLength > limit) {
    return {
      ok: false,
      code: 'too_large',
      // Stated in MB because that is the unit a user thinks in, and
      // "26214400 bytes" is not a sentence.
      message: `That file is ${mb(bytes.byteLength)}MB; the limit is ${mb(limit)}MB.`,
    };
  }

  const form = new FormData();
  // The bytes are copied into a fresh ArrayBuffer rather than passed
  // through as a view. TypeScript's `Uint8Array<ArrayBufferLike>` admits a
  // SharedArrayBuffer-backed view, which is not a valid `BlobPart`; copying
  // is also what we want, since a caller could otherwise reuse (and mutate)
  // the buffer while the request is in flight.
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  form.append('file', new Blob([copy.buffer], { type: mimeType }), filename);

  try {
    const res = await fetch(`${engineBase()}/extract`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: form,
      signal: AbortSignal.timeout(EXTRACT_TIMEOUT_MS),
    });

    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as
        | { error?: string; message?: string }
        | null;
      const code = (body?.error ?? 'unavailable') as EngineErrorCode;
      return {
        ok: false,
        code,
        message: body?.message ?? `The document service returned ${res.status}.`,
      };
    }

    const value = (await res.json()) as ExtractedDocument;
    return { ok: true, value };
  } catch (err) {
    return { ok: false, ...transportError(err) };
  }
}

function mb(bytes: number): string {
  // One decimal is enough and avoids "0.0MB" reading as zero.
  return (bytes / (1024 * 1024)).toFixed(1);
}

/**
 * Ranked conversation search, scoped to one owner.
 *
 * `userId` is required by the type, not optional: the engine treats a
 * missing tenant as a 400 precisely so a forgotten argument cannot become
 * a cross-tenant search. Keeping it required here means the compiler
 * enforces that at every call site.
 */
export async function searchConversations(input: {
  query: string;
  orgId: string;
  userId: string;
  limit?: number;
}): Promise<EngineResult<SearchResults>> {
  const token = engineToken();
  if (!token) {
    return { ok: false, code: 'unavailable', message: 'Search is not enabled on this deployment.' };
  }
  if (!input.query.trim()) {
    // An empty query is a valid empty result, not an error: the sidebar
    // calls this on every keystroke, including the delete.
    return { ok: true, value: { hits: [], total: 0 } };
  }

  try {
    const res = await fetch(`${engineBase()}/search`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        query: input.query,
        org_id: input.orgId,
        user_id: input.userId,
        limit: input.limit ?? 20,
      }),
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    });

    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string; message?: string } | null;
      return {
        ok: false,
        code: (body?.error ?? 'unavailable') as EngineErrorCode,
        message: body?.message ?? `Search returned ${res.status}.`,
      };
    }
    return { ok: true, value: (await res.json()) as SearchResults };
  } catch (err) {
    return { ok: false, ...transportError(err) };
  }
}

/**
 * Push one conversation into the index.
 *
 * Best-effort by design: the index is DERIVED data (see the engine's
 * search.rs header). A failed index write must never fail the turn that
 * produced it — the message is already committed in Postgres, which owns
 * the truth. It is fire-and-forget so a slow index never adds latency to a
 * chat response.
 */
export async function indexConversation(input: {
  conversationId: string;
  orgId: string;
  userId: string;
  title: string;
  body: string;
  createdAt: string;
}): Promise<boolean> {
  const token = engineToken();
  if (!token) return false;

  try {
    const res = await fetch(`${engineBase()}/index`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        conversation_id: input.conversationId,
        org_id: input.orgId,
        user_id: input.userId,
        title: input.title,
        body: input.body,
        created_at: input.createdAt,
      }),
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    // Swallowed on purpose: see the doc comment.
    return false;
  }
}

/** Remove a conversation from the index. Best-effort, same reasoning. */
export async function deleteFromIndex(conversationId: string): Promise<boolean> {
  const token = engineToken();
  if (!token) return false;
  try {
    const res = await fetch(`${engineBase()}/index/${encodeURIComponent(conversationId)}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Liveness, for the admin health view. Does not require the engine to be
 *  configured — an unconfigured engine is reported as such, not as down. */
export async function engineHealth(): Promise<
  { configured: false } | { configured: true; ok: boolean; version?: string; maxUploadBytes?: number }
> {
  if (!engineConfigured()) return { configured: false };
  try {
    const res = await fetch(`${engineBase()}/health`, {
      signal: AbortSignal.timeout(2_000),
    });
    if (!res.ok) return { configured: true, ok: false };
    const body = (await res.json()) as { version?: string; maxUploadBytes?: number };
    return { configured: true, ok: true, version: body.version, maxUploadBytes: body.maxUploadBytes };
  } catch {
    return { configured: true, ok: false };
  }
}
