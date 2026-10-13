"use client";

import * as React from "react";

/**
 * The one way the dashboard talks to the API.
 *
 * Before this, every view read a module of hardcoded objects
 * (`lib/dashboard/mock-data.ts`) and the endpoints had no caller at all.
 * Now that they are live, three things have to be true of every call, and
 * they were about to be re-implemented slightly differently in six files:
 *
 *   1. THE ERROR ENVELOPE IS UNWRAPPED ONCE. Every route answers
 *      `{error: {code, message}}`, and `message` is already written for a
 *      human — the backend deliberately replaces `internal`/`upstream`
 *      text. Re-deriving that from `res.status` throws away the only
 *      useful sentence the server produced.
 *   2. A REFRESH NEVER BLANKS THE SCREEN. Loading keeps the previous data
 *      and flips a `refreshing` flag; only the first load has nothing to
 *      show. The alternative — unmounting the table on every filter
 *      change — is the flash that makes an app feel cheap.
 *   3. THE UNMOUNTED FETCH IS DROPPED. Every dashboard request races the
 *      user: change a filter, click a tab, navigate away. An aborted
 *      request whose response lands last overwrites newer data with
 *      older. The sequence number is what prevents it.
 *
 * `useApi` is deliberately not a cache. There is one source of truth (the
 * database), and a stale dashboard that silently shows last week's spend is
 * worse than a fast one.
 */
export interface ApiError {
  code: string;
  message: string;
  /** True when retrying could plausibly succeed. */
  recoverable: boolean;
}

export interface UseApiResult<T> {
  data: T | null;
  error: ApiError | null;
  /** First load: nothing to show yet. */
  loading: boolean;
  /** Refetch with data already on screen. */
  refreshing: boolean;
  reload: () => void;
  /** Apply a server-confirmed change locally, then refetch. */
  set: React.Dispatch<React.SetStateAction<T | null>>;
}

/** Map an HTTP status onto whether a retry is worth offering. */
function recoverable(status: number): boolean {
  // 401 means the session ended — a retry cannot help, the user must sign
  // in again. 402/403/404/409 are decisions, not failures. Everything else
  // (5xx, a dropped connection, a timeout) is worth trying again.
  if (status === 0) return true;
  if (status >= 400 && status < 500 && status !== 408 && status !== 429) return false;
  return true;
}

/** Read the envelope, falling back to something a person can act on. */
export async function readError(res: Response): Promise<ApiError> {
  // Three statuses are overridden regardless of what the envelope says,
  // because from a browser they always mean the same thing and the server
  // copy is developer-grade:
  //
  //   401 → the session is gone. "Not signed in" describes the server's
  //         state, not the user's problem; they need to know to sign in
  //         again. Irrecoverable by retry.
  //   402 → no plan. Always the paywall, and always with a route out.
  //   403 → the role is wrong. Retrying cannot change a role.
  //
  // Everything else trusts the envelope, whose `message` is already
  // written for a customer (the API deliberately replaces internal and
  // upstream text).
  const override =
    res.status === 401
      ? { code: "unauthorized", message: "Your session has expired. Sign in again to continue.", recoverable: false }
      : res.status === 402
        ? { code: "payment_required", message: "Choose a plan to unlock this.", recoverable: false }
        : res.status === 403
          ? { code: "forbidden", message: "Your account does not have access to this.", recoverable: false }
          : null;

  if (override) return override;

  const fallback: ApiError = {
    code: `http_${res.status}`,
    message:
      res.status === 429
        ? "Too many requests. Wait a moment and try again."
        : "The server could not complete the request. Try again in a moment.",
    recoverable: recoverable(res.status),
  };

  try {
    const body = (await res.json()) as { error?: { code?: string; message?: string } };
    if (body?.error?.message) {
      return {
        code: body.error.code ?? fallback.code,
        message: body.error.message,
        recoverable: fallback.recoverable,
      };
    }
  } catch {
    // Not JSON — an edge error page, most likely. The fallback is right.
  }
  return fallback;
}

export function useApi<T>(path: string | null): UseApiResult<T> {
  const [data, setData] = React.useState<T | null>(null);
  const [error, setError] = React.useState<ApiError | null>(null);
  const [loading, setLoading] = React.useState(path !== null);
  const [refreshing, setRefreshing] = React.useState(false);

  // Monotonic request id: only the newest response may write state.
  const seq = React.useRef(0);
  const hasData = React.useRef(false);

  // A refetch has to change something the effect depends on — `path`
  // alone never changes, so without this `reload()` would be a no-op that
  // merely blanked the screen.
  const [nonce, setNonce] = React.useState(0);

  React.useEffect(() => {
    if (path === null) {
      setLoading(false);
      return;
    }

    const mine = ++seq.current;
    const controller = new AbortController();

    // Keep the old data on screen and mark it as updating, rather than
    // tearing it down — the difference between "refreshing" and "broken".
    if (hasData.current) setRefreshing(true);
    else setLoading(true);

    void (async () => {
      try {
        const res = await fetch(path, {
          signal: controller.signal,
          cache: "no-store",
        });
        if (mine !== seq.current) return; // superseded
        if (!res.ok) {
          setError(await readError(res));
          return;
        }
        setData((await res.json()) as T);
        setError(null);
        hasData.current = true;
      } catch (e) {
        // An abort is our own doing (a newer request, or unmount). It is
        // not a failure and must not paint an error.
        if (controller.signal.aborted || mine !== seq.current) return;
        setError({
          code: "network",
          message:
            "We couldn't reach the server. Check your connection and try again.",
          recoverable: true,
        });
      } finally {
        if (mine === seq.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    })();

    return () => controller.abort();
  }, [path, nonce]);

  /**
   * Refetch without clearing what is on screen.
   *
   * Deliberately does NOT null the data: a refresh that blanks a populated
   * table reads as "the page is broken" for the duration of the request.
   * `refreshing` is the honest signal, and the previous values stay
   * readable underneath it.
   */
  const reload = React.useCallback(() => setNonce((n) => n + 1), []);

  return { data, error, loading, refreshing, reload, set: setData };
}

/**
 * POST/DELETE/PATCH with the same error handling.
 *
 * Returns `null` on success and the `ApiError` on failure, so a caller
 * reads `if (err) { show(err.message) }` and cannot forget to check the
 * status. Mutations are deliberately NOT optimistic here: every one of
 * them moves money or removes access, and this codebase's rule is to
 * reconcile against the server rather than guess.
 */
export async function apiSend<T>(
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<{ data: T } | { error: ApiError }> {
  try {
    const res = await fetch(path, {
      method: init?.method ?? "POST",
      headers: init?.body === undefined ? undefined : { "Content-Type": "application/json" },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
      cache: "no-store",
    });
    if (!res.ok) return { error: await readError(res) };
    if (res.status === 204) return { data: undefined as T };
    return { data: (await res.json()) as T };
  } catch {
    return {
      error: {
        code: "network",
        message: "We couldn't reach the server. Nothing was changed.",
        recoverable: true,
      },
    };
  }
}