// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@features/trading/order-ledger`
 * Purpose: Drizzle-backed `OrderLedger` adapter. Reads + writes `poly_copy_trade_fills` + `poly_copy_trade_decisions` (tenant-scoped, RLS enforced when run on `appDb`). Every placement path (agent tool, mirror-coordinator, future WS ingester) reads + writes through this adapter. Callers are responsible for opening `withTenantScope(appDb, createdByUserId, ...)` around per-tenant writes; the cross-tenant mirror-poll enumerator is the only sanctioned BYPASSRLS reader.
 * Scope: Drizzle queries only. Does not build a DB client (caller injects); does not import from `adapters/server/*` (layer boundary); does not know about copy-trade or wallet-watch (TRADING_IS_GENERIC).
 * Invariants:
 *   - TRADING_IS_GENERIC — no imports from `features/copy-trade/` or `features/wallet-watch/`.
 *   - FAIL_CLOSED_ON_SNAPSHOT_READ — `snapshotState` returns zeroes/empty arrays on any DB error and logs at `warn`. Never throws. (bug.0438 dropped the kill-switch read; only cap counters + dedup keys remain.)
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
  polyCopyTradeDecisions,
  polyCopyTradeFills,
} from "@cogni/poly-db-schema/copy-trade";
import {
  and,
  count,
  desc,
  eq,
  gte,
  inArray,
  lt,
  or,
  sql,
  sum,
} from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Logger } from "pino";

import {
  AlreadyRestingError,
  type InsertPendingInput,
  type LedgerCancelReason,
  type LedgerPositionLifecycle,
  type LedgerRow,
  type ListOpenOrPendingOptions,
  type ListRecentOptions,
  type ListTenantPositionsOptions,
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
} from "./order-ledger.types";

/** Dependencies injected at the `bootstrap/container.ts` boundary. */
export interface OrderLedgerDeps {
  /** Drizzle client — BYPASSRLS is fine because these tables are system-owned. */
  db: NodePgDatabase;
  /** Pino logger. Bind `component: "order-ledger"` at the caller if desired. */
  logger: Logger;
}

/** Postgres unique-violation SQLSTATE — partial unique index rejection. */
const PG_UNIQUE_VIOLATION = "23505";

const DEFAULT_LIST_LIMIT = 50;
const nonTerminalPositionLifecycle = sql`(${polyCopyTradeFills.positionLifecycle} IS NULL OR ${polyCopyTradeFills.positionLifecycle} NOT IN ('closed','redeemed','loser','dust','abandoned'))`;
const activeRestingPositionLifecycle = sql`(${polyCopyTradeFills.positionLifecycle} IS NULL OR ${polyCopyTradeFills.positionLifecycle} IN ('unresolved','open','closing'))`;
const notPositionTerminal = sql`${nonTerminalPositionLifecycle} AND ${polyCopyTradeFills.attributes}->>'closed_at' IS NULL`;
const activeRestingPosition = sql`${activeRestingPositionLifecycle} AND ${polyCopyTradeFills.attributes}->>'closed_at' IS NULL`;
const hasPositionLifecycleOrExecution = sql`(
  ${polyCopyTradeFills.positionLifecycle} IS NOT NULL
  OR ${polyCopyTradeFills.status} IN ('filled','partial')
  OR CASE
    WHEN ${polyCopyTradeFills.attributes}->>'filled_size_usdc' ~ '^[0-9]+(\\.[0-9]+)?$'
      THEN (${polyCopyTradeFills.attributes}->>'filled_size_usdc')::numeric
    ELSE 0
  END > 0
)`;

/**
 * Materialize the SQL GROUP BY result rows (numeric fields arrive as strings
 * from postgres-js) into the typed `PositionIntentAggregate` shape consumed
 * by the trading port. Filters rows whose `token_id` JSON-extract returned
 * null. Pure — testable in isolation.
 */
