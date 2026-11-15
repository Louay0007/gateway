/**
 * GET /api/share/[token]/stream — follow a live shared conversation.
 *
 * NO SESSION. This is the public surface, so every gate is re-derived from
 * the token on every poll, by calling `readSharedPage` — which calls
 * `resolveShare`, the single place revoked/expired/temporary/archived live.
 * A second query here would be a second set of gates, and the one that
 * drifted would be the silent leak.
 *
 * WHY POLLING AND NOT LISTEN/NOTIFY. The pool is 10 connections on a 2-vCPU
 * box and is shared with the job runner. A dedicated `LISTEN` connection per
 * viewer would exhaust it at ten viewers. A 2-second SELECT is one indexed
 * range scan on (conversation_id, created_at, id) and returns nothing at
 * all when nothing changed — cheap, bounded, and it holds no connection
 * between ticks.
 *
 * WHY 2 SECONDS. It is the latency a reader can tolerate while watching
 * someone type, and it is slow enough that twenty viewers cost ten queries
 * per second. A token-level stream would mean opening a second SSE into the
 * gateway per turn, doubling open streams, and would additionally leak
 * reasoning and cost — neither of which is published.
 *
 * WHAT IT SENDS. Whole finished messages, never partial ones. `content <> ''`
 * and `status IN ('complete','aborted')` in the query mean a message appears
 * exactly once, when it is worth reading, and the viewer never sees a
 * half-written answer that later changes under them.
 */
import { readSharedPage } from '@/lib/chat/share-read';
import { log } from '@/lib/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** How often the share is re-resolved and polled. */
const TICK_MS = 2_000;

/**
 * Hard cap on a stream's lifetime.
 *
 * A connection that never ends is a connection nobody re-authenticates. Ten
 * minutes is longer than anyone watches a single reply, and the client
 * reconnects automatically — which also picks up a token that was revoked
 * while the old stream was still open.
 */
const MAX_STREAM_MS = 10 * 60 * 1000;

/** Heartbeat, so a proxy does not decide an idle stream is dead. */
const PING_MS = 25_000;

export async function GET(
  request: Request,
  context: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await context.params;

  // The first read happens BEFORE the stream opens, so an invalid or dead
  // token answers a plain 404 rather than an event stream that immediately
  // says "gone". A client that gets SSE headers cannot render an error page.
  const first = await readSharedPage(token, null).catch(() => null);
  if (!first) {
    return Response.json(
      { error: { message: 'That link is not available.' } },
      { status: 404, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const encoder = new TextEncoder();
  const frame = (payload: unknown) => encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      let cursor = first.cursor;
      let lastPing = Date.now();
      const startedAt = Date.now();

      const send = (payload: unknown) => {
        if (closed) return false;
        try {
          controller.enqueue(frame(payload));
          return true;
        } catch {
          // The consumer went away between the check and the enqueue.
          closed = true;
          return false;
        }
      };

      const stop = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      // The opening frame carries the whole conversation, so the page
      // renders immediately instead of waiting for the first tick.
      send({
        type: 'snapshot',
        title: first.title,
        isLive: first.isLive,
        messages: first.messages,
      });

      // A share that is not live has no future to stream. Close after the
      // snapshot rather than polling forever for messages that can never
      // appear — the page already has everything the link permits.
      if (!first.isLive) {
        send({ type: 'end', reason: 'snapshot' });
        stop();
        return;
      }

      let timer: ReturnType<typeof setInterval> | null = null;

      const finish = (reason: string) => {
        if (timer) clearInterval(timer);
        timer = null;
        send({ type: 'end', reason });
        stop();
      };

      // The client closing the tab. Nothing to clean up beyond the timer,
      // but leaving it running would keep polling a token nobody is reading.
      request.signal.addEventListener('abort', () => {
        if (timer) clearInterval(timer);
        timer = null;
        closed = true;
      }, { once: true });

      timer = setInterval(() => {
        void (async () => {
          if (closed) {
            if (timer) clearInterval(timer);
            return;
          }

          if (Date.now() - startedAt > MAX_STREAM_MS) {
            // The client reconnects; a fresh stream re-checks the token.
            finish('reconnect');
            return;
          }

          try {
            const page = await readSharedPage(token, cursor);
            if (closed) return;

            if (!page) {
              // Revoked, expired, or the conversation was made temporary or
              // archived while the viewer was watching. Tell them, and stop.
              log.info('share stream ended: link no longer resolves');
              finish('gone');
              return;
            }

            if (page.messages.length > 0) {
              cursor = page.cursor;
              send({ type: 'messages', messages: page.messages });
            }

            if (Date.now() - lastPing > PING_MS) {
              lastPing = Date.now();
              // A comment line is valid SSE and invisible to EventSource.
              if (!closed) {
                try {
                  controller.enqueue(encoder.encode(': ping\n\n'));
                } catch {
                  closed = true;
                }
              }
            }
          } catch (e) {
            log.error('share stream tick failed', {
              error: e instanceof Error ? e.message : String(e),
            });
            // A transient database error must not kill the viewer's stream;
            // the next tick retries. `gone` is reserved for a definite
            // revocation, which `readSharedPage` returning null signals.
          }
        })();
      }, TICK_MS);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      // A cached stream would replay one conversation to another viewer.
      'Cache-Control': 'no-store, no-transform',
      Connection: 'keep-alive',
      // Tells every buffering proxy (Caddy included) to pass bytes through.
      'X-Accel-Buffering': 'no',
      // Belt: an intermediary must not transform the body.
      'Content-Encoding': 'identity',
    },
  });
}
