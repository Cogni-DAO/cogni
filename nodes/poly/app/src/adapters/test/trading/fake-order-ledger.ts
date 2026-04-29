// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@adapters/test/trading/fake-order-ledger`
 * Purpose: In-memory `OrderLedger` implementation for unit tests. Behaviorally matches the Drizzle adapter (idempotent insert, fail-closed snapshot on seeded error, status map on mark) without touching Postgres.
 * Scope: Tests only. Deterministic. Knobs: `failConfigRead`, `initial` seed.
 * Invariants: BEHAVIOR_MATCHES_DRIZZLE — repeat `insertPending` with same (target_id, fill_id) is a no-op; `markOrderId` + `markError` find rows via `client_order_id` only.
 * Side-effects: none (mutates in-memory array)
 * Links: src/features/trading/order-ledger.types.ts
 * @public
 */

import type {
  InsertPendingInput,
  LedgerRow,
  LedgerStatus,
  ListOpenOrPendingOptions,
  ListRecentOptions,
  OrderLedger,
  RecordDecisionInput,
  StateSnapshot,
  SyncHealthSummary,
  UpdateStatusInput,
} from "@/features/trading/order-ledger.types";

export interface FakeOrderLedgerConfig {
  /** Seed rows — as if a prior tick had already inserted them. */
  initial?: LedgerRow[];
  /** Initial kill-switch state. Default true (so the happy path is the default). */
  enabled?: boolean;
  /** If set, `snapshotState` throws internally and the fake returns the fail-closed shape. */
  failConfigRead?: boolean;
}

export class FakeOrderLedger implements OrderLedger {
  readonly rows: LedgerRow[];
  readonly decisions: RecordDecisionInput[] = [];
  enabled: boolean;
  failConfigRead: boolean;

  constructor(config?: FakeOrderLedgerConfig) {
    this.rows = [...(config?.initial ?? [])];
    this.enabled = config?.enabled ?? true;
    this.failConfigRead = config?.failConfigRead ?? false;
  }

  async snapshotState(target_id: string): Promise<StateSnapshot> {
    if (this.failConfigRead) {
      // Match the real adapter's FAIL_CLOSED contract — no throw into caller.
      return {
        enabled: false,
        today_spent_usdc: 0,
        fills_last_hour: 0,
        already_placed_ids: [],
      };
    }
    const now = Date.now();
    const dayStartUtc = new Date();
    dayStartUtc.setUTCHours(0, 0, 0, 0);
    const oneHourAgo = new Date(now - 60 * 60 * 1000);

    // Caps filter on `created_at` (intent-submission time), not `observed_at`
    // (upstream fill time). Matches the real Drizzle adapter + CAPS_COUNT_INTENTS.
    const myRows = this.rows.filter((r) => r.target_id === target_id);
    const today_spent_usdc = myRows
      .filter((r) => r.created_at >= dayStartUtc)
      .reduce((sum, r) => {
        const v = (r.attributes as Record<string, unknown> | null)?.size_usdc;
        return sum + (typeof v === "number" ? v : 0);
      }, 0);
    const fills_last_hour = myRows.filter(
      (r) => r.created_at >= oneHourAgo
    ).length;
    const already_placed_ids = myRows.map((r) => r.client_order_id);

    return {
      enabled: this.enabled,
      today_spent_usdc,
      fills_last_hour,
      already_placed_ids,
    };
  }

  async cumulativeIntentForMarket(
    billing_account_id: string,
    market_id: string
  ): Promise<number> {
    if (this.failConfigRead) return Number.POSITIVE_INFINITY;
    return this.rows
      .filter(
        (r) =>
          r.billing_account_id === billing_account_id &&
          (r.attributes as Record<string, unknown> | null)?.market_id ===
            market_id &&
          ["pending", "open", "filled", "partial"].includes(r.status)
      )
      .reduce((sum, r) => {
        const v = (r.attributes as Record<string, unknown> | null)?.size_usdc;
        return sum + (typeof v === "number" ? v : 0);
      }, 0);
  }

  async insertPending(input: InsertPendingInput): Promise<void> {
    const existing = this.rows.find(
      (r) => r.target_id === input.target_id && r.fill_id === input.fill_id
    );
    if (existing) return; // ON CONFLICT DO NOTHING parity
    const attrs: Record<string, unknown> = {
      size_usdc: input.intent.size_usdc,
      limit_price: input.intent.limit_price,
      market_id: input.intent.market_id,
      outcome: input.intent.outcome,
      side: input.intent.side,
    };
    if (typeof input.intent.attributes?.token_id === "string") {
      attrs.token_id = input.intent.attributes.token_id;
    }
    if (typeof input.intent.attributes?.target_wallet === "string") {
      attrs.target_wallet = input.intent.attributes.target_wallet;
    }
    if (typeof input.intent.attributes?.source_fill_id === "string") {
      attrs.source_fill_id = input.intent.attributes.source_fill_id;
    }
    const now = new Date();
    this.rows.push({
      target_id: input.target_id,
      fill_id: input.fill_id,
      observed_at: input.observed_at,
      client_order_id: input.intent.client_order_id,
      order_id: null,
      status: "pending",
      attributes: attrs,
      synced_at: null,
      created_at: now,
      updated_at: now,
      billing_account_id: input.billing_account_id,
    });
  }

