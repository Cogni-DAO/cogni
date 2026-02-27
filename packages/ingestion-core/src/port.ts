// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/ingestion-core/port`
 * Purpose: Port interface for activity source adapters.
 * Scope: Pure interface. Does not contain implementations — those live in services/scheduler-worker/src/adapters/ingestion/.
 * Invariants:
 * - ADAPTERS_NOT_IN_CORE: This file defines the PORT (interface), not implementations.
 * - All adapter deps (octokit, discord.js) live in the adapter, never in this package.
 * Side-effects: none
 * Links: docs/spec/attribution-ledger.md#source-adapter-interface
 * @public
 */

import type {
  ActivityEvent,
  CollectParams,
  CollectResult,
  StreamDefinition,
} from "./model";

/**
 * Port interface for source adapters that collect activity from external platforms.
 *
 * Each adapter connects to one external system (GitHub, Discord, etc.), fetches events
 * since the last cursor, normalizes them to ActivityEvent, and returns the events + next cursor.
 *
 * Adapters are stateless — cursor persistence is handled by the calling workflow via
 * ActivityLedgerStore.upsertCursor().
 */
export interface SourceAdapter {
  /** Source platform identifier: "github", "discord" */
  readonly source: string;

  /** Adapter version — bump on schema changes that affect payloadHash */
  readonly version: string;

  /** Available streams this adapter can collect from */
  streams(): StreamDefinition[];

  /**
   * Collect activity events. Idempotent via deterministic event IDs.
   * Uses cursor for incremental sync (CURSOR_STATE_PERSISTED).
   *
   * @returns Events collected + updated cursor for next call
   */
  collect(params: CollectParams): Promise<CollectResult>;

  /**
   * Optional real-time webhook handler for fast-path ingestion.
   * Deferred to P1 — not required for V0.
   */
  handleWebhook?(payload: unknown): Promise<ActivityEvent[]>;
}
