// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/dashboard/_api/fetchTopWallets`
 * Purpose: Client-side fetch for the Top Wallets dashboard card. Calls GET /api/v1/poly/top-wallets.
 * Scope: Data fetching only; returns empty on 404 or TypeError (network offline/CORS); throws on timeout (AbortError) or non-404 HTTP errors so callers can surface an error state.
 * Invariants: Returns WalletTopTradersOutput matching the shared ai-tools schema.
 * Side-effects: IO (HTTP fetch)
 * Links: [route](../../../api/v1/poly/top-wallets/route.ts)
 * @public
 */

import type {
  WalletOrderBy,
  WalletTimePeriod,
  WalletTopTradersOutput,
} from "@cogni/poly-ai-tools";

export interface FetchTopWalletsParams {
  timePeriod: WalletTimePeriod;
  orderBy?: WalletOrderBy;
  limit?: number;
}

const EMPTY = (params: FetchTopWalletsParams): WalletTopTradersOutput => ({
  traders: [],
  timePeriod: params.timePeriod,
  orderBy: params.orderBy ?? "PNL",
  totalCount: 0,
});

const FETCH_TIMEOUT_MS = 10_000;

export async function fetchTopWallets(
  params: FetchTopWalletsParams
): Promise<WalletTopTradersOutput> {
  const qs = new URLSearchParams({ timePeriod: params.timePeriod });
  if (params.orderBy) qs.set("orderBy", params.orderBy);
  if (params.limit) qs.set("limit", String(params.limit));

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(`/api/v1/poly/top-wallets?${qs.toString()}`, {
      signal: controller.signal,
    });
    if (res.ok) {
      return (await res.json()) as WalletTopTradersOutput;
    }
    if (res.status === 404) return EMPTY(params);
    throw new Error(
      `Failed to fetch top wallets: ${res.status} ${res.statusText}`
    );
  } catch (err) {
    if (err instanceof TypeError) return EMPTY(params);
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}
