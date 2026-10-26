/**
 * Drizzle schema — the TypeScript view of portal/db/migrations/0001_init.sql
 * plus the Auth.js tables from 0002_auth_local.sql.
 *
 * 0001 is hand-written and authoritative; this file never regenerates it.
 * New changes go through drizzle-kit generate → 0003_*.sql (MASTER_PROMPT §3).
 *
 * NOTE ON STYLE: drizzle-orm 0.38 types the table extra-config callback as
 * `Record<string, ...>` (an object), NOT the array form introduced in later
 * releases. Extra config keys are labels; only the builder inside matters.
 */

import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  bigint,
  boolean,
  numeric,
  date,
  timestamp,
  jsonb,
  inet,
  primaryKey,
  uniqueIndex,
  index,
  unique,
  serial,
  bigserial,
  customType,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/**
 * BYTEA column. drizzle-orm/pg-core does not export a `bytea` builder in
 * 0.38, so it is declared here. Used only for `byok_ciphertext`, which is
 * envelope-encrypted customer key material (Model B) — never returned by
 * the API, never logged.
 */
const bytea = customType<{ data: Buffer }>({
  dataType() {
    return 'bytea';
  },
});

// ───────────────────────────────────────────────────────────────────────
//  Enums
// ───────────────────────────────────────────────────────────────────────
export const orgStatus     = pgEnum('org_status',    ['active', 'suspended', 'deleted']);
export const orgRole       = pgEnum('org_role',      ['owner', 'admin', 'developer', 'billing', 'viewer']);
export const planInterval  = pgEnum('plan_interval', ['month', 'year']);
export const subStatus     = pgEnum('sub_status',    ['trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused', 'incomplete']);
export const syncStatus    = pgEnum('sync_status',   ['pending', 'synced', 'failed']);
export const auditActor    = pgEnum('audit_actor',   ['user', 'system', 'provider']);

// ───────────────────────────────────────────────────────────────────────
//  users — domain mirror. Authoritative for ALL product logic.
//  PLATFORM.md §2.1: never read profile data from the auth provider at
//  request time; authorization reads this table, not auth_users.
// ───────────────────────────────────────────────────────────────────────
export const users = pgTable('users', {
  id:           uuid('id').primaryKey().defaultRandom(),
  authProvider: text('auth_provider').notNull(),
  authId:       text('auth_id').notNull(),
  email:        text('email').notNull(),
  name:         text('name'),
  /**
   * Profile picture as a data URL (`data:image/{png,jpeg,webp};base64,…`),
   * NULL while unset. Stored in-row rather than on disk or in an object
   * store so a `docker compose up --build` cannot wipe it and no new
   * infrastructure is needed — the size discipline (magic bytes, 256 KiB
   * decoded cap) lives in lib/account/service.ts, which is the only
   * writer. Migration 0012.
   */
  image:        text('image'),
  /**
   * Stamped on every credential change. Copied into the JWT at sign-in and
   * compared on every authenticated request (lib/auth/authorize.ts), which
   * is how a password change or reset invalidates sessions that were
   * already issued — Auth.js v5 cannot revoke a JWT, so freshness is the
   * only lever. See migration 0006.
   */
  passwordChangedAt: timestamp('password_changed_at', { withTimezone: true }).notNull().defaultNow(),
  /**
   * When the address was proven, or NULL while unverified. Set by
   * lib/auth/verify-email.ts when the emailed link is opened. The checkout
   * and key-creation gates read this; NULL means "cannot pay yet".
   * Grandfathered rows are stamped by migration 0008.
   */
  emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
  createdAt:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  providerAuthIdKey: unique('users_provider_auth_id_key').on(t.authProvider, t.authId),
  emailKey:          uniqueIndex('users_email_key').on(t.email),
}));

