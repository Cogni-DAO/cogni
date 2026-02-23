// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/db-schema/ledger`
 * Purpose: Three-layer immutable epoch ledger schema for auditable activity-based credit payouts.
 * Scope: Defines all ledger tables (epochs, activity_events, activity_curation, epoch_allocations, source_cursors, epoch_pool_components, payout_statements, statement_signatures). Does not contain queries, business logic, or I/O.
 * Invariants:
 * - All credit/unit columns use BIGINT (ALL_MATH_BIGINT).
 * - Layer 1 (activity_events, epoch_pool_components) are append-only (DB triggers in migration).
 * - Layer 2 (activity_curation) is mutable while epoch open/review, frozen on finalize (CURATION_FREEZE_ON_FINALIZE).
 * - ONE_OPEN_EPOCH: partial unique index on epochs WHERE status = 'open', scoped to (node_id, scope_id).
 * - EPOCH_WINDOW_UNIQUE: unique(node_id, scope_id, period_start, period_end).
 * - NODE_SCOPED: all ledger tables include node_id.
 * - No RLS in V0 — worker uses service-role connection.
 * Side-effects: none (schema definitions only)
 * Links: docs/spec/epoch-ledger.md
 * @public
 */

import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { users } from "./refs";

// ---------------------------------------------------------------------------
// Epochs — Layer 0 (time boundaries + config)
// ---------------------------------------------------------------------------

/**
 * Epochs — one open epoch at a time per node (ONE_OPEN_EPOCH).
 * node_id scoped (NODE_SCOPED).
 */
export const epochs = pgTable(
  "epochs",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    nodeId: uuid("node_id").notNull(),
    scopeId: uuid("scope_id").notNull(),
    status: text("status").notNull().default("open"),
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
    weightConfig: jsonb("weight_config")
      .$type<Record<string, number>>()
      .notNull(),
    poolTotalCredits: bigint("pool_total_credits", { mode: "bigint" }),
    approverSetHash: text("approver_set_hash"),
    openedAt: timestamp("opened_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "epochs_status_check",
      sql`${table.status} IN ('open', 'review', 'finalized')`
    ),
    // EPOCH_WINDOW_UNIQUE: no overlapping windows per node+scope
    uniqueIndex("epochs_window_unique").on(
      table.nodeId,
      table.scopeId,
      table.periodStart,
      table.periodEnd
    ),
    // ONE_OPEN_EPOCH per node+scope
    uniqueIndex("epochs_one_open_per_node")
      .on(table.nodeId, table.scopeId, table.status)
      .where(sql`${table.status} = 'open'`),
  ]
);

// ---------------------------------------------------------------------------
// Layer 1: Raw Activity (immutable always)
// ---------------------------------------------------------------------------

/**
 * Activity events — immutable facts, append-only (ACTIVITY_APPEND_ONLY).
 * DB trigger rejects UPDATE/DELETE.
 * No user_id — identity resolution happens at curation layer.
 * No epoch_id — epoch membership derived from event_time at curation layer.
 * Composite PK: (node_id, id) where id is deterministic (e.g., "github:pr:org/repo:42").
 */
