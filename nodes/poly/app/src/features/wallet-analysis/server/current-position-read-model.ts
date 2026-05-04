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
  WalletExecutionPosition,
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
  raw: Record<string, unknown> | null;
  cursor_last_success_at: Date | string | null;
  cursor_status: string | null;
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
        p.raw,
        c.last_success_at AS cursor_last_success_at,
        c.status AS cursor_status
      FROM poly_trader_wallets w
      LEFT JOIN poly_trader_ingestion_cursors c
        ON c.trader_wallet_id = w.id
       AND c.source = ${OBSERVATION_SOURCE}
      LEFT JOIN poly_trader_current_positions p
        ON p.trader_wallet_id = w.id
       AND p.active = true
       AND p.shares > 0
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
  const endDate = isoString(readOptionalString(raw, "endDate"));
  const pnlUsd = roundToCents(currentValue - costBasis);
  const pnlPct = costBasis > 0 ? roundToCents((pnlUsd / costBasis) * 100) : 0;
  const syncAgeMs = Math.max(0, capturedAt.getTime() - Date.parse(observedAt));
  const status = readBoolean(raw, "redeemable") ? "redeemable" : "open";

  return [
    {
      positionId: `${row.condition_id}:${row.token_id}`,
      conditionId: row.condition_id,
      asset: row.token_id,
      marketTitle: readOptionalString(raw, "title") ?? "Polymarket",
      eventTitle: readOptionalString(raw, "eventTitle") ?? null,
      marketSlug: readOptionalString(raw, "slug") ?? null,
      eventSlug: readOptionalString(raw, "eventSlug") ?? null,
      marketUrl: marketUrl(raw),
      outcome: readOptionalString(raw, "outcome") ?? "UNKNOWN",
      status,
      lifecycleState: null,
      openedAt: observedAt,
      closedAt: null,
      resolvesAt: endDate,
      gameStartTime: null,
      heldMinutes: Math.max(
        0,
        Math.floor((capturedAt.getTime() - Date.parse(observedAt)) / 60_000)
      ),
      entryPrice,
      currentPrice,
      size: roundToPrecision(shares, 4),
      currentValue: roundToCents(currentValue),
      pnlUsd,
      pnlPct,
      syncedAt: observedAt,
      syncAgeMs,
      syncStale: syncAgeMs > POSITION_STALE_MS,
      timeline: [],
      events: [{ ts: observedAt, kind: "entry", price: entryPrice, shares }],
    },
  ];
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

function readBoolean(record: Record<string, unknown>, key: string): boolean {
  return record[key] === true;
}

function readOptionalString(
  record: Record<string, unknown>,
  key: string
): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
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