// ───────────────────────────────────────────────────────────────────────
//  organizations — the billing entity (not the user)
// ───────────────────────────────────────────────────────────────────────
export const organizations = pgTable('organizations', {
  id:             uuid('id').primaryKey().defaultRandom(),
  slug:           text('slug').notNull().unique(),
  name:           text('name').notNull(),
  status:         orgStatus('status').notNull().default('active'),
  // 'platform' = we hold the upstream key (Model A) · 'byok' = customer
  // holds theirs (Model B). See PLATFORM.md §0.
  keyOwnership:   text('key_ownership').notNull().default('platform'),
  byokProvider:   text('byok_provider'),
  byokCiphertext: bytea('byok_ciphertext'),
  byokLast4:      text('byok_last4'),
  litellmTeamId:  text('litellm_team_id').unique(),
  createdAt:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt:      timestamp('deleted_at', { withTimezone: true }),
}, (t) => ({
  statusIdx:  index('organizations_status_idx').on(t.status),
  createdIdx: index('organizations_created_idx').on(t.createdAt),
}));

export const organizationMembers = pgTable('organization_members', {
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  userId:         uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role:           orgRole('role').notNull().default('developer'),
  litellmUserId:  text('litellm_user_id'),
  createdAt:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  pk:      primaryKey({ columns: [t.organizationId, t.userId] }),
  userIdx: index('organization_members_user_idx').on(t.userId),
}));

/**
 * Staff are never org members: separate table, no bridge. PLATFORM.md §8.5.
 *
 * `createdBy` / `revokedAt` (migration 0015) exist so a staff account can
 * be traced and revoked. Until `requireStaff` reads `revokedAt` they are
 * recorded but not enforced — the revocation is a row that survives, not a
 * DELETE that erases the evidence of who had access.
 */
export const staffUsers = pgTable('staff_users', {
  id:        uuid('id').primaryKey().defaultRandom(),
  email:     text('email').notNull().unique(),
  name:      text('name'),
  role:      text('role').notNull().default('support'),
  /** staff_users.id of the operator who granted this account. NULL = seeded. */
  createdBy: text('created_by'),
  /** Non-NULL revokes access. Revocation is never a delete. */
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  activeIdx: index('staff_users_active_idx').on(t.revokedAt, t.createdAt),
}));

