/**
 * Prompt counting — how many prompts a request ADDS.
 *
 * The gateway's only customer-facing limit is the prompt count, so this
 * number decides when a customer is cut off. It has to count what the
 * customer EXPERIENCED: one prompt per message they sent.
 *
 * The trap it exists to catch: a chat client resends its whole conversation
 * on every turn, so the request body carries one user message per turn so
 * far. Counting the messages in the body charges a 3-turn session 1+2+3 = 6
 * prompts for 3 prompts sent — the customer's allowance would drain three
 * times too fast, and the app would cut them off while they still had
 * budget left.
 *
 * Pure, with no database and no network, so it can be tested directly.
 */

/**
 * How many user messages a request carried, or null when the request does
 * not expose them.
 *
 * LiteLLM shapes `messages` differently across versions — a list on some
 * rows, a dict on others, and absent on the `/spend/logs/ui` rows the
 * collector reads. `proxy_server_request` is the other source, and it
 * carries the raw request body.
 */
export function userMessagesOf(row: {
  messages?: unknown;
  proxy_server_request?: unknown;
}): number | null {
  const from = (value: unknown): number | null => {
    if (!Array.isArray(value)) return null;
    const count = value.filter((m) => (m as { role?: string })?.role === 'user').length;
    return count > 0 ? count : null;
  };

  const direct = from(row.messages);
  if (direct !== null) return direct;

  const request = row.proxy_server_request;
  if (request) {
    const psr = typeof request === 'string' ? JSON.parse(request) : request;
    return from((psr as { messages?: unknown } | null)?.messages);
  }

  return null;
}

/**
 * How many prompts a request adds.
 *
 * `seen` holds the user-message count each key carried on its previous
 * request. A key that has not been seen starts at 0, which makes its first
 * request count its whole history — the conservative direction: it can
 * over-count once, never under-count.
 *
 * The floor of 1 is deliberate: a request that carries no new user message
 * (a tool-result continuation) still consumed a model turn, and the model
 * was paid for it.
 */
export function countPrompts(
  input: { messages: number | null },
  key: string,
  seen: Map<string, number>,
): number {
  if (input.messages === null) return 1;
  const before = seen.get(key) ?? 0;
  const count = Math.max(1, input.messages - before);
  seen.set(key, Math.max(before, input.messages));
  return count;
}