export const activityEvents = pgTable(
  "activity_events",
  {
    nodeId: uuid("node_id").notNull(),
    scopeId: uuid("scope_id").notNull(),
    id: text("id").notNull(),
    source: text("source").notNull(),
    eventType: text("event_type").notNull(),
    platformUserId: text("platform_user_id").notNull(),
    platformLogin: text("platform_login"),
    artifactUrl: text("artifact_url"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    payloadHash: text("payload_hash").notNull(),
    producer: text("producer").notNull(),
    producerVersion: text("producer_version").notNull(),
    eventTime: timestamp("event_time", { withTimezone: true }).notNull(),
    retrievedAt: timestamp("retrieved_at", { withTimezone: true }).notNull(),
    ingestedAt: timestamp("ingested_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.nodeId, table.id] }),
    index("activity_events_node_time_idx").on(
      table.nodeId,
      table.scopeId,
      table.eventTime
    ),
    index("activity_events_source_type_idx").on(table.source, table.eventType),
    index("activity_events_platform_user_idx").on(table.platformUserId),
  ]
);

// ---------------------------------------------------------------------------
// Layer 2: Curation (mutable until epoch closes)
// ---------------------------------------------------------------------------

/**
 * Activity curation — admin decisions about which events count and how.
 * Mutable while epoch is open, frozen by trigger when epoch closes (CURATION_FREEZE_ON_CLOSE).
 * Links events to epochs (epoch membership assigned here, not on raw event).
 */
export const activityCuration = pgTable(
  "activity_curation",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    nodeId: uuid("node_id").notNull(),
    epochId: bigint("epoch_id", { mode: "bigint" })
      .notNull()
      .references(() => epochs.id),
    eventId: text("event_id").notNull(),
    userId: text("user_id").references(() => users.id),
    included: boolean("included").notNull().default(true),
    weightOverrideMilli: bigint("weight_override_milli", { mode: "bigint" }),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("activity_curation_epoch_event_unique").on(
      table.epochId,
      table.eventId
    ),
    index("activity_curation_epoch_idx").on(table.epochId),
  ]
);

// ---------------------------------------------------------------------------
// Epoch allocations (computed from curation)
// ---------------------------------------------------------------------------

/**
 * Epoch allocations — per-user credit allocation for an epoch.
 * Replaces receipt_events from old schema.
 */
export const epochAllocations = pgTable(
  "epoch_allocations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    nodeId: uuid("node_id").notNull(),
    epochId: bigint("epoch_id", { mode: "bigint" })
      .notNull()
      .references(() => epochs.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    proposedUnits: bigint("proposed_units", { mode: "bigint" }).notNull(),
    finalUnits: bigint("final_units", { mode: "bigint" }),
    overrideReason: text("override_reason"),
    activityCount: integer("activity_count").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("epoch_allocations_epoch_user_unique").on(
      table.epochId,
      table.userId
    ),
    index("epoch_allocations_epoch_idx").on(table.epochId),
  ]
);

// ---------------------------------------------------------------------------
// Source cursors (ingestion state tracking)
// ---------------------------------------------------------------------------

/**
 * Source cursors — track ingestion position per source stream.
 * Composite PK: (node_id, scope_id, source, stream, source_ref).
 */
export const sourceCursors = pgTable(
  "source_cursors",
  {
    nodeId: uuid("node_id").notNull(),
    scopeId: uuid("scope_id").notNull(),
    source: text("source").notNull(),
    stream: text("stream").notNull(),
    sourceRef: text("source_ref").notNull(),
    cursorValue: text("cursor_value").notNull(),
    retrievedAt: timestamp("retrieved_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.nodeId,
        table.scopeId,
        table.source,
        table.stream,
        table.sourceRef,
      ],
    }),
  ]
);

// ---------------------------------------------------------------------------
// Epoch pool components (immutable, append-only)
// ---------------------------------------------------------------------------

/**
 * Epoch pool components — immutable, append-only (POOL_IMMUTABLE).
 * DB trigger rejects UPDATE/DELETE.
 * POOL_UNIQUE_PER_TYPE: UNIQUE(epoch_id, component_id).
 */
export const epochPoolComponents = pgTable(
  "epoch_pool_components",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    nodeId: uuid("node_id").notNull(),
    epochId: bigint("epoch_id", { mode: "bigint" })
      .notNull()
      .references(() => epochs.id),
    componentId: text("component_id").notNull(),
    algorithmVersion: text("algorithm_version").notNull(),
    inputsJson: jsonb("inputs_json").$type<Record<string, unknown>>().notNull(),
    amountCredits: bigint("amount_credits", { mode: "bigint" }).notNull(),
    evidenceRef: text("evidence_ref"),
    computedAt: timestamp("computed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("epoch_pool_components_epoch_component_unique").on(
      table.epochId,
      table.componentId
    ),
  ]
);

// ---------------------------------------------------------------------------
// Layer 3: Ledger Statement (immutable once signed)
// ---------------------------------------------------------------------------

/**
 * Payout statements — derived artifact from activity + curation + pool + weights.
 * One per epoch (scoped to node). Amendments use supersedes_statement_id.
 */
export const payoutStatements = pgTable(
  "payout_statements",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    nodeId: uuid("node_id").notNull(),
    epochId: bigint("epoch_id", { mode: "bigint" })
      .notNull()
      .references(() => epochs.id),
    allocationSetHash: text("allocation_set_hash").notNull(),
    poolTotalCredits: bigint("pool_total_credits", {
      mode: "bigint",
    }).notNull(),
    payoutsJson: jsonb("payouts_json")
      .$type<
        Array<{
          user_id: string;
          total_units: string;
          share: string;
          amount_credits: string;
        }>
      >()
      .notNull(),
    supersedesStatementId: uuid("supersedes_statement_id").references(
      // biome-ignore lint/suspicious/noExplicitAny: Drizzle self-referencing FK requires explicit type to break circular inference
      (): any => payoutStatements.id
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("payout_statements_node_epoch_unique").on(
      table.nodeId,
      table.epochId
    ),
  ]
);

/**
 * Statement signatures — client-side EIP-191 signatures on payout statements.
 * Schema only — signing flow is a follow-up task.
 */
export const statementSignatures = pgTable(
  "statement_signatures",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    nodeId: uuid("node_id").notNull(),
    statementId: uuid("statement_id")
      .notNull()
      .references(() => payoutStatements.id),
    signerWallet: text("signer_wallet").notNull(),
    signature: text("signature").notNull(),
    signedAt: timestamp("signed_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("statement_signatures_statement_signer_unique").on(
      table.statementId,
      table.signerWallet
    ),
  ]
);
