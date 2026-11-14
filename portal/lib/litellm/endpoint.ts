/**
 * The portal's internal base URL for LiteLLM, exported once.
 *
 * client.ts reads LITELLM_INTERNAL_URL at module scope and keeps it
 * private. /api/health needs the same value to probe the gateway, and
 * duplicating the default here would create two places that can disagree —
 * the classic shape of "the health check passes but the app is broken".
 */

export const LITELLM_BASE = process.env.LITELLM_INTERNAL_URL ?? 'http://127.0.0.1:4000';

/**
 * Where the portal sends a CUSTOMER key.
 *
 * THE BUG THIS PREVENTS. `LITELLM_BASE` is the internal LiteLLM port, which
 * only understands `sk-` credentials — its key normalizer hashes values
 * beginning with `sk-` and nothing else. A `zn-` key posted straight there
 * authenticates as nothing and comes back 401, which reads like a bad key
 * rather than a wrong door. This is the same fact auth-edge exists for.
 *
 * So a route that forwards a customer's own key must go through the edge,
 * which rewrites the prefix and nothing else. The edge runs on host
 * networking (`network_mode: host`), which a bridge-network container
 * cannot reach at 127.0.0.1 — hence the public origin, which terminates at
 * Caddy and proxies to the edge. One extra loopback hop, and the credential
 * is interpreted exactly as a customer's SDK would be.
 *
 * `AGENT_API_ORIGIN` is set from `API_DOMAIN` in compose. The fallback is
 * the internal LiteLLM port ONLY so `next dev` on a laptop without a
 * running edge still starts — a request then fails loudly at the gateway
 * rather than at import time.
 */
export const CUSTOMER_KEY_BASE = (
  process.env.AGENT_API_ORIGIN ??
  (process.env.API_DOMAIN ? `https://${process.env.API_DOMAIN}` : LITELLM_BASE)
).replace(/\/+$/, '');
