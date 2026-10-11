/**
 * Key service — production wiring.
 *
 * Route handlers and pages import from here and get the real Postgres
 * store and the real LiteLLM gateway bound in. Tests import
 * @/lib/keys/service directly and inject fakes, which is why this
 * indirection exists: importing a key mutation must not, as a side
 * effect of module resolution, open a database pool.
 */

import { gateway } from '@/lib/keys/gateway';
import { store } from '@/lib/keys/store';
import {
  createApiKey,
  listApiKeys,
  revokeApiKey,
} from '@/lib/keys/service';
import type {
  CreateKeyInput,
  CreateKeyResult,
  KeyDeps,
  ListKeysInput,
  RevokeKeyInput,
  RevokeKeyResult,
} from '@/lib/keys/types';

const deps: KeyDeps = { store, gateway };

export const createKey = (input: CreateKeyInput): Promise<CreateKeyResult> =>
  createApiKey(input, deps);

export const revokeKey = (input: RevokeKeyInput): Promise<RevokeKeyResult> =>
  revokeApiKey(input, deps);

export const listKeys = (
  input: ListKeysInput,
): ReturnType<typeof listApiKeys> => listApiKeys(input, deps);

export { KeyServiceError } from '@/lib/keys/types';
export type {
  CreateKeyInput,
  CreateKeyResult,
  KeyPlan,
  KeyRow,
  KeyView,
  ListKeysInput,
  RevokeKeyInput,
  RevokeKeyResult,
} from '@/lib/keys/types';
