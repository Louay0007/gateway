/**
 * Audit log writer — one shape for every actor.
 *
 * PLATFORM.md §10: a money-moving product needs "who changed what".
 * `audit_log` already exists; this is the single writer so entries stay
 * consistent (actor typing, JSON before/after, no secrets) no matter
 * which surface caused the change.
 *
 * Rules:
 *   - Append only. Nothing updates or deletes an audit row.
 *   - Never write key material, tokens, or ciphertext. Ids, prefixes,
 *     and plan codes are the vocabulary.
 *   - System/provider actions use actorType 'system' / 'provider'.
 */

import { db } from '@/db';
import { auditLog, auditActor } from '@/db/schema';

export interface AuditEntry {
  actorType: (typeof auditActor.enumValues)[number];
  /** User id, 'system', or a provider event id. */
  actorId: string | null;
  organizationId: string | null;
  /** Dotted action name, e.g. 'subscription.activated'. */
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  before?: unknown;
  after?: unknown;
}

export async function appendAudit(entry: AuditEntry): Promise<void> {
  await db.insert(auditLog).values({
    actorType: entry.actorType,
    actorId: entry.actorId,
    organizationId: entry.organizationId,
    action: entry.action,
    targetType: entry.targetType ?? null,
    targetId: entry.targetId ?? null,
    before: (entry.before ?? null) as Record<string, unknown> | null,
    after: (entry.after ?? null) as Record<string, unknown> | null,
  });
}