// ───────────────────────────────────────────────────────────────────────
//  plans — the catalog. These rows are the ONLY entitlement truth.
// ───────────────────────────────────────────────────────────────────────
export const plans = pgTable('plans', {
  id:                    uuid('id').primaryKey().defaultRandom(),
  code:                  text('code').notNull().unique(),
  name:                  text('name').notNull(),
  description:           text('description'),
  public:                boolean('public').notNull().default(true),
  sortOrder:             integer('sort_order').notNull().default(0),
  providerPriceId:      text('provider_price_id').unique(),
  priceCents:            integer('price_cents').notNull().default(0),
  interval:              planInterval('interval').notNull().default('month'),
  includedSpendCents:    integer('included_spend_cents').notNull().default(0),
  overageMarkupBps:      integer('overage_markup_bps').notNull().default(3000),
  hardCapCents:          integer('hard_cap_cents'),
  rpmLimit:              integer('rpm_limit'),
  tpmLimit:              integer('tpm_limit'),
  maxConcurrentRequests: integer('max_concurrent_requests'),
  maxKeys:               integer('max_keys').notNull().default(1),
  maxSeats:              integer('max_seats').notNull().default(1),
  rateMultiplierBps:     integer('rate_multiplier_bps').notNull().default(10000),
  models:                text('models').array().notNull().default([]),
  trialDays:             integer('trial_days').notNull().default(0),
  features:              jsonb('features').notNull().default({}),
  /** Per-alias blended-token budgets: {fast: 80000000}. The only quota. 0023. */
  tokenLimits:           jsonb('token_limits').notNull().default({}),
  createdAt:             timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:             timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const subscriptions = pgTable('subscriptions', {
  id:                   uuid('id').primaryKey().defaultRandom(),
  organizationId:       uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  planId:               uuid('plan_id').notNull().references(() => plans.id),
  status:               subStatus('status').notNull(),
  providerCustomerId:   text('provider_customer_id'),
  providerSubscriptionId: text('provider_subscription_id').unique(),
  currentPeriodStart:   timestamp('current_period_start', { withTimezone: true }),
  currentPeriodEnd:     timestamp('current_period_end', { withTimezone: true }),
  cancelAtPeriodEnd:    boolean('cancel_at_period_end').notNull().default(false),
  trialEnd:             timestamp('trial_end', { withTimezone: true }),
  lastProviderEventId:  text('last_provider_event_id'),
  lastProviderEventAt:  timestamp('last_provider_event_at', { withTimezone: true }),
  createdAt:            timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:            timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orgIdx:    index('subscriptions_org_idx').on(t.organizationId),
  statusIdx: index('subscriptions_status_idx').on(t.status),
}));

// Derived cache. Only syncOrganizationEntitlements() ever writes this.
export const entitlements = pgTable('entitlements', {
  organizationId: uuid('organization_id').primaryKey().references(() => organizations.id, { onDelete: 'cascade' }),
  planId:         uuid('plan_id').notNull().references(() => plans.id),
  planCode:       text('plan_code').notNull(),
  effective:      jsonb('effective').notNull(),
  status:         syncStatus('status').notNull().default('pending'),
  syncedAt:       timestamp('synced_at', { withTimezone: true }),
  lastError:      text('last_error'),
  attempts:       integer('attempts').notNull().default(0),
  nextRetryAt:    timestamp('next_retry_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  failedIdx: index('entitlements_failed_idx').on(t.nextRetryAt),
}));

// We store the hash. The plaintext is returned exactly once, at creation.
export const apiKeys = pgTable('api_keys', {
  id:             uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  createdBy:      uuid('created_by').notNull().references(() => users.id),
  name:           text('name').notNull(),
  keyPrefix:      text('key_prefix').notNull(),
  keyHash:        text('key_hash').notNull(),
  litellmKeyName: text('litellm_key_name'),
  litellmKeyHash: text('litellm_key_hash'),
  revokedAt:      timestamp('revoked_at', { withTimezone: true }),
  lastUsedAt:     timestamp('last_used_at', { withTimezone: true }),
  expiresAt:      timestamp('expires_at', { withTimezone: true }),
  /** personal (dashboard-minted) or device (device-code flow). */
  kind:           text('kind').notNull().default('personal'),
  createdAt:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orgIdx:           index('api_keys_org_idx').on(t.organizationId),
  litellmNameIdx:   uniqueIndex('api_keys_litellm_name_idx').on(t.litellmKeyName),
}));

/**
 * Device-code authorizations for Zaino Desktop sign-in (lib/auth/device).
 * One row per issuance; 15-minute TTL whether or not it is ever approved.
 */
export const deviceCodes = pgTable('device_codes', {
  id:             uuid('id').primaryKey().defaultRandom(),
  deviceCodeHash: text('device_code_hash').notNull().unique(),
  userCode:       text('user_code').notNull().unique(),
  userId:         uuid('user_id').references(() => users.id),
  organizationId: uuid('organization_id').references(() => organizations.id),
  /** pending | approved | consumed | expired | revoked */
  status:         text('status').notNull().default('pending'),
  intervalSeconds: integer('interval_seconds').notNull().default(5),
  expiresAt:      timestamp('expires_at', { withTimezone: true }).notNull(),
  approvedAt:     timestamp('approved_at', { withTimezone: true }),
  consumedAt:     timestamp('consumed_at', { withTimezone: true }),
  keyId:          uuid('key_id').references(() => apiKeys.id),
  /**
   * One-time plaintext of the minted zn- key, held between approval and the
   * desktop app's first successful poll. NULL after consumption — never
   * logged, never returned in a list.
   */
  keyPlaintext:   text('key_plaintext'),
  /** Entitled alias set the minted key carries (non-secret metadata). */
  models:         text('models').array().notNull().default([]),
  /** Last token-poll time; enforces the minimum polling interval. */
  lastPolledAt:   timestamp('last_polled_at', { withTimezone: true }),
  createdAt:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  statusIdx: index('device_codes_status_idx').on(t.status),
  expiresIdx: index('device_codes_expires_at_idx').on(t.expiresAt),
}));

