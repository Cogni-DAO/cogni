// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/db-schema/identity`
 * Purpose: User identity binding tables — links external accounts (wallet, Discord, GitHub, Google) to users.
 * Scope: Defines user_bindings (current-state index) and identity_events (append-only audit trail). Does not contain queries or business logic.
 * Invariants:
 * - BINDINGS_ARE_EVIDENCED: Proof lives in identity_events.payload, not on the binding row.
 * - NO_AUTO_MERGE: UNIQUE(provider, external_id) — same external ID for same provider can't bind to two users.
 * - APPEND_ONLY_EVENTS: identity_events rows are append-only; DB trigger rejects UPDATE/DELETE.
 * - USER_ID_AT_CREATION: All FKs reference users.id (UUID).
 * Side-effects: none (schema definitions only)
 * Links: docs/spec/decentralized-identity.md
 * @public
 */

import { sql } from "drizzle-orm";
import {
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { users } from "./refs";

/**
 * User bindings — current-state index linking external accounts to users.
 * Proof/evidence lives in identity_events.payload, not here.
 * UNIQUE(provider, external_id) enforces NO_AUTO_MERGE at the DB level.
 */
export const userBindings = pgTable(
  "user_bindings",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    provider: text("provider").notNull(),
    externalId: text("external_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "user_bindings_provider_check",
      sql`${table.provider} IN ('wallet', 'discord', 'github', 'google')`
    ),
    uniqueIndex("user_bindings_provider_external_id_unique").on(
      table.provider,
      table.externalId
    ),
    index("user_bindings_user_id_idx").on(table.userId),
  ]
);

/**
 * Identity events — append-only audit trail for binding lifecycle.
 * DB trigger rejects UPDATE/DELETE (APPEND_ONLY_EVENTS).
 * Revocation creates a new event, never deletes rows.
 */
export const identityEvents = pgTable(
  "identity_events",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "identity_events_event_type_check",
      sql`${table.eventType} IN ('bind', 'revoke', 'merge')`
    ),
    index("identity_events_user_id_idx").on(table.userId),
  ]
);
