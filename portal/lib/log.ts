/**
 * Structured logging.
 *
 * Two rules, both non-negotiable (MASTER_PROMPT §4):
 *   - Never log key material, prompts, or Stripe secrets.
 *   - Never log `cost_upstream_usd` alongside `cost_customer_usd` to any
 *     non-staff sink; the gap is margin.
 *
 * This is a thin wrapper over console so log shape stays consistent
 * between Next.js server output and the job runner. Errors go to stderr
 * so `docker compose logs` and any log shipper can separate them.
 */

type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const MIN_LEVEL: Level = (process.env.LOG_LEVEL as Level) ?? 'info';

/**
 * Keys that must never reach a log line, at any nesting depth.
 * Redacted rather than thrown, so a stray log call cannot crash a request
 * and still cannot leak.
 */
const FORBIDDEN = new Set([
  'key', 'token', 'password', 'passwordhash', 'authorization', 'apikey',
  'api_key', 'litellm_master_key', 'stripe_secret_key', 'sessiontoken',
  'session_token', 'cookie', 'set-cookie', 'upstream_api_key', 'salt_key',
  'byok_ciphertext', 'plaintext',
]);

function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[depth]';
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  if (value instanceof Error) return { name: value.name, message: value.message };

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = FORBIDDEN.has(k.toLowerCase()) ? '[redacted]' : redact(v, depth + 1);
  }
  return out;
}

function emit(level: Level, message: string, context?: Record<string, unknown>): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[MIN_LEVEL]) return;

  const line = {
    ts: new Date().toISOString(),
    level,
    msg: message,
    ...(context ? (redact(context) as Record<string, unknown>) : {}),
  };
  const text = JSON.stringify(line);
  if (level === 'error' || level === 'warn') process.stderr.write(text + '\n');
  else process.stdout.write(text + '\n');
}

export const log = {
  debug: (m: string, c?: Record<string, unknown>) => emit('debug', m, c),
  info:  (m: string, c?: Record<string, unknown>) => emit('info', m, c),
  warn:  (m: string, c?: Record<string, unknown>) => emit('warn', m, c),
  error: (m: string, c?: Record<string, unknown>) => emit('error', m, c),
};