/** Ops alerting dedupe: one row, the last state we mailed about. */
export const systemAlerts = pgTable('system_alerts', {
  name:       text('name').primaryKey(),
  lastState:  text('last_state').notNull(),
  lastSentAt: timestamp('last_sent_at', { withTimezone: true }),
});

/**
 * Staff-recorded goodwill credits / refunds (0009, admin console).
 *
 * D17 has no refund API, so a refund is a manual transfer the ops team
 * makes by hand; this table is the record of it, tied to the org so the
 * ledger explains why money moved. Append-only — like audit_log, nothing
 * updates or deletes a row here. Amount is SIGNED: negative = refunded to
 * the customer, positive = credit applied against their next bill.
 */
export const creditNotes = pgTable('credit_notes', {
  id:             uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  amountCents:    integer('amount_cents').notNull(),
  currency:       text('currency').notNull().default('TND'),
  reason:         text('reason').notNull(),
  /** staff_users.id of the operator who recorded it. Never a customer id. */
  createdBy:      text('created_by').notNull(),
  createdAt:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orgIdx:     index('credit_notes_org_idx').on(t.organizationId, t.createdAt),
  createdIdx: index('credit_notes_created_idx').on(t.createdAt),
}));

/**
 * Manual D17 payments (La Poste Tunisienne) — a verification queue.
 *
 * There is no D17 merchant API, so a row here is a CLAIM of payment the
 * way a bank transfer claim always was: the customer states they paid,
 * an admin confirms it against the D17 app, and only then does the
 * subscription activate. See lib/billing/d17.ts.
 */
export const d17PaymentStatus = pgEnum('d17_payment_status', [
  'pending_payment',
  'proof_submitted',
  'paid',
  'rejected',
  'expired',
]);

export const paymentsD17 = pgTable('payments_d17', {
  id:                   uuid('id').primaryKey().defaultRandom(),
  // NOT unique since 0007: one row per renewal attempt, newest first.
  // `begin()` reuses an open row rather than piling up attempts; history
  // shows paid rows plus the latest open one.
  subscriptionId:       uuid('subscription_id').notNull().references(() => subscriptions.id, { onDelete: 'cascade' }),
  organizationId:       uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),

  amountMillimes:       integer('amount_millimes').notNull(),
  currency:             text('currency').notNull().default('TND'),
  usdAmountCents:       integer('usd_amount_cents').notNull(),
  fxRate:               numeric('fx_rate', { precision: 10, scale: 4 }).notNull(),

  /** Normalized (trimmed, uppercased). UNIQUE: one transfer pays one subscription. */
  authorizationNumber:  text('authorization_number').unique(),
  senderPhone:          text('sender_phone'),
  screenshotPath:       text('screenshot_path'),
  status:               d17PaymentStatus('status').notNull().default('pending_payment'),

  submittedAt:          timestamp('submitted_at', { withTimezone: true }),
  verifiedAt:           timestamp('verified_at', { withTimezone: true }),
  verifiedBy:           text('verified_by'),
  rejectReason:         text('reject_reason'),
  flaggedReview:        boolean('flagged_review').notNull().default(false),

  ip:                   text('ip'),
  userAgent:            text('user_agent'),

  /** Customer's chosen language at proof submission time (fr/ar/en).
   *  Used by admin approval/rejection emails so they match the language
   *  the customer used at checkout. NULL for pre-0016 rows; admin falls
   *  back to 'fr' in that case. */
  lang:                 text('lang'),

  expiresAt:            timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt:            timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:            timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  // Which subscription period this payment covers (0007). Provisional at
  // creation, corrected on approval. NULL for pre-0007 rows.
  periodStart:          timestamp('period_start', { withTimezone: true }),
  periodEnd:            timestamp('period_end', { withTimezone: true }),
}, (t) => ({
  queueIdx:    index('payments_d17_queue_idx').on(t.submittedAt),
  senderIdx:   index('payments_d17_sender_idx').on(t.senderPhone, t.submittedAt),
  expiryIdx:   index('payments_d17_expiry_idx').on(t.expiresAt),
  subCreatedIdx: index('payments_d17_sub_created_idx').on(t.subscriptionId, t.createdAt),
  subStatusIdx:  index('payments_d17_sub_status_idx').on(t.subscriptionId, t.status),
  oneOpenIdx:    uniqueIndex('payments_d17_one_open_idx')
    .on(t.subscriptionId)
    .where(sql`status IN ('pending_payment', 'proof_submitted', 'rejected')`),
}));

