// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@features/wallet-analysis/server/current-position-read-model`
 * Purpose: Read the DB-backed current-position inventory for tenant trading
 *   wallets from `poly_trader_current_positions`.
 * Scope: DB read + contract mapping only. Upstream Polymarket paging is owned
 *   by `trader-observation-service`; page-load routes must not call broad
 *   `/positions` directly.
 * Invariants:
 *   - DB_CURRENT_POSITIONS_ARE_PAGELOAD_TRUTH: dashboard overview/execution
 *     use this read model for current exposure.
 *   - OBSERVER_OWNS_UPSTREAM_PAGING: this module performs no Polymarket HTTP.
 *   - COMPLETE_POLLS_DEACTIVATE: missing rows are trusted only because the
 *     observer deactivates them after complete paged polls.
 * Side-effects: DB read only.
 * Links: work/items/task.5007.poly-tenant-current-position-reconciler.md
 * @public
 */

import type {
  WalletExecutionLifecycleState,
  WalletExecutionPosition,
  WalletExecutionPositionStatus,
  WalletExecutionWarning,
} from "@cogni/poly-node-contracts";
import { type SQL, sql } from "drizzle-orm";

type Db = {
  execute(query: SQL): Promise<unknown>;
};

const POSITION_STALE_MS = 10 * 60_000;
const OBSERVATION_SOURCE = "data-api-positions";

type CurrentPositionRow = {
  condition_id: string | null;
  token_id: string | null;
  shares: string | number | null;
  cost_basis_usdc: string | number | null;
  current_value_usdc: string | number | null;
  avg_price: string | number | null;
  last_observed_at: Date | string | null;
  first_observed_at: Date | string | null;
  raw: Record<string, unknown> | null;
  cursor_last_success_at: Date | string | null;
  cursor_status: string | null;
  redeem_status: string | null;
  redeem_lifecycle_state: WalletExecutionLifecycleState | null;
  market_outcome: "winner" | "loser" | "unknown" | null;
  /**
   * `poly_market_metadata` JOIN — canonical Gamma values. Null when the
   * Gamma sweep has not yet seen this conditionId; the per-row code falls
   * back to `raw->>` JSONB-scrape so first deploy doesn't flicker.
   */
  metadata_market_title: string | null;
  metadata_market_slug: string | null;
  metadata_event_title: string | null;
  metadata_event_slug: string | null;
  metadata_end_date: Date | string | null;
};

export interface CurrentWalletPositionReadModel {
  positions: WalletExecutionPosition[];
  summary: {
    positionsMtm: number;
    syncedAt: string | null;
    syncAgeMs: number | null;
    stale: boolean;
    activeRows: number;
  };
  warnings: WalletExecutionWarning[];
}

export async function readCurrentWalletPositionModel(params: {
  db: Db;
  walletAddress: string;
  capturedAt: Date;
}): Promise<CurrentWalletPositionReadModel> {
  const rows = normalizeRows<CurrentPositionRow>(
    await params.db.execute(sql`
      SELECT
        p.condition_id,
        p.token_id,
        p.shares,
        p.cost_basis_usdc,
        p.current_value_usdc,
        p.avg_price,
        p.last_observed_at,
        p.first_observed_at,
        p.raw,
        c.last_success_at AS cursor_last_success_at,
        c.status AS cursor_status,
        r.status AS redeem_status,
        r.lifecycle_state AS redeem_lifecycle_state,
        pmo.outcome AS market_outcome,
        pmm.market_title AS metadata_market_title,
        pmm.market_slug AS metadata_market_slug,
        pmm.event_title AS metadata_event_title,
        pmm.event_slug AS metadata_event_slug,
        pmm.end_date AS metadata_end_date
      FROM poly_trader_wallets w
      LEFT JOIN poly_trader_ingestion_cursors c
        ON c.trader_wallet_id = w.id
       AND c.source = ${OBSERVATION_SOURCE}
      LEFT JOIN poly_trader_current_positions p
        ON p.trader_wallet_id = w.id
       AND p.active = true
       AND p.shares > 0
      LEFT JOIN poly_redeem_jobs r
        ON lower(r.funder_address) = lower(w.wallet_address)
       AND lower(r.condition_id) = lower(p.condition_id)
       AND r.position_id = p.token_id
      LEFT JOIN poly_market_outcomes pmo
        ON lower(pmo.condition_id) = lower(p.condition_id)
       AND pmo.token_id = p.token_id
      LEFT JOIN poly_market_metadata pmm
        ON pmm.condition_id = p.condition_id
      WHERE lower(w.wallet_address) = lower(${params.walletAddress})
        AND w.kind = 'cogni_wallet'
        AND w.active_for_research = true
        AND w.disabled_at IS NULL
      ORDER BY p.current_value_usdc DESC NULLS LAST, p.last_observed_at DESC NULLS LAST
    `)
  );

  const positions = rows.flatMap((row) =>
    rowToExecutionPosition(row, params.capturedAt)
  );
  const syncTimes = rows
    .map(
      (row) =>
        dateToMs(row.cursor_last_success_at) ?? dateToMs(row.last_observed_at)
    )
    .filter((time): time is number => time !== null);
  const latestSyncMs = syncTimes.length > 0 ? Math.max(...syncTimes) : null;
  const syncAgeMs =
    latestSyncMs === null
      ? null
      : Math.max(0, params.capturedAt.getTime() - latestSyncMs);
  const cursorStatus = rows.find(
    (row) => row.cursor_status !== null
  )?.cursor_status;
  const stale =
    rows.length > 0 &&
    (syncAgeMs === null ||
      syncAgeMs > POSITION_STALE_MS ||
      cursorStatus === "partial" ||
      cursorStatus === "error");
  const warnings: WalletExecutionWarning[] = [];
  if (rows.length === 0) {
    warnings.push({
      code: "current_positions_wallet_missing",
      message:
        "No active DB observer wallet row is available for this trading wallet.",
    });
  } else if (stale) {
    warnings.push({
      code: "current_positions_stale",
      message:
        cursorStatus === "partial"
          ? "Current positions are from a partial upstream position poll."
          : "Current-position read model is older than the freshness window.",
    });
  }

  return {
    positions,
    summary: {
      positionsMtm: roundToCents(
        positions.reduce((sum, position) => sum + position.currentValue, 0)
      ),
      syncedAt:
        latestSyncMs !== null ? new Date(latestSyncMs).toISOString() : null,
      syncAgeMs,
      stale,
      activeRows: positions.length,
    },
    warnings,
  };
}

