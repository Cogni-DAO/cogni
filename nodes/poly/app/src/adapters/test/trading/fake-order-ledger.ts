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

import {
  isLedgerPositionClosed,
  isLedgerRestingOrder,
  ledgerExecutedUsdc,
  shouldCountLedgerMarketIntent,
} from "@/features/trading/ledger-lifecycle";
import {
  AlreadyRestingError,
  type InsertPendingInput,
  type LedgerCancelReason,
  type LedgerPositionLifecycle,
  type LedgerRow,
  type LedgerStatus,
  type ListOpenOrPendingOptions,
  type ListRecentOptions,
  type MarkPositionClosedByAssetInput,
  type MarkPositionLifecycleByAssetInput,
  type MarkPositionLifecycleByConditionIdInput,
  type OpenOrderRow,
  type OrderLedger,
  type PositionIntentAggregate,
  type RecordDecisionInput,
  type StateSnapshot,
  type SyncHealthSummary,
  type UpdateStatusInput,
} from "@/features/trading/order-ledger.types";

export interface FakeOrderLedgerConfig {
  /** Seed rows — as if a prior tick had already inserted them. */
  initial?: LedgerRow[];
  /** If set, `snapshotState` throws internally and the fake returns the fail-closed shape. */
  failConfigRead?: boolean;
}

/**
 * Compute the generic per-(market_id, token_id) intent-aggregate rows for a
 * target's fills, mirroring the SQL semantics of the Drizzle `snapshotState`.
 * Pure + deterministic so unit tests don't need a Postgres testcontainer.
 *
 * Mirror-vocabulary overlay (`MirrorPositionView`) is the consumer's job —
 * see `@/features/copy-trade/types::aggregatePositionRows`.
 */
function computeIntentAggregatesForTarget(
  rows: LedgerRow[]
): PositionIntentAggregate[] {
  const activeStatuses: LedgerStatus[] = [
    "pending",
    "open",
    "filled",
    "partial",
  ];
  const activeLifecycles = new Set<LedgerPositionLifecycle | null>([
    null,
    "unresolved",
    "open",
    "closing",
  ]);

  type Bucket = {
    token_id: string;
    net_shares: number;
    gross_usdc_in: number;
    gross_shares_in: number;
  };
  const byCondition = new Map<string, Map<string, Bucket>>();

  for (const r of rows) {
    if (!activeStatuses.includes(r.status)) continue;
    if (!activeLifecycles.has(r.position_lifecycle)) continue;
    const attrs = r.attributes as Record<string, unknown> | null;
    if (!attrs) continue;
    if (typeof attrs.closed_at === "string" && attrs.closed_at.length > 0)
      continue;
    const tokenId =
      typeof attrs.token_id === "string" ? attrs.token_id : undefined;
    const conditionId =
      typeof attrs.market_id === "string" ? attrs.market_id : undefined;
    const sizeUsdc =
      typeof attrs.size_usdc === "number" ? attrs.size_usdc : NaN;
    const limitPrice =
      typeof attrs.limit_price === "number" ? attrs.limit_price : NaN;
    const side = typeof attrs.side === "string" ? attrs.side : undefined;
    if (!tokenId || !conditionId) continue;
    if (!Number.isFinite(sizeUsdc) || !Number.isFinite(limitPrice)) continue;
    if (limitPrice === 0) continue;

    const shares = sizeUsdc / limitPrice;
    let bucketsForCondition = byCondition.get(conditionId);
    if (!bucketsForCondition) {
      bucketsForCondition = new Map();
      byCondition.set(conditionId, bucketsForCondition);
    }
    let bucket = bucketsForCondition.get(tokenId);
    if (!bucket) {
      bucket = {
        token_id: tokenId,
        net_shares: 0,
        gross_usdc_in: 0,
        gross_shares_in: 0,
      };
      bucketsForCondition.set(tokenId, bucket);
    }
    if (side === "BUY") {
      bucket.net_shares += shares;
      bucket.gross_usdc_in += sizeUsdc;
      bucket.gross_shares_in += shares;
    } else if (side === "SELL") {
      bucket.net_shares -= shares;
    }
  }

  const out: PositionIntentAggregate[] = [];
  for (const [conditionId, buckets] of byCondition) {
    for (const bucket of buckets.values()) {
      out.push({
        market_id: conditionId,
        token_id: bucket.token_id,
        net_shares: bucket.net_shares,
        gross_usdc_in: bucket.gross_usdc_in,
        gross_shares_in: bucket.gross_shares_in,
      });
    }
  }
  return out;
}