// Append-only ledger. Every dashboard number must be derivable from here.
export const usageRecords = pgTable('usage_records', {
  id:                 bigserial('id', { mode: 'number' }).primaryKey(),
  organizationId:     uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  apiKeyId:           uuid('api_key_id').references(() => apiKeys.id, { onDelete: 'set null' }),
  memberUserId:       uuid('member_user_id').references(() => users.id, { onDelete: 'set null' }),
  occurredAt:         timestamp('occurred_at', { withTimezone: true }).notNull(),
  billingPeriod:      date('billing_period').notNull(),
  model:              text('model').notNull(),
  route:              text('route').notNull(),
  upstreamKeyHash:    text('upstream_key_hash'),
  inputTokens:        integer('input_tokens').notNull().default(0),
  outputTokens:       integer('output_tokens').notNull().default(0),
  cacheWrite5mTokens: integer('cache_write_5m_tokens').notNull().default(0),
  cacheWrite1hTokens: integer('cache_write_1h_tokens').notNull().default(0),
  cacheReadTokens:    integer('cache_read_tokens').notNull().default(0),
  latencyMs:          integer('latency_ms'),
  statusCode:         integer('status_code'),
  // Both columns stored deliberately: the gap IS the margin.
  costUpstreamUsd:    numeric('cost_upstream_usd', { precision: 14, scale: 8 }).notNull().default('0'),
  costCustomerUsd:    numeric('cost_customer_usd', { precision: 14, scale: 8 }).notNull().default('0'),
  priceTableVersion:  text('price_table_version'),
  /** 1 for inference rows (chat_completions, responses), 0 otherwise. Migration 0013. */
  promptCount:        integer('prompt_count').notNull().default(0),
  dedupeHash:         text('dedupe_hash').notNull(),
  createdAt:          timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  dedupeIdx:    uniqueIndex('usage_records_dedupe_idx').on(t.dedupeHash),
  orgPeriodIdx: index('usage_records_org_period_idx').on(t.organizationId, t.billingPeriod),
  occurredIdx:  index('usage_records_occurred_idx').on(t.occurredAt),
  // Admin drill-down ("what did this org just do?") and the revenue
  // aggregates, which group by day over both cost columns. 0015.
  orgOccurredIdx: index('usage_records_org_occurred_idx').on(t.organizationId, t.occurredAt),
  occurredCostIdx: index('usage_records_occurred_cost_idx').on(t.occurredAt, t.costCustomerUsd, t.costUpstreamUsd),
}));

// Rollups are REBUILT from the ledger, never incremented. An increment run
// twice silently doubles a bill.
export const usagePeriods = pgTable('usage_periods', {
  organizationId:    uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  billingPeriod:     date('billing_period').notNull(),
  planId:            uuid('plan_id').notNull().references(() => plans.id),
  rateMultiplierBps: integer('rate_multiplier_bps').notNull(),
  requests:          bigint('requests', { mode: 'number' }).notNull().default(0),
  prompts:           bigint('prompts', { mode: 'number' }).notNull().default(0),
  inputTokens:       bigint('input_tokens', { mode: 'number' }).notNull().default(0),
  outputTokens:      bigint('output_tokens', { mode: 'number' }).notNull().default(0),
  cacheReadTokens:   bigint('cache_read_tokens', { mode: 'number' }).notNull().default(0),
  costUpstreamUsd:   numeric('cost_upstream_usd', { precision: 14, scale: 8 }).notNull().default('0'),
  costCustomerUsd:   numeric('cost_customer_usd', { precision: 14, scale: 8 }).notNull().default('0'),
  providerMeteredAt: timestamp('provider_metered_at', { withTimezone: true }),
  updatedAt:         timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.organizationId, t.billingPeriod] }),
}));

