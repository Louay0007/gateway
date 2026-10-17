/**
 * Device-code flow — production wiring.
 *
 * Routes import from here and get the real Drizzle store, the real key
 * store/gateway, and the real clock. Tests import the service directly and
 * inject fakes, so no endpoint test opens Postgres or LiteLLM.
 */

import { gateway } from '@/lib/keys/gateway';
import { store as keyStore } from '@/lib/keys/store';
import { store } from './store';
import {
  approveDeviceCode as deviceApproveCode,
  pollDeviceToken as devicePollToken,
  requestDeviceCode as deviceRequestCode,
} from './service';
import type { DeviceDeps } from './types';

const deps: DeviceDeps = {
  store,
  keys: {
    orgWithTeam: keyStore.orgWithTeam,
    memberLiteLLMUserId: keyStore.memberLiteLLMUserId,
    planForOrg: keyStore.planForOrg,
    countActiveKeys: keyStore.countActiveKeys,
    insertKey: keyStore.insertKey,
    markRevoked: keyStore.markRevoked,
    listActiveKeys: keyStore.listActiveKeys,
    appendAudit: keyStore.appendAudit,
  },
  gateway: { generate: gateway.generate, revoke: gateway.revoke },
  now: () => new Date(),
};

export async function requestDeviceCode(input: { now?: Date } = {}) {
  return deviceRequestCode(deps, input);
}

export async function approveDeviceCode(input: {
  userCode: string;
  actorUserId: string;
  organizationId: string;
  role: import('@/db/schema').OrgRole;
}) {
  return deviceApproveCode(deps, input);
}

export async function pollDeviceToken(input: { deviceCode: string; now?: Date }) {
  return devicePollToken(deps, input);
}

export { store as deviceStore, type DeviceDeps };
export { DEVICE_CODE_TTL_SECONDS, DEFAULT_INTERVAL_SECONDS } from './policy';
export type { DeviceTokenGranted, DeviceTokenOutcome } from './types';
