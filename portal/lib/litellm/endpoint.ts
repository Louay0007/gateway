/**
 * The portal's internal base URL for LiteLLM, exported once.
 *
 * client.ts reads LITELLM_INTERNAL_URL at module scope and keeps it
 * private. /api/health needs the same value to probe the gateway, and
 * duplicating the default here would create two places that can disagree —
 * the classic shape of "the health check passes but the app is broken".
 */

export const LITELLM_BASE = process.env.LITELLM_INTERNAL_URL ?? 'http://127.0.0.1:4000';