function materializeIntentAggregates(
  rows: Array<{
    market_id: string;
    token_id: string | null;
    net_shares: string;
    gross_usdc_in: string;
    gross_shares_in: string;
  }>
): PositionIntentAggregate[] {
  const out: PositionIntentAggregate[] = [];
  for (const row of rows) {
    if (row.token_id === null) continue;
    out.push({
      market_id: row.market_id,
      token_id: row.token_id,
      net_shares: Number(row.net_shares),
      gross_usdc_in: Number(row.gross_usdc_in),
      gross_shares_in: Number(row.gross_shares_in),
    });
  }
  return out;
}

export function createOrderLedger(deps: OrderLedgerDeps): OrderLedger {
  const log = deps.logger.child({ component: "order-ledger" });

  return {
    async snapshotState(
      target_id: string,
      billing_account_id: string
    ): Promise<StateSnapshot> {
      try {
        // Four concurrent reads — one round-trip to postgres-js, four statements.
        const [spendRows, rateRows, cidRows, positionRows] = await Promise.all([
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
          // Generic per-(market_id, token_id) intent aggregation — net shares
          // + gross USDC-in / shares-in. Intent-based, includes `pending` so
          // within-tick fills see prior placements (per-fill snapshotState +
          // INSERT_BEFORE_PLACE means the prior pending row is committed by
          // the time the next fill snapshots). Mirror semantics overlay (e.g.
          // `our_token_id` / `opposite_token_id`) is computed downstream in
          // `@/features/copy-trade/types::aggregatePositionRows`.
          deps.db
            .select({
              market_id: polyCopyTradeFills.marketId,
              token_id: sql<
                string | null
              >`${polyCopyTradeFills.attributes}->>'token_id'`,
              net_shares: sql<string>`COALESCE(SUM(
                CASE WHEN ${polyCopyTradeFills.attributes}->>'side' = 'BUY'
                       THEN  (${polyCopyTradeFills.attributes}->>'size_usdc')::numeric / NULLIF((${polyCopyTradeFills.attributes}->>'limit_price')::numeric, 0)
                     WHEN ${polyCopyTradeFills.attributes}->>'side' = 'SELL'
                       THEN -((${polyCopyTradeFills.attributes}->>'size_usdc')::numeric / NULLIF((${polyCopyTradeFills.attributes}->>'limit_price')::numeric, 0))
                     ELSE 0 END
              ), 0)`,
              gross_usdc_in: sql<string>`COALESCE(SUM(
                CASE WHEN ${polyCopyTradeFills.attributes}->>'side' = 'BUY'
                       THEN (${polyCopyTradeFills.attributes}->>'size_usdc')::numeric
                     ELSE 0 END
              ), 0)`,
              gross_shares_in: sql<string>`COALESCE(SUM(
                CASE WHEN ${polyCopyTradeFills.attributes}->>'side' = 'BUY'
                       THEN (${polyCopyTradeFills.attributes}->>'size_usdc')::numeric / NULLIF((${polyCopyTradeFills.attributes}->>'limit_price')::numeric, 0)
                     ELSE 0 END
              ), 0)`,
            })
            .from(polyCopyTradeFills)
            .where(
              and(
                eq(polyCopyTradeFills.targetId, target_id),
                inArray(polyCopyTradeFills.status, [
                  "pending",
                  "open",
                  "filled",
                  "partial",
                ]),
                activeRestingPosition
              )
            )
            .groupBy(
              polyCopyTradeFills.marketId,
              sql`${polyCopyTradeFills.attributes}->>'token_id'`
            ),
        ]);

        const today_spent_usdc = Number(spendRows[0]?.spent ?? 0);
        const fills_last_hour = Number(rateRows[0]?.n ?? 0);
        const already_placed_ids = cidRows.map((r) => r.cid);
        const position_aggregates = materializeIntentAggregates(positionRows);

        return {
          today_spent_usdc,
          fills_last_hour,
          already_placed_ids,
          position_aggregates,
        };
      } catch (err: unknown) {
        // FAIL_CLOSED — any error returns the fail-closed snapshot.
        log.warn(
          {
            event: EVENT_NAMES.ADAPTER_ORDER_LEDGER_SNAPSHOT_ERROR,
            errorCode: "snapshot_fail_closed",
            target_id,
            billing_account_id,
            err: err instanceof Error ? err.message : String(err),
          },
          "order-ledger snapshot failed; returning zeroes"
        );
        return {
          today_spent_usdc: 0,
          fills_last_hour: 0,
          already_placed_ids: [],
          position_aggregates: [],
        };
      }
    },

    async cumulativeIntentForMarket(
      billing_account_id: string,
      market_id: string
    ): Promise<number> {
      try {
        const rows = await deps.db
          .select({
            sum: sum(
              sql<string>`COALESCE((${polyCopyTradeFills.attributes}->>'size_usdc')::numeric, 0)`
            ),
          })
          .from(polyCopyTradeFills)
          .where(
            and(
              eq(polyCopyTradeFills.billingAccountId, billing_account_id),
              eq(polyCopyTradeFills.marketId, market_id),
              activeRestingPosition,
              // bug.0430: `error` rows count toward the cap ONLY when the
              // intent was a FOK market order. FOK has a real broadcast race
              // (CLOB returns error but on-chain CTF can still mint), so
              // pessimistic inclusion is correctness, not paranoia. Limit
              // orders that error are CLOB-rejected at the API boundary
              // before any on-chain effect — including them was bug.0430's
              // overreach against task.5001's new code path. Status terminal
              // for `canceled` is already excluded.
              or(
                inArray(polyCopyTradeFills.status, [
                  "pending",
                  "open",
                  "filled",
                  "partial",
                ]),
                and(
                  eq(polyCopyTradeFills.status, "error"),
                  sql`${polyCopyTradeFills.attributes}->>'placement' = 'market_fok'`
                )
              )
            )
          );
        return Number(rows[0]?.sum ?? 0);
      } catch (err: unknown) {
        log.warn(
          {
            event: EVENT_NAMES.ADAPTER_ORDER_LEDGER_SNAPSHOT_ERROR,
            errorCode: "cumulative_intent_fail_closed",
            billing_account_id,
            market_id,
            err: err instanceof Error ? err.message : String(err),
          },
          "order-ledger cumulativeIntentForMarket failed; returning Infinity (skip placement)"
        );
        return Number.POSITIVE_INFINITY;
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
        // task.5001: persist placement on the row so cumulativeIntentForMarket
        // can distinguish limit-order errors (no CTF risk) from FOK errors
        // (broadcast race — CTF can mint despite CLOB error). Without this
        // field the cap-logic fallback assumes worst-case (FOK) for any error.
        placement:
          typeof input.intent.attributes?.placement === "string"
            ? input.intent.attributes.placement
            : undefined,
        token_id:
          typeof input.intent.attributes?.token_id === "string"
            ? input.intent.attributes.token_id
            : undefined,
        condition_id:
          typeof input.intent.attributes?.condition_id === "string"
            ? input.intent.attributes.condition_id
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
        slug:
          typeof input.intent.attributes?.slug === "string"
            ? input.intent.attributes.slug
            : undefined,
        event_slug:
          typeof input.intent.attributes?.event_slug === "string"
            ? input.intent.attributes.event_slug
            : undefined,
        event_title:
          typeof input.intent.attributes?.event_title === "string"
            ? input.intent.attributes.event_title
            : undefined,
        end_date:
          typeof input.intent.attributes?.end_date === "string"
            ? input.intent.attributes.end_date
            : undefined,
        game_start_time:
          typeof input.intent.attributes?.game_start_time === "string"
            ? input.intent.attributes.game_start_time
            : undefined,
        transaction_hash:
          typeof input.intent.attributes?.transaction_hash === "string"
            ? input.intent.attributes.transaction_hash
            : undefined,
      };

      try {
        await deps.db
          .insert(polyCopyTradeFills)
          .values({
            billingAccountId: input.billing_account_id,
            createdByUserId: input.created_by_user_id,
            targetId: input.target_id,
            fillId: input.fill_id,
            marketId: input.intent.market_id,
            observedAt: input.observed_at,
            clientOrderId: input.intent.client_order_id,
            orderId: null,
            status: "pending",
            positionLifecycle: null,
            attributes: attrs,
          })
          .onConflictDoNothing({
            target: [polyCopyTradeFills.targetId, polyCopyTradeFills.fillId],
          });
      } catch (err: unknown) {
        // Partial unique index rejection → typed AlreadyRestingError. task.5001.
        if (
          typeof err === "object" &&
          err !== null &&
          "code" in err &&
          (err as { code: unknown }).code === PG_UNIQUE_VIOLATION
        ) {
          throw new AlreadyRestingError(
            input.billing_account_id,
            input.target_id,
            input.intent.market_id
          );
        }
        throw err;
      }
    },

    async markOrderId(params: {
      client_order_id: string;
      receipt: import("@cogni/poly-market-provider").OrderReceipt;
    }): Promise<void> {
      // Update by `client_order_id` — unique-by-construction across rows since
      // cid is deterministic from `(target_id, fill_id)` (PK).
      const status: LedgerRow["status"] = mapReceiptStatus(
        params.receipt.status
      );
      const positionLifecycle = lifecycleFromOrderUpdate(
        status,
        params.receipt.filled_size_usdc
      );
      await deps.db
        .update(polyCopyTradeFills)
        .set({
          orderId: params.receipt.order_id,
          status,
          ...(positionLifecycle !== null
            ? {
                positionLifecycle: preserveTerminalLifecycle(positionLifecycle),
              }
            : {}),
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
        billingAccountId: input.billing_account_id,
        createdByUserId: input.created_by_user_id,
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

      return rows.map(mapLedgerRow);
    },

    async listTenantPositions(
      opts: ListTenantPositionsOptions
    ): Promise<LedgerRow[]> {
      const limit = opts.limit ?? DEFAULT_LIST_LIMIT;
      const statuses = opts.statuses ?? ["open", "filled", "partial"];

      const rows = await deps.db
        .select()
        .from(polyCopyTradeFills)
        .where(
          and(
            eq(polyCopyTradeFills.billingAccountId, opts.billing_account_id),
            inArray(polyCopyTradeFills.status, statuses)
          )
        )
        .orderBy(desc(polyCopyTradeFills.observedAt))
        .limit(limit);

      return rows.map(mapLedgerRow);
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
            activeRestingPosition,
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
        position_lifecycle:
          (r.positionLifecycle as LedgerPositionLifecycle | null) ?? null,
        attributes: (r.attributes as Record<string, unknown> | null) ?? null,
        synced_at: r.syncedAt,
        created_at: r.createdAt,
        updated_at: r.updatedAt,
        billing_account_id: r.billingAccountId,
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
      const positionLifecycle = lifecycleFromOrderUpdate(
        input.status,
        input.filled_size_usdc
      );

      await deps.db
        .update(polyCopyTradeFills)
        .set({
          status: input.status,
          ...(input.order_id !== undefined ? { orderId: input.order_id } : {}),
          ...(positionLifecycle !== null
            ? {
                positionLifecycle: preserveTerminalLifecycle(positionLifecycle),
              }
            : {}),
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

    async markCanceled(params: {
      client_order_id: string;
      reason: LedgerCancelReason;
    }): Promise<void> {
      await deps.db
        .update(polyCopyTradeFills)
        .set({
          status: "canceled",
          updatedAt: new Date(),
          attributes: sql`COALESCE(${polyCopyTradeFills.attributes}, '{}'::jsonb) || ${JSON.stringify(
            { reason: params.reason }
          )}::jsonb`,
        })
        .where(eq(polyCopyTradeFills.clientOrderId, params.client_order_id));
    },

    async markPositionClosedByAsset(
      input: MarkPositionClosedByAssetInput
    ): Promise<number> {
      const rows = await deps.db
        .update(polyCopyTradeFills)
        .set({
          positionLifecycle: "closed",
          updatedAt: input.closed_at,
          attributes: sql`COALESCE(${polyCopyTradeFills.attributes}, '{}'::jsonb) || ${JSON.stringify(
            {
              closed_at: input.closed_at.toISOString(),
              close_order_id: input.close_order_id,
              close_client_order_id: input.close_client_order_id,
              close_reason: input.reason,
            }
          )}::jsonb`,
        })
        .where(
          and(
            eq(polyCopyTradeFills.billingAccountId, input.billing_account_id),
            sql`${polyCopyTradeFills.attributes}->>'token_id' = ${input.token_id}`,
            notPositionTerminal,
            hasPositionLifecycleOrExecution
          )
        )
        .returning({ clientOrderId: polyCopyTradeFills.clientOrderId });
      return rows.length;
    },

    async markPositionLifecycleByAsset(
      input: MarkPositionLifecycleByAssetInput
    ): Promise<number> {
      const incomingLifecycleIsTerminal = [
        "closed",
        "redeemed",
        "loser",
        "dust",
        "abandoned",
      ].includes(input.lifecycle);
      const terminalCorrectionGuard =
        input.terminal_correction === "redeem_reorg" &&
        input.lifecycle === "redeem_pending"
          ? sql`(${notPositionTerminal} OR ${polyCopyTradeFills.positionLifecycle} = 'redeemed')`
          : notPositionTerminal;
      const rows = await deps.db
        .update(polyCopyTradeFills)
        .set({
          positionLifecycle: input.lifecycle,
          updatedAt: input.updated_at,
        })
        .where(
          and(
            eq(polyCopyTradeFills.billingAccountId, input.billing_account_id),
            sql`${polyCopyTradeFills.attributes}->>'token_id' = ${input.token_id}`,
            incomingLifecycleIsTerminal ? undefined : terminalCorrectionGuard,
            hasPositionLifecycleOrExecution
          )
        )
        .returning({ clientOrderId: polyCopyTradeFills.clientOrderId });
      return rows.length;
    },

    async markPositionLifecycleByConditionId(
      input: MarkPositionLifecycleByConditionIdInput
    ): Promise<number> {
      const normalizedMarketId = `prediction-market:polymarket:${input.condition_id}`;
      const incomingLifecycleIsTerminal = [
        "closed",
        "redeemed",
        "loser",
        "dust",
        "abandoned",
      ].includes(input.lifecycle);
      const rows = await deps.db
        .update(polyCopyTradeFills)
        .set({
          positionLifecycle: input.lifecycle,
          updatedAt: input.updated_at,
        })
        .where(
          and(
            eq(polyCopyTradeFills.billingAccountId, input.billing_account_id),
            or(
              sql`${polyCopyTradeFills.attributes}->>'condition_id' = ${input.condition_id}`,
              eq(polyCopyTradeFills.marketId, input.condition_id),
              eq(polyCopyTradeFills.marketId, normalizedMarketId)
            ),
            incomingLifecycleIsTerminal ? undefined : notPositionTerminal,
            hasPositionLifecycleOrExecution
          )
        )
        .returning({ clientOrderId: polyCopyTradeFills.clientOrderId });
      return rows.length;
    },

    async hasOpenForMarket(args: {
      billing_account_id: string;
      target_id: string;
      market_id: string;
    }): Promise<boolean> {
      try {
        const rows = await deps.db
          .select({ cid: polyCopyTradeFills.clientOrderId })
          .from(polyCopyTradeFills)
          .where(
            and(
              eq(polyCopyTradeFills.billingAccountId, args.billing_account_id),
              eq(polyCopyTradeFills.targetId, args.target_id),
              eq(polyCopyTradeFills.marketId, args.market_id),
              activeRestingPosition,
              inArray(polyCopyTradeFills.status, ["pending", "open", "partial"])
            )
          )
          .limit(1);
        return rows.length > 0;
      } catch (err: unknown) {
        // Fail-closed: prefer skip over double-bet on DB error.
        log.warn(
          {
            event: EVENT_NAMES.ADAPTER_ORDER_LEDGER_SNAPSHOT_ERROR,
            errorCode: "has_open_for_market_fail_closed",
            billing_account_id: args.billing_account_id,
            target_id: args.target_id,
            market_id: args.market_id,
            err: err instanceof Error ? err.message : String(err),
          },
          "order-ledger hasOpenForMarket failed; returning true (skip placement)"
        );
        return true;
      }
    },

    async findOpenForMarket(args: {
      billing_account_id: string;
      target_id: string;
      market_id: string;
    }): Promise<OpenOrderRow[]> {
      const rows = await deps.db
        .select({
          clientOrderId: polyCopyTradeFills.clientOrderId,
          orderId: polyCopyTradeFills.orderId,
          status: polyCopyTradeFills.status,
          billingAccountId: polyCopyTradeFills.billingAccountId,
          targetId: polyCopyTradeFills.targetId,
          marketId: polyCopyTradeFills.marketId,
          createdAt: polyCopyTradeFills.createdAt,
        })
        .from(polyCopyTradeFills)
        .where(
          and(
            eq(polyCopyTradeFills.billingAccountId, args.billing_account_id),
            eq(polyCopyTradeFills.targetId, args.target_id),
            eq(polyCopyTradeFills.marketId, args.market_id),
            activeRestingPosition,
            inArray(polyCopyTradeFills.status, ["pending", "open", "partial"])
          )
        );
      return rows.map((r) => ({
        client_order_id: r.clientOrderId,
        order_id: r.orderId,
        status: r.status as LedgerRow["status"],
        billing_account_id: r.billingAccountId,
        target_id: r.targetId,
        market_id: r.marketId,
        created_at: r.createdAt,
      }));
    },

    async findStaleOpen(args: {
      max_age_minutes: number;
    }): Promise<OpenOrderRow[]> {
      const rows = await deps.db
        .select({
          clientOrderId: polyCopyTradeFills.clientOrderId,
          orderId: polyCopyTradeFills.orderId,
          status: polyCopyTradeFills.status,
          billingAccountId: polyCopyTradeFills.billingAccountId,
          targetId: polyCopyTradeFills.targetId,
          marketId: polyCopyTradeFills.marketId,
          createdAt: polyCopyTradeFills.createdAt,
        })
        .from(polyCopyTradeFills)
        .where(
          and(
            inArray(polyCopyTradeFills.status, ["pending", "open", "partial"]),
            activeRestingPosition,
            lt(
              polyCopyTradeFills.createdAt,
              sql`now() - make_interval(mins => ${args.max_age_minutes})`
            )
          )
        );
      return rows.map((r) => ({
        client_order_id: r.clientOrderId,
        order_id: r.orderId,
        status: r.status as LedgerRow["status"],
        billing_account_id: r.billingAccountId,
        target_id: r.targetId,
        market_id: r.marketId,
        created_at: r.createdAt,
      }));
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

function mapLedgerRow(r: typeof polyCopyTradeFills.$inferSelect): LedgerRow {
  return {
    target_id: r.targetId,
    fill_id: r.fillId,
    observed_at: r.observedAt,
    client_order_id: r.clientOrderId,
    order_id: r.orderId,
    // Schema CHECK enforces the set; cast is safe at the type boundary.
    status: r.status as LedgerRow["status"],
    position_lifecycle:
      (r.positionLifecycle as LedgerPositionLifecycle | null) ?? null,
    attributes: (r.attributes as Record<string, unknown> | null) ?? null,
    synced_at: r.syncedAt,
    created_at: r.createdAt,
    updated_at: r.updatedAt,
    billing_account_id: r.billingAccountId,
  };
}

/**
 * Receipt `status` → ledger `status`. `OrderReceipt.status` is a narrower,
 * polymarket-shaped enum; map to the ledger's canonical set.
 */
function mapReceiptStatus(
  receiptStatus: import("@cogni/poly-market-provider").OrderReceipt["status"]
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

function lifecycleFromOrderUpdate(
  status: LedgerRow["status"],
  filledSizeUsdc: number | undefined
): LedgerPositionLifecycle | null {
  if (status === "filled" || status === "partial") return "open";
  if (filledSizeUsdc !== undefined && filledSizeUsdc > 0) return "open";
  return null;
}

function preserveTerminalLifecycle(next: LedgerPositionLifecycle) {
  return sql`CASE
    WHEN ${polyCopyTradeFills.positionLifecycle} IN ('closed','redeemed','loser','dust','abandoned')
      THEN ${polyCopyTradeFills.positionLifecycle}
    ELSE ${next}
  END`;
}