  async markOrderId(params: {
    client_order_id: string;
    receipt: import("@cogni/poly-market-provider").OrderReceipt;
  }): Promise<void> {
    const row = this.rows.find(
      (r) => r.client_order_id === params.client_order_id
    );
    if (!row) return;
    row.order_id = params.receipt.order_id;
    row.status = mapReceiptStatus(params.receipt.status);
    row.updated_at = new Date();
    row.attributes = {
      ...(row.attributes ?? {}),
      filled_size_usdc: params.receipt.filled_size_usdc ?? 0,
      submitted_at: params.receipt.submitted_at,
    };
  }

  async markError(params: {
    client_order_id: string;
    error: string;
  }): Promise<void> {
    const row = this.rows.find(
      (r) => r.client_order_id === params.client_order_id
    );
    if (!row) return;
    row.status = "error";
    row.updated_at = new Date();
    row.attributes = { ...(row.attributes ?? {}), error: params.error };
  }

  async recordDecision(input: RecordDecisionInput): Promise<void> {
    this.decisions.push(input);
  }

  async listRecent(opts?: ListRecentOptions): Promise<LedgerRow[]> {
    const limit = opts?.limit ?? 50;
    const filtered = opts?.target_id
      ? this.rows.filter((r) => r.target_id === opts.target_id)
      : [...this.rows];
    return filtered
      .sort((a, b) => b.observed_at.getTime() - a.observed_at.getTime())
      .slice(0, limit);
  }

  async listOpenOrPending(
    opts?: ListOpenOrPendingOptions
  ): Promise<LedgerRow[]> {
    const olderThanMs = opts?.olderThanMs ?? 30_000;
    const limit = opts?.limit ?? 200;
    const cutoff = new Date(Date.now() - olderThanMs);
    return this.rows
      .filter(
        (r) =>
          (r.status === "pending" || r.status === "open") &&
          r.created_at < cutoff
      )
      .sort((a, b) => a.created_at.getTime() - b.created_at.getTime())
      .slice(0, limit);
  }

  async updateStatus(input: UpdateStatusInput): Promise<void> {
    const row = this.rows.find(
      (r) => r.client_order_id === input.client_order_id
    );
    if (!row) return;
    row.status = input.status;
    row.updated_at = new Date();
    if (input.order_id !== undefined) {
      row.order_id = input.order_id;
    }
    if (input.filled_size_usdc !== undefined || input.reason !== undefined) {
      row.attributes = {
        ...(row.attributes ?? {}),
        ...(input.filled_size_usdc !== undefined
          ? { filled_size_usdc: input.filled_size_usdc }
          : {}),
        ...(input.reason !== undefined ? { reason: input.reason } : {}),
      };
    }
  }

  async markSynced(client_order_ids: string[]): Promise<void> {
    // No-op on empty array — matches real adapter behaviour.
    if (client_order_ids.length === 0) return;
    const now = new Date();
    for (const row of this.rows) {
      if (client_order_ids.includes(row.client_order_id)) {
        row.synced_at = now;
      }
    }
  }

  async syncHealthSummary(): Promise<SyncHealthSummary> {
    const now = Date.now();
    const staleThreshold = now - 60_000;

    // oldest_synced_row_age_ms: age of the least-recently-synced row.
    // Only consider rows with non-null synced_at (never-synced rows use
    // rows_never_synced).
    const syncedDates = this.rows
      .map((r) => r.synced_at?.getTime())
      .filter((t): t is number => t !== undefined && t !== null);

    const oldest_synced_row_age_ms =
      syncedDates.length > 0 ? now - Math.min(...syncedDates) : null;

    const rows_stale_over_60s = this.rows.filter(
      (r) => r.synced_at !== null && r.synced_at.getTime() < staleThreshold
    ).length;

    const rows_never_synced = this.rows.filter(
      (r) => r.synced_at === null
    ).length;

    return {
      oldest_synced_row_age_ms,
      rows_stale_over_60s,
      rows_never_synced,
    };
  }
}

function mapReceiptStatus(
  s: import("@cogni/poly-market-provider").OrderReceipt["status"]
): LedgerStatus {
  switch (s) {
    case "filled":
      return "filled";
    case "partial":
      return "partial";
    case "canceled":
      return "canceled";
    case "open":
      return "open";
    default:
      return "open";
  }
}
