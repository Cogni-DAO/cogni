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
  ListRecentOptions,
  OrderLedger,
  RecordDecisionInput,
  StateSnapshot,
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
      created_at: now,
      updated_at: now,
    });
  }

  async markOrderId(params: {
    client_order_id: string;
    receipt: import("@cogni/market-provider").OrderReceipt;
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
}

function mapReceiptStatus(
  s: import("@cogni/market-provider").OrderReceipt["status"]
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