function rowToExecutionPosition(
  row: CurrentPositionRow,
  capturedAt: Date
): WalletExecutionPosition[] {
  if (row.condition_id === null || row.token_id === null) return [];
  const raw = isRecord(row.raw) ? row.raw : {};
  const shares = toNumber(row.shares);
  const currentValue = toNumber(row.current_value_usdc);
  if (shares <= 0 || currentValue < 0) return [];
  const costBasis = toNumber(row.cost_basis_usdc);
  const avgPrice = positiveOrNull(toNumber(row.avg_price));
  const currentPrice =
    positiveOrNull(readNumber(raw, "curPrice")) ??
    positiveOrNull(currentValue / shares) ??
    0;
  const entryPrice =
    avgPrice ?? positiveOrNull(costBasis / shares) ?? currentPrice;
  const observedAt =
    isoOrNull(row.last_observed_at) ?? capturedAt.toISOString();
  const openedAt =
    isoOrNull(row.first_observed_at) ??
    isoOrNull(row.last_observed_at) ??
    capturedAt.toISOString();
  // Canonical resolution time: poly_market_metadata.end_date (Gamma).
  // Fall back to the legacy `raw.endDate` JSONB scrape so the first deploy
  // (where the metadata table has not yet been populated by the tick) does
  // not regress the dashboard. The fallback can be dropped in a follow-up
  // once `poly_market_metadata` is fully backfilled in prod.
  const endDate =
    isoOrNull(row.metadata_end_date) ??
    isoString(readOptionalString(raw, "endDate"));
  const pnlUsd = roundToCents(currentValue - costBasis);
  const pnlPct = costBasis > 0 ? roundToCents((pnlUsd / costBasis) * 100) : 0;
  const syncAgeMs = Math.max(0, capturedAt.getTime() - Date.parse(observedAt));
  const status = deriveCurrentPositionStatus({
    currentValue,
    marketOutcome: row.market_outcome,
    lifecycleState: row.redeem_lifecycle_state,
  });
  const terminalTs = status === "closed" ? observedAt : null;

  return [
    {
      positionId: `${row.condition_id}:${row.token_id}`,
      conditionId: row.condition_id,
      asset: row.token_id,
      // `??` only falls through on null/undefined, so a Gamma row that
      // landed with `marketTitle = ""` would render as empty instead of
      // hitting the JSONB fallback. `nonEmpty` collapses both null and ""
      // to undefined; mirrors the SQL `NULLIF(pmm.col, '')` pattern used
      // in `market-exposure-service.ts`.
      marketTitle:
        nonEmpty(row.metadata_market_title) ??
        readOptionalString(raw, "title") ??
        "Polymarket",
      eventTitle:
        nonEmpty(row.metadata_event_title) ??
        readOptionalString(raw, "eventTitle") ??
        null,
      marketSlug:
        nonEmpty(row.metadata_market_slug) ??
        readOptionalString(raw, "slug") ??
        null,
      eventSlug:
        nonEmpty(row.metadata_event_slug) ??
        readOptionalString(raw, "eventSlug") ??
        null,
      marketUrl: marketUrl(raw),
      outcome: readOptionalString(raw, "outcome") ?? "UNKNOWN",
      status,
      lifecycleState: row.redeem_lifecycle_state,
      openedAt,
      closedAt: terminalTs,
      resolvesAt: endDate,
      gameStartTime: null,
      heldMinutes: Math.max(
        0,
        Math.floor((capturedAt.getTime() - Date.parse(openedAt)) / 60_000)
      ),
      entryPrice,
      currentPrice,
      size: roundToPrecision(shares, 4),
      currentValue: status === "closed" ? 0 : roundToCents(currentValue),
      pnlUsd,
      pnlPct,
      syncedAt: observedAt,
      syncAgeMs,
      syncStale: syncAgeMs > POSITION_STALE_MS,
      timeline: [],
      events: [
        { ts: observedAt, kind: "entry", price: entryPrice, shares },
        ...(terminalTs !== null
          ? [
              {
                ts: terminalTs,
                kind: "close" as const,
                price: currentPrice,
                shares,
              },
            ]
          : []),
      ],
    },
  ];
}