export class FakeOrderLedger implements OrderLedger {
  readonly rows: LedgerRow[];
  readonly decisions: RecordDecisionInput[] = [];
  failConfigRead: boolean;

  constructor(config?: FakeOrderLedgerConfig) {
    this.rows = [...(config?.initial ?? [])];
    this.failConfigRead = config?.failConfigRead ?? false;
  }

  async snapshotState(target_id: string): Promise<StateSnapshot> {
    if (this.failConfigRead) {
      // Match the real adapter's FAIL_CLOSED contract — no throw into caller.
      return {
        today_spent_usdc: 0,
        fills_last_hour: 0,
        already_placed_ids: [],
        position_aggregates: [],
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
    const position_aggregates = computeIntentAggregatesForTarget(myRows);

    return {
      today_spent_usdc,
      fills_last_hour,
      already_placed_ids,
      position_aggregates,
    };
  }

  async cumulativeIntentForMarket(
    billing_account_id: string,
    market_id: string
  ): Promise<number> {
    if (this.failConfigRead) return Number.POSITIVE_INFINITY;
    return this.rows
      .filter((r) => {
        if (r.billing_account_id !== billing_account_id) return false;
        const attrs = r.attributes as Record<string, unknown> | null;
        if (attrs?.market_id !== market_id) return false;
        return shouldCountLedgerMarketIntent(r);
      })
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
    // Partial unique index parity (DEDUPE_AT_DB) — reject second open row for
    // the same (billing_account_id, target_id, market_id) tuple.
    const conflictsOnMarket = this.rows.find(
      (r) =>
        r.billing_account_id === input.billing_account_id &&
        r.target_id === input.target_id &&
        ((r.attributes as Record<string, unknown> | null)?.market_id ??
          null) === input.intent.market_id &&
        isLedgerRestingOrder(r)
    );
    if (conflictsOnMarket) {
      throw new AlreadyRestingError(
        input.billing_account_id,
        input.target_id,
        input.intent.market_id
      );
    }
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
    if (typeof input.intent.attributes?.condition_id === "string") {
      attrs.condition_id = input.intent.attributes.condition_id;
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
      position_lifecycle: null,
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
    const positionLifecycle = lifecycleFromOrderUpdate(
      row.status,
      params.receipt.filled_size_usdc
    );
    if (positionLifecycle !== null && !isLedgerPositionClosed(row)) {
      row.position_lifecycle = positionLifecycle;
    }
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

  async markCanceled(params: {
    client_order_id: string;
    reason: LedgerCancelReason;
  }): Promise<void> {
    const row = this.rows.find(
      (r) => r.client_order_id === params.client_order_id
    );
    if (!row) return;
    row.status = "canceled";
    row.updated_at = new Date();
    row.attributes = { ...(row.attributes ?? {}), reason: params.reason };
  }

  async markPositionClosedByAsset(
    input: MarkPositionClosedByAssetInput
  ): Promise<number> {
    let changed = 0;
    for (const row of this.rows) {
      const attrs = row.attributes as Record<string, unknown> | null;
      if (row.billing_account_id !== input.billing_account_id) continue;
      if (attrs?.token_id !== input.token_id) continue;
      if (
        row.position_lifecycle === null &&
        row.status !== "filled" &&
        row.status !== "partial" &&
        ledgerExecutedUsdc(row) <= 0
      ) {
        continue;
      }
      if (isLedgerPositionClosed(row)) continue;
      row.updated_at = input.closed_at;
      row.position_lifecycle = "closed";
      row.attributes = {
        ...(row.attributes ?? {}),
        closed_at: input.closed_at.toISOString(),
        close_order_id: input.close_order_id,
        close_client_order_id: input.close_client_order_id,
        close_reason: input.reason,
      };
      changed += 1;
    }
    return changed;
  }

  async markPositionLifecycleByAsset(
    input: MarkPositionLifecycleByAssetInput
  ): Promise<number> {
    let changed = 0;
    for (const row of this.rows) {
      const attrs = row.attributes as Record<string, unknown> | null;
      if (row.billing_account_id !== input.billing_account_id) continue;
      if (attrs?.token_id !== input.token_id) continue;
      const isRedeemReorgCorrection =
        input.terminal_correction === "redeem_reorg" &&
        input.lifecycle === "redeem_pending" &&
        row.position_lifecycle === "redeemed";
      if (
        !["closed", "redeemed", "loser", "dust", "abandoned"].includes(
          input.lifecycle
        ) &&
        row.position_lifecycle !== null &&
        ["closed", "redeemed", "loser", "dust", "abandoned"].includes(
          row.position_lifecycle
        ) &&
        !isRedeemReorgCorrection
      ) {
        continue;
      }
      if (
        row.position_lifecycle === null &&
        row.status !== "filled" &&
        row.status !== "partial" &&
        ledgerExecutedUsdc(row) <= 0
      ) {
        continue;
      }
      row.position_lifecycle = input.lifecycle;
      row.updated_at = input.updated_at;
      changed += 1;
    }
    return changed;
  }

  async markPositionLifecycleByConditionId(
    input: MarkPositionLifecycleByConditionIdInput
  ): Promise<number> {
    const normalizedMarketId = `prediction-market:polymarket:${input.condition_id}`;
    let changed = 0;
    for (const row of this.rows) {
      const attrs = row.attributes as Record<string, unknown> | null;
      if (row.billing_account_id !== input.billing_account_id) continue;
      if (
        attrs?.condition_id !== input.condition_id &&
        attrs?.market_id !== input.condition_id &&
        attrs?.market_id !== normalizedMarketId
      ) {
        continue;
      }
      if (
        !["closed", "redeemed", "loser", "dust", "abandoned"].includes(
          input.lifecycle
        ) &&
        row.position_lifecycle !== null &&
        ["closed", "redeemed", "loser", "dust", "abandoned"].includes(
          row.position_lifecycle
        )
      ) {
        continue;
      }
      if (
        row.position_lifecycle === null &&
        row.status !== "filled" &&
        row.status !== "partial" &&
        ledgerExecutedUsdc(row) <= 0
      ) {
        continue;
      }
      row.position_lifecycle = input.lifecycle;
      row.updated_at = input.updated_at;
      changed += 1;
    }
    return changed;
  }

  async hasOpenForMarket(args: {
    billing_account_id: string;
    target_id: string;
    market_id: string;
  }): Promise<boolean> {
    return this.rows.some(
      (r) =>
        r.billing_account_id === args.billing_account_id &&
        r.target_id === args.target_id &&
        ((r.attributes as Record<string, unknown> | null)?.market_id ??
          null) === args.market_id &&
        isLedgerRestingOrder(r)
    );
  }

  async findOpenForMarket(args: {
    billing_account_id: string;
    target_id: string;
    market_id: string;
  }): Promise<OpenOrderRow[]> {
    return this.rows
      .filter(
        (r) =>
          r.billing_account_id === args.billing_account_id &&
          r.target_id === args.target_id &&
          ((r.attributes as Record<string, unknown> | null)?.market_id ??
            null) === args.market_id &&
          isLedgerRestingOrder(r)
      )
      .map((r) => ({
        client_order_id: r.client_order_id,
        order_id: r.order_id,
        status: r.status,
        billing_account_id: r.billing_account_id,
        target_id: r.target_id,
        market_id: args.market_id,
        created_at: r.created_at,
      }));
  }

  async findStaleOpen(args: {
    max_age_minutes: number;
  }): Promise<OpenOrderRow[]> {
    const cutoff = new Date(Date.now() - args.max_age_minutes * 60_000);
    return this.rows
      .filter((r) => isLedgerRestingOrder(r) && r.created_at < cutoff)
      .map((r) => {
        const market_id =
          ((r.attributes as Record<string, unknown> | null)?.market_id as
            | string
            | undefined) ?? "";
        return {
          client_order_id: r.client_order_id,
          order_id: r.order_id,
          status: r.status,
          billing_account_id: r.billing_account_id,
          target_id: r.target_id,
          market_id,
          created_at: r.created_at,
        };
      });
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

  async listTenantPositions(opts: {
    billing_account_id: string;
    statuses?: LedgerStatus[];
    limit?: number;
  }): Promise<LedgerRow[]> {
    const statuses = opts.statuses ?? ["open", "filled", "partial"];
    const limit = opts.limit ?? 50;
    return this.rows
      .filter(
        (r) =>
          r.billing_account_id === opts.billing_account_id &&
          statuses.includes(r.status)
      )
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
          isLedgerRestingOrder(r) &&
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
    const positionLifecycle = lifecycleFromOrderUpdate(
      input.status,
      input.filled_size_usdc
    );
    if (positionLifecycle !== null && !isLedgerPositionClosed(row)) {
      row.position_lifecycle = positionLifecycle;
    }
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

function lifecycleFromOrderUpdate(
  status: LedgerStatus,
  filledSizeUsdc: number | undefined
): LedgerPositionLifecycle | null {
  if (status === "filled" || status === "partial") return "open";
  if (filledSizeUsdc !== undefined && filledSizeUsdc > 0) return "open";
  return null;
}