// Provider webhook replay safety: the event id is the dedupe key.
export const billingEvents = pgTable('billing_events', {
  id:          text('id').primaryKey(),
  type:        text('type').notNull(),
  receivedAt:  timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp('processed_at', { withTimezone: true }),
  attempts:    integer('attempts').notNull().default(0),
  lastError:   text('last_error'),
}, (t) => ({
  unprocessedIdx: index('billing_events_unprocessed_idx').on(t.receivedAt),
}));

export const auditLog = pgTable('audit_log', {
  id:             serial('id').primaryKey(),
  actorType:      auditActor('actor_type').notNull(),
  actorId:        text('actor_id'),
  organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'set null' }),
  action:         text('action').notNull(),
  targetType:     text('target_type'),
  targetId:       text('target_id'),
  before:         jsonb('before'),
  after:          jsonb('after'),
  ip:             inet('ip'),
  createdAt:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orgTimeIdx:  index('audit_log_org_time_idx').on(t.organizationId, t.createdAt),
  actionIdx:   index('audit_log_action_idx').on(t.action, t.createdAt),
  // Cross-org "what changed recently" — neither scoped index serves it.
  // 0015. This table grows on every key create, sync and approval.
  createdIdx:  index('audit_log_created_idx').on(t.createdAt),
}));

export const jobRuns = pgTable('job_runs', {
  name:      text('name').primaryKey(),
  lastRunAt: timestamp('last_run_at', { withTimezone: true }),
  lockedAt:  timestamp('locked_at', { withTimezone: true }),
  attempts:  integer('attempts').notNull().default(0),
  lastError: text('last_error'),
});

// ───────────────────────────────────────────────────────────────────────
//  Auth.js (NextAuth v5) — 0002_auth_local.sql
//
//  `auth_users` is the identity; `users` above is the domain mirror.
//  They are deliberately separate so the auth library stays replaceable.
// ───────────────────────────────────────────────────────────────────────
export const authUsers = pgTable('auth_users', {
  id:            text('id').primaryKey(),
  name:          text('name'),
  email:         text('email').notNull().unique(),
  emailVerified: timestamp('email_verified', { withTimezone: true }),
  image:         text('image'),
});

// The @auth/drizzle-adapter type-checks these tables against its own
// DefaultPostgresAccountsTable, which uses snake_case JS keys. The column
// names are the same, so the mapping is 1:1 — using camelCase here would
// satisfy the linter but fail the adapter's structural type.
export const authAccounts = pgTable('auth_accounts', {
  userId:            text('user_id').notNull().references(() => authUsers.id, { onDelete: 'cascade' }),
  type:              text('type').notNull(),
  provider:          text('provider').notNull(),
  providerAccountId: text('provider_account_id').notNull(),
  refresh_token:     text('refresh_token'),
  access_token:      text('access_token'),
  expires_at:        integer('expires_at'),
  token_type:        text('token_type'),
  scope:             text('scope'),
  id_token:          text('id_token'),
  session_state:     text('session_state'),
}, (t) => ({
  pk: primaryKey({ columns: [t.provider, t.providerAccountId] }),
}));

// Retained for adapter completeness. NOT the active session store: Auth.js
// v5 permits the Credentials provider only with the JWT strategy, so
// sessions are self-contained tokens. Revocation is enforced on every
// request by re-reading `users` / `staff_users` in lib/auth/authorize.ts.
export const authSessions = pgTable('auth_sessions', {
  sessionToken: text('session_token').primaryKey(),
  userId:       text('user_id').notNull().references(() => authUsers.id, { onDelete: 'cascade' }),
  expires:      timestamp('expires', { withTimezone: true }).notNull(),
}, (t) => ({
  userIdx: index('auth_sessions_user_idx').on(t.userId),
}));