/**
 * Classify a current-position row into a single dashboard `status`. (bug.5008)
 *
 * Authority precedence:
 *   1. `marketOutcome === 'loser'` from `poly_market_outcomes` — chain proved
 *      `payoutNumerator === 0` for this asset → `closed`, regardless of stale
 *      Data-API mid-pricing on the row.
 *   2. terminal lifecycle (`redeemed/loser/dust/abandoned/closed`) → `closed`.
 *   3. `marketOutcome === 'winner'` OR `lifecycleState === 'winner'` →
 *      `redeemable`. Either chain outcome (preferred) or ledger lifecycle
 *      (fallback for rare race where redeem job lifecycle was written before
 *      the outcomes UPSERT) qualifies.
 *   4. `currentValue <= 0` → `closed`.
 *   5. else → `open`.
 *
 * Polymarket Data-API `raw.redeemable` is **never** consulted — Polymarket
 * flags both winner AND loser sides as `redeemable=true` once a market
 * resolves, which is what produced the original split-brain.
 */
export function deriveCurrentPositionStatus(input: {
  currentValue: number;
  marketOutcome: "winner" | "loser" | "unknown" | null;
  lifecycleState: WalletExecutionLifecycleState | null;
}): WalletExecutionPositionStatus {
  if (input.marketOutcome === "loser") return "closed";
  if (
    input.lifecycleState === "redeemed" ||
    input.lifecycleState === "loser" ||
    input.lifecycleState === "dust" ||
    input.lifecycleState === "abandoned" ||
    input.lifecycleState === "closed"
  ) {
    return "closed";
  }
  if (input.marketOutcome === "winner" || input.lifecycleState === "winner") {
    return "redeemable";
  }
  if (input.currentValue <= 0) return "closed";
  return "open";
}

function normalizeRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (
    typeof result === "object" &&
    result !== null &&
    "rows" in result &&
    Array.isArray((result as { rows: unknown }).rows)
  ) {
    return (result as { rows: T[] }).rows;
  }
  return [];
}

function marketUrl(raw: Record<string, unknown>): string | null {
  const eventSlug = readOptionalString(raw, "eventSlug");
  const slug = readOptionalString(raw, "slug");
  if (!eventSlug || !slug) return null;
  return `https://polymarket.com/event/${eventSlug}/${slug}`;
}

function isoOrNull(value: Date | string | null): string | null {
  if (value === null) return null;
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function isoString(value: string | undefined): string | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function dateToMs(value: Date | string | null): number | null {
  if (value === null) return null;
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function toNumber(value: string | number | null): number {
  const n = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function readNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function readOptionalString(
  record: Record<string, unknown>,
  key: string
): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Collapse null + empty-string to `undefined` so `??` chains can fall
 * through. Mirrors SQL `NULLIF(value, '')` for the metadata-table reads.
 */
function nonEmpty(value: string | null): string | undefined {
  if (value === null || value.length === 0) return undefined;
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function positiveOrNull(value: number): number | null {
  return Number.isFinite(value) && value > 0 ? value : null;
}

function roundToCents(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundToPrecision(value: number, precision: number): number {
  const scale = 10 ** precision;
  return Math.round(value * scale) / scale;
}
