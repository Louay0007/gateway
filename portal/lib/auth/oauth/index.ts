/**
 * The enabled-provider registry. ONE place decides which social buttons
 * exist, so the UI, the start route and the callback cannot disagree.
 *
 * A provider is enabled only when ALL of its configuration is present. This
 * matters more than it looks: a button rendered for a half-configured
 * provider redirects the user to a provider page that then bounces back
 * with an opaque error, after they have already clicked. Hiding it is the
 * honest answer, and §7 of the plan requires it.
 *
 * Read per call, not at module load: tests override `env` explicitly, and a
 * module-load snapshot would make every test share the first reading.
 */
import { createAppleAdapter, readAppleCredentials } from './apple';
import { githubAdapter } from './github';
import { googleAdapter } from './google';
import type { OAuthAdapter, ProviderId } from './types';

export * from './types';
export { googleAdapter } from './google';
export { githubAdapter } from './github';
export { createAppleAdapter, mintAppleClientSecret, readAppleCredentials } from './apple';

export interface ProviderConfig {
  adapter: OAuthAdapter;
  clientId: string;
  clientSecret: string;
}

const ORDER: ProviderId[] = ['google', 'github', 'apple'];

export function isProviderId(value: string): value is ProviderId {
  return (ORDER as string[]).includes(value);
}

/**
 * Resolve one provider against the environment, or NULL when it is not
 * fully configured.
 *
 * Apple's "secret" is minted at exchange time (it expires), so the value
 * returned here is the Services ID and the secret is produced by
 * `clientSecretFor` below.
 */
export function providerConfig(
  id: ProviderId,
  env: Record<string, string | undefined> = process.env,
): ProviderConfig | null {
  if (id === 'google') {
    const clientId = env.GOOGLE_CLIENT_ID?.trim();
    const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim();
    if (!clientId || !clientSecret) return null;
    return { adapter: googleAdapter, clientId, clientSecret };
  }

  if (id === 'github') {
    const clientId = env.GITHUB_CLIENT_ID?.trim();
    const clientSecret = env.GITHUB_CLIENT_SECRET?.trim();
    if (!clientId || !clientSecret) return null;
    return { adapter: githubAdapter, clientId, clientSecret };
  }

  const creds = readAppleCredentials(env);
  if (!creds) return null;
  // The credential a caller passes as `clientSecret` for Apple is unused by
  // the exchange: see `clientSecretFor` — Apple's secret must be minted per
  // request, so it is deliberately NOT read from env here.
  return { adapter: createAppleAdapter(creds), clientId: creds.servicesId, clientSecret: '' };
}

/**
 * The secret to send on the token exchange.
 *
 * Google and GitHub: the static env value. Apple: a JWT minted now. Every
 * caller goes through this, so no path can accidentally send Apple's empty
 * string and get `invalid_client`.
 */
export async function clientSecretFor(id: ProviderId, config: ProviderConfig): Promise<string> {
  if (id !== 'apple') return config.clientSecret;
  const creds = readAppleCredentials();
  if (!creds) {
    throw new Error('apple: configuration disappeared between start and exchange');
  }
  const { mintAppleClientSecret } = await import('./apple');
  return mintAppleClientSecret(creds);
}

/** Every provider that is fully configured, in display order. */
export function enabledProviders(
  env: Record<string, string | undefined> = process.env,
): ProviderId[] {
  return ORDER.filter((id) => providerConfig(id, env) !== null);
}

/** Display metadata for the sign-in UI. Never includes a secret. */
export function enabledProviderLabels(
  env: Record<string, string | undefined> = process.env,
): Array<{ id: ProviderId; name: string }> {
  return enabledProviders(env).map((id) => {
    const cfg = providerConfig(id, env);
    return { id, name: cfg ? cfg.adapter.name : id };
  });
}
