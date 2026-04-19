// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/trading/order-ledger`
 * Purpose: Drizzle-backed `OrderLedger` adapter. Reads + writes `poly_copy_trade_fills` + `poly_copy_trade_decisions` + `poly_copy_trade_config` (system-owned tables, no RLS per migration 0027). Every placement path (agent tool, mirror-coordinator, future WS ingester) reads + writes through this adapter.
 * Scope: Drizzle queries only. Does not build a DB client (caller injects); does not import from `adapters/server/*` (layer boundary); does not know about copy-trade or wallet-watch (TRADING_IS_GENERIC).
 * Invariants:
 *   - TRADING_IS_GENERIC — no imports from `features/copy-trade/` or `features/wallet-watch/`.
 *   - FAIL_CLOSED_ON_CONFIG_READ — `snapshotState` returns `{enabled: false, ...zeroes}` on any DB error and logs at `warn`. Never throws.
 *   - INSERT_IS_IDEMPOTENT — `insertPending` uses `ON CONFLICT (target_id, fill_id) DO NOTHING`, so repeat inserts are silent no-ops. Ordering guarantee lives in the caller, not here.
 *   - STATUS_ENUM_PINNED — the `status` CHECK in migration 0027 rejects any writer that tries to store an unknown value; that + `LedgerStatus` keep the runtime + schema in sync.
 *   - CAPS_COUNT_INTENTS — `today_spent_usdc` + `fills_last_hour` count every row whose `observed_at` falls in the window, regardless of terminal status. Matches `decide.ts::INTENT_BASED_CAPS`.
 *   - SYNCED_AT_WRITTEN_ON_EVERY_SYNC — `markSynced` sets `synced_at = now()` for every row for which the reconciler received a typed CLOB response (found OR not_found). Rows never checked show `synced_at IS NULL`. (task.0328 CP3)
 * Side-effects: IO (Postgres reads + writes).
 * Links: work/items/task.0315.poly-copy-trade-prototype.md (CP4.3b), work/items/task.0328.poly-sync-truth-ledger-cache.md, docs/spec/poly-copy-trade-phase1.md
 * @public
 */

import { EVENT_NAMES } from "@cogni/node-shared";
import {
  polyCopyTradeConfig,
  polyCopyTradeDecisions,
  polyCopyTradeFills,
} from "@cogni/poly-db-schema/copy-trade";
import { and, count, desc, eq, gte, inArray, sql, sum } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Logger } from "pino";

import type {
  InsertPendingInput,
  LedgerRow,
  ListOpenOrPendingOptions,
  ListRecentOptions,
  OrderLedger,
  RecordDecisionInput,
  StateSnapshot,
  SyncHealthSummary,
  UpdateStatusInput,
} from "./order-ledger.types";

/** Dependencies injected at the `bootstrap/container.ts` boundary. */
export interface OrderLedgerDeps {
  /** Drizzle client — BYPASSRLS is fine because these tables are system-owned. */
  db: NodePgDatabase;
  /** Pino logger. Bind `component: "order-ledger"` at the caller if desired. */
  logger: Logger;
}

const DEFAULT_LIST_LIMIT = 50;

