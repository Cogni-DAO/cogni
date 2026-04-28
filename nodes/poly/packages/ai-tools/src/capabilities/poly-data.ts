// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/poly-ai-tools/capabilities/poly-data`
 * Purpose: Shared capability interface for Polymarket Data-API research tools (task.0386).
 * Scope: Contract + output types for `core__poly_data_*` tools. Does not implement transport, does not load env.
 * Invariants:
 *   - NO_NEW_PORT: Research is read-only HTTP; lives in ai-tools/capabilities, not nodes/poly/app/src/ports
 *   - PAGINATION_CONSISTENT: Paginated outputs expose `{ count, hasMore }`
 *   - USER_PARAM_IS_PROXY_WALLET: `user` is validated as 0x40-hex by the tool input schema
 * Side-effects: none (interface only)
 * Links: work/items/task.0386.poly-agent-wallet-research-v0.md
 * @public
 */

export type PolyDataActivityType =
  | "TRADE"
  | "SPLIT"
  | "MERGE"
  | "REDEEM"
  | "REWARD"
  | "CONVERSION";

// ─────────────────────────────────────────────────────────────────────────────
// Output shapes (plain TS — matched by tool outputSchema via Zod)
// ─────────────────────────────────────────────────────────────────────────────

export interface PolyDataPositionsOutput {
  user: string;
  positions: Array<{
    proxyWallet: string;
    asset: string;
    conditionId: string;
    size: number;
    avgPrice: number;
    currentValue: number;
    cashPnl: number;
    percentPnl: number;
    realizedPnl: number;
    title: string;
    eventSlug: string;
    outcome: string;
  }>;
  count: number;
  hasMore: boolean;
}

export interface PolyDataActivityOutput {
  user: string;
  events: Array<{
    type: string;
    timestamp: number;
    conditionId: string;
    side: string;
    size: number;
    price: number;
    title: string;
    eventSlug: string;
    transactionHash: string;
  }>;
  count: number;
  hasMore: boolean;
}

export interface PolyDataValueOutput {
  user: string;
  valueUsdc: number;
  computedAt: string;
}

export interface PolyDataHoldersOutput {
  market: string;
  holders: Array<{
    proxyWallet: string;
    outcome: string;
    outcomeIndex: number;
    amount: number;
    userName: string | null;
  }>;
  count: number;
}

export interface PolyDataMarketTradesOutput {
  market: string;
  trades: Array<{
    proxyWallet: string;
    makerAddress: string;
    takerAddress: string;
    side: "BUY" | "SELL";
    asset: string;
    size: number;
    price: number;
    timestamp: number;
    outcome: string;
  }>;
  count: number;
  hasMore: boolean;
}

export interface PolyDataResolveUsernameOutput {
  profiles: Array<{
    userName: string;
    proxyWallet: string;
    verified: boolean;
  }>;
  count: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Capability interface
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Shared capability for the 6 read-only wallet-research tools.
 *
 * `core__poly_data_help` is static and does NOT consume this capability — it
 * returns a constants object from the tool module itself.
 */
export interface PolyDataCapability {
  getPositions(params: {
    user: string;
    market?: string;
    sizeThreshold?: number;
    limit?: number;
    offset?: number;
  }): Promise<PolyDataPositionsOutput>;

  listActivity(params: {
    user: string;
    type?: PolyDataActivityType;
    side?: "BUY" | "SELL";
    start?: number;
    end?: number;
    limit?: number;
    offset?: number;
  }): Promise<PolyDataActivityOutput>;

  getValue(params: {
    user: string;
    market?: string;
  }): Promise<PolyDataValueOutput>;

  getHolders(params: {
    market: string;
    limit?: number;
  }): Promise<PolyDataHoldersOutput>;

  listMarketTrades(params: {
    market: string;
    takerOnly?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<PolyDataMarketTradesOutput>;

  resolveUsername(params: {
    query: string;
    limit?: number;
  }): Promise<PolyDataResolveUsernameOutput>;
}