export const authVerificationTokens = pgTable('auth_verification_tokens', {
  identifier: text('identifier').notNull(),
  token:      text('token').notNull(),
  expires:    timestamp('expires', { withTimezone: true }).notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.identifier, t.token] }),
}));

// scrypt hash. Stored in its own table rather than auth_accounts, which is
// the adapter's shape for OAuth providers — we have none.
export const authCredentials = pgTable('auth_credentials', {
  userId:    text('user_id').primaryKey().references(() => authUsers.id, { onDelete: 'cascade' }),
  password:  text('password').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// Brute-force control. A self-hosted credentials provider has no upstream
// WAF, so this is a first-class control (PLATFORM.md §9.1).
export const authLoginAttempts = pgTable('auth_login_attempts', {
  bucket:         text('bucket').primaryKey(),
  failures:       integer('failures').notNull().default(0),
  lastFailureAt:  timestamp('last_failure_at', { withTimezone: true }).notNull().defaultNow(),
  lockedUntil:    timestamp('locked_until', { withTimezone: true }),
}, (t) => ({
  lastIdx: index('auth_login_attempts_last_idx').on(t.lastFailureAt),
}));

// ───────────────────────────────────────────────────────────────────────
//  Trial codes — promotional free-trial redemption system (0017)
// ───────────────────────────────────────────────────────────────────────
export const trialCodes = pgTable('trial_codes', {
  id:              uuid('id').primaryKey().defaultRandom(),
  code:            text('code').notNull().unique(),
  createdBy:       text('created_by').notNull().default('system'),
  maxRedemptions:  integer('max_redemptions').notNull().default(0), // 0 = unlimited
  redeemedCount:   integer('redeemed_count').notNull().default(0),
  models:          text('models').array().notNull().default(['fast', 'smart']),
  /** Per-code token budget override; plan fallback when empty. The only quota. 0023. */
  tokenLimits:     jsonb('token_limits').notNull().default({}),
  trialDays:       integer('trial_days').notNull().default(3),
  validFrom:       timestamp('valid_from', { withTimezone: true }).notNull(),
  validUntil:      timestamp('valid_until', { withTimezone: true }).notNull(),
  expiresAt:       timestamp('expires_at', { withTimezone: true }).notNull(),
  active:          boolean('active').notNull().default(true),
  createdAt:       timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  activeIdx: index('trial_codes_active_idx').on(t.active, t.validFrom, t.validUntil),
}));

export const trialRedemptions = pgTable('trial_redemptions', {
  id:             uuid('id').primaryKey().defaultRandom(),
  trialCodeId:    uuid('trial_code_id').notNull().references(() => trialCodes.id, { onDelete: 'cascade' }),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  userId:         uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  subscriptionId: uuid('subscription_id').notNull().references(() => subscriptions.id, { onDelete: 'cascade' }),
  redeemedAt:     timestamp('redeemed_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt:      timestamp('expires_at', { withTimezone: true }).notNull(),
}, (t) => ({
  orgCodeUnique: unique('trial_redemptions_org_code_unique').on(t.organizationId, t.trialCodeId),
  orgIdx:        index('trial_redemptions_org_idx').on(t.organizationId),
  expiryIdx:     index('trial_redemptions_expiry_idx').on(t.expiresAt),
}));

export type User             = typeof users.$inferSelect;
export type NewUser          = typeof users.$inferInsert;
export type Org              = typeof organizations.$inferSelect;
export type Member           = typeof organizationMembers.$inferSelect;
export type Plan             = typeof plans.$inferSelect;
export type Subscription     = typeof subscriptions.$inferSelect;
export type Entitlement      = typeof entitlements.$inferSelect;
export type ApiKey           = typeof apiKeys.$inferSelect;
export type DeviceCode       = typeof deviceCodes.$inferSelect;
export type TrialCode        = typeof trialCodes.$inferSelect;
export type TrialRedemption  = typeof trialRedemptions.$inferSelect;
export type AuthUser         = typeof authUsers.$inferSelect;

/** The five org roles, as a type. IMPLEMENTATION.md §1.2. */
export type OrgRole = (typeof orgRole.enumValues)[number];