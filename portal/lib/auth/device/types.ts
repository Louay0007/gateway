/**
 * Device-code service types — the seams between policy, the store, and the
 * key-issuance path. Importable without booting Postgres or the gateway.
 */

import type { DeviceStore } from './store';
import type { KeyGateway } from '@/lib/keys/types';
import type { KeyPlan, KeyRow, OrgForKeys } from '@/lib/keys/types';

/**
 * Key-store surface the device service needs. The production wiring binds
 * the real Drizzle store; tests inject fakes.
 */
export interface DeviceKeyStore {
  orgWithTeam(organizationId: string): Promise<OrgForKeys | null>;
  memberLiteLLMUserId(
    organizationId: string,
    userId: string,
  ): Promise<string | null>;
  planForOrg(organizationId: string): Promise<KeyPlan | null>;
  countActiveKeys(organizationId: string): Promise<number>;
  insertKey(row: Omit<KeyRow, 'id' | 'revokedAt' | 'lastUsedAt'>): Promise<{ id: string }>;
  markRevoked(keyId: string, at: Date): Promise<void>;
  listActiveKeys(organizationId: string, limit: number): Promise<KeyRow[]>;
  appendAudit(entry: {
    actorId: string;
    organizationId: string;
    action: string;
    targetId: string;
    after: Record<string, unknown>;
  }): Promise<void>;
}

export interface DeviceDeps {
  /** In production, the real Drizzle store; in tests, a fake. */
  store: DeviceStore;
  keys: DeviceKeyStore;
  gateway: Pick<KeyGateway, 'generate' | 'revoke'>;
  now(): Date;
}

/** The one-time key grant the token poll returns to the desktop app. */
export interface DeviceTokenGranted {
  kind: 'granted';
  /** `zn-…` plaintext — returned once, then nulled server-side. */
  token: string;
  models: string[];
  user: { id: string; email: string; name: string | null };
  organization: { id: string; slug: string; name: string };
}

export interface DeviceTokenPending {
  kind: 'pending';
  /** Seconds the app must wait before polling again. */
  intervalSeconds: number;
  /** Seconds until the code expires (0 = already expired). */
  expiresInSeconds: number;
}

export type DeviceTokenOutcome = DeviceTokenPending | DeviceTokenGranted;

export class DeviceServiceError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'DeviceServiceError';
  }
}