export function createOrderLedger(deps: OrderLedgerDeps): OrderLedger {
  const log = deps.logger.child({ component: "order-ledger" });

  return {
    async snapshotState(target_id: string): Promise<StateSnapshot> {
      try {
        // Four concurrent reads — one round-trip to postgres-js, four statements.
        const [configRows, spendRows, rateRows, cidRows] = await Promise.all([
          deps.db
            .select({ enabled: polyCopyTradeConfig.enabled })
            .from(polyCopyTradeConfig)
            .where(eq(polyCopyTradeConfig.singletonId, 1))
            .limit(1),
          // Caps are INTENT-based (CAPS_COUNT_INTENTS invariant): filter by
          // `created_at` (when we inserted the pending row) — NOT by
          // `observed_at` (the upstream fill time, which can be arbitrarily old
          // for a target's historical activity). See decide.ts::INTENT_BASED_CAPS.
          deps.db
            .select({
              spent: sum(
                sql<string>`COALESCE((${polyCopyTradeFills.attributes}->>'size_usdc')::numeric, 0)`
              ),
            })
            .from(polyCopyTradeFills)
            .where(
              and(
                eq(polyCopyTradeFills.targetId, target_id),
                gte(
                  polyCopyTradeFills.createdAt,
                  sql`date_trunc('day', now() at time zone 'utc') at time zone 'utc'`
                )
              )
            ),
          deps.db
            .select({ n: count() })
            .from(polyCopyTradeFills)
            .where(
              and(
                eq(polyCopyTradeFills.targetId, target_id),
                gte(
                  polyCopyTradeFills.createdAt,
                  sql`now() - interval '1 hour'`
                )
              )
            ),
          deps.db
            .select({ cid: polyCopyTradeFills.clientOrderId })
            .from(polyCopyTradeFills)
            .where(eq(polyCopyTradeFills.targetId, target_id)),
        ]);

        const enabled = configRows[0]?.enabled ?? false;
        const today_spent_usdc = Number(spendRows[0]?.spent ?? 0);
        const fills_last_hour = Number(rateRows[0]?.n ?? 0);
        const already_placed_ids = cidRows.map((r) => r.cid);

        return {
          enabled,
          today_spent_usdc,
          fills_last_hour,
          already_placed_ids,
        };
      } catch (err: unknown) {
        // FAIL_CLOSED — any error returns the fail-closed snapshot.
        log.warn(
          {
            event: EVENT_NAMES.ADAPTER_ORDER_LEDGER_SNAPSHOT_ERROR,
            errorCode: "snapshot_fail_closed",
            target_id,
            err: err instanceof Error ? err.message : String(err),
          },
          "order-ledger snapshot failed; returning enabled=false"
        );
        return {
          enabled: false,
          today_spent_usdc: 0,
          fills_last_hour: 0,
          already_placed_ids: [],
        };
      }
    },

    async insertPending(input: InsertPendingInput): Promise<void> {
      // Stash placement-display fields in `attributes` so the read API +
      // dashboard don't need to re-derive from the intent blob.
      const attrs = {
        size_usdc: input.intent.size_usdc,
        limit_price: input.intent.limit_price,
        market_id: input.intent.market_id,
        outcome: input.intent.outcome,
        side: input.intent.side,
        token_id:
          typeof input.intent.attributes?.token_id === "string"
            ? input.intent.attributes.token_id
            : undefined,
        target_wallet:
          typeof input.intent.attributes?.target_wallet === "string"
            ? input.intent.attributes.target_wallet
            : undefined,
        source_fill_id:
          typeof input.intent.attributes?.source_fill_id === "string"
            ? input.intent.attributes.source_fill_id
            : undefined,
        title:
          typeof input.intent.attributes?.title === "string"
            ? input.intent.attributes.title
            : undefined,
        transaction_hash:
          typeof input.intent.attributes?.transaction_hash === "string"
            ? input.intent.attributes.transaction_hash
            : undefined,
      };

      await deps.db
        .insert(polyCopyTradeFills)
        .values({
          targetId: input.target_id,
          fillId: input.fill_id,
          observedAt: input.observed_at,
          clientOrderId: input.intent.client_order_id,
          orderId: null,
          status: "pending",
          attributes: attrs,
        })
        .onConflictDoNothing({
          target: [polyCopyTradeFills.targetId, polyCopyTradeFills.fillId],
        });
    },

    async markOrderId(params: {
      client_order_id: string;
      receipt: import("@cogni/market-provider").OrderReceipt;
    }): Promise<void> {
      // Update by `client_order_id` — unique-by-construction across rows since
      // cid is deterministic from `(target_id, fill_id)` (PK).
      const status: LedgerRow["status"] = mapReceiptStatus(
        params.receipt.status
      );
      await deps.db
        .update(polyCopyTradeFills)
        .set({
          orderId: params.receipt.order_id,
          status,
          updatedAt: new Date(),
          attributes: sql`COALESCE(${polyCopyTradeFills.attributes}, '{}'::jsonb) || ${JSON.stringify(
            {
              filled_size_usdc: params.receipt.filled_size_usdc ?? 0,
              submitted_at: params.receipt.submitted_at,
            }
          )}::jsonb`,
        })
        .where(eq(polyCopyTradeFills.clientOrderId, params.client_order_id));
    },

    async markError(params: {
      client_order_id: string;
      error: string;
    }): Promise<void> {
      // Cap error string at 512 chars — matches executor log truncation to
      // keep jsonb bounded for grafana / dashboard rendering.
      const truncated =
        params.error.length > 512
          ? `${params.error.slice(0, 512)}…`
          : params.error;
      await deps.db
        .update(polyCopyTradeFills)
        .set({
          status: "error",
          updatedAt: new Date(),
          attributes: sql`COALESCE(${polyCopyTradeFills.attributes}, '{}'::jsonb) || ${JSON.stringify(
            { error: truncated }
          )}::jsonb`,
        })
        .where(eq(polyCopyTradeFills.clientOrderId, params.client_order_id));
    },

    async recordDecision(input: RecordDecisionInput): Promise<void> {
      await deps.db.insert(polyCopyTradeDecisions).values({
        targetId: input.target_id,
        fillId: input.fill_id,
        outcome: input.outcome,
        reason: input.reason,
        intent: input.intent,
        receipt: input.receipt,
        decidedAt: input.decided_at,
      });
    },

    async listRecent(opts?: ListRecentOptions): Promise<LedgerRow[]> {
      const limit = opts?.limit ?? DEFAULT_LIST_LIMIT;
      const whereClause = opts?.target_id
        ? eq(polyCopyTradeFills.targetId, opts.target_id)
        : undefined;

      const rows = await deps.db
        .select()
        .from(polyCopyTradeFills)
        .where(whereClause)
        .orderBy(desc(polyCopyTradeFills.observedAt))
        .limit(limit);

      return rows.map((r) => ({
        target_id: r.targetId,
        fill_id: r.fillId,
        observed_at: r.observedAt,
        client_order_id: r.clientOrderId,
        order_id: r.orderId,
        // Schema CHECK enforces the set; cast is safe at the type boundary.
        status: r.status as LedgerRow["status"],
        attributes: (r.attributes as Record<string, unknown> | null) ?? null,
        synced_at: r.syncedAt,
        created_at: r.createdAt,
        updated_at: r.updatedAt,
      }));
    },

    async listOpenOrPending(
      opts?: ListOpenOrPendingOptions
    ): Promise<LedgerRow[]> {
      const olderThanMs = opts?.olderThanMs ?? 30_000;
      const limit = opts?.limit ?? 200;

      const rows = await deps.db
        .select()
        .from(polyCopyTradeFills)
        .where(
          and(
            sql`${polyCopyTradeFills.status} IN ('pending','open')`,
            sql`${polyCopyTradeFills.createdAt} < now() - make_interval(secs => ${olderThanMs} / 1000.0)`
          )
        )
        .orderBy(polyCopyTradeFills.createdAt)
        .limit(limit);

      return rows.map((r) => ({
        target_id: r.targetId,
        fill_id: r.fillId,
        observed_at: r.observedAt,
        client_order_id: r.clientOrderId,
        order_id: r.orderId,
        status: r.status as LedgerRow["status"],
        attributes: (r.attributes as Record<string, unknown> | null) ?? null,
        synced_at: r.syncedAt,
        created_at: r.createdAt,
        updated_at: r.updatedAt,
      }));
    },

    async updateStatus(input: UpdateStatusInput): Promise<void> {
      // Build the attributes patch only for the fields actually provided.
      const patch: Record<string, unknown> = {};
      if (input.filled_size_usdc !== undefined) {
        patch.filled_size_usdc = input.filled_size_usdc;
      }
      if (input.reason !== undefined) {
        patch.reason = input.reason;
      }

      await deps.db
        .update(polyCopyTradeFills)
        .set({
          status: input.status,
          ...(input.order_id !== undefined ? { orderId: input.order_id } : {}),
          updatedAt: new Date(),
          ...(Object.keys(patch).length > 0
            ? {
                attributes: sql`COALESCE(${polyCopyTradeFills.attributes}, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb`,
              }
            : {}),
        })
        .where(eq(polyCopyTradeFills.clientOrderId, input.client_order_id));
    },

    async markSynced(client_order_ids: string[]): Promise<void> {
      // No-op on empty array — avoids a vacuous UPDATE that touches no rows.
      if (client_order_ids.length === 0) return;
      await deps.db
        .update(polyCopyTradeFills)
        .set({ syncedAt: sql`now()` })
        .where(inArray(polyCopyTradeFills.clientOrderId, client_order_ids));
    },

    async syncHealthSummary(): Promise<SyncHealthSummary> {
      // Single round-trip: three filtered aggregates in one SELECT.
      // oldest_ms — age of least-recently-synced row that HAS synced_at.
      //   Only rows with non-null synced_at qualify; never-synced rows are
      //   counted separately in never_synced.
      // stale_60s — rows whose synced_at is older than 60 seconds.
      // never_synced — rows with NULL synced_at.
      const rows = await deps.db.execute(
        sql<{
          oldest_ms: string | null;
          stale_60s: string;
          never_synced: string;
        }>`
          SELECT
            CAST(
              EXTRACT(EPOCH FROM (now() - MIN(${polyCopyTradeFills.syncedAt})))
              * 1000
              AS bigint
            ) AS oldest_ms,
            COUNT(*) FILTER (
              WHERE ${polyCopyTradeFills.syncedAt} IS NOT NULL
                AND ${polyCopyTradeFills.syncedAt} < now() - interval '60 seconds'
            ) AS stale_60s,
            COUNT(*) FILTER (
              WHERE ${polyCopyTradeFills.syncedAt} IS NULL
            ) AS never_synced
          FROM ${polyCopyTradeFills}
        `
      );

      const row = rows.rows[0] as
        | { oldest_ms: string | null; stale_60s: string; never_synced: string }
        | undefined;

      return {
        oldest_synced_row_age_ms:
          row?.oldest_ms != null ? Number(row.oldest_ms) : null,
        rows_stale_over_60s: Number(row?.stale_60s ?? 0),
        rows_never_synced: Number(row?.never_synced ?? 0),
      };
    },
  };
}

/**
 * Receipt `status` → ledger `status`. `OrderReceipt.status` is a narrower,
 * polymarket-shaped enum; map to the ledger's canonical set.
 */
function mapReceiptStatus(
  receiptStatus: import("@cogni/market-provider").OrderReceipt["status"]
): LedgerRow["status"] {
  switch (receiptStatus) {
    case "filled":
      return "filled";
    case "partial":
      return "partial";
    case "canceled":
      return "canceled";
    case "open":
      return "open";
    default:
      // `unknown` / future additions fall through to `open` — CLOB accepted
      // it; surface it as live in the ledger until further state arrives.
      return "open";
  }
}
