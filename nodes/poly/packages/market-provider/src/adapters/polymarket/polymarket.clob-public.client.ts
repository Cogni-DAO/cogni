// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/poly-market-provider/adapters/polymarket/polymarket.clob-public.client`
 * Purpose: Read-only client for the public Polymarket CLOB endpoint `/markets/{conditionId}` — used solely to look up resolution outcomes for wallet-analysis math.
 * Scope: One method (`getMarketResolution`). Does not place orders, does not require auth, does not load env. Distinct from `polymarket.clob.adapter.ts` (which signs orders) — this is a public-read sibling.
 * Invariants: PACKAGES_NO_ENV, READ_ONLY. Returns `null` (not throws) when the upstream fails — callers treat unresolved markets as open positions.
 * Side-effects: IO (HTTP fetch to https://clob.polymarket.com)
 * Links: docs/design/wallet-analysis-components.md, nodes/poly/packages/market-provider/src/analysis/wallet-metrics.ts
 * @public
 */

import type { MarketResolutionInput } from "../../analysis/wallet-metrics.js";

const DEFAULT_CLOB_PUBLIC_BASE_URL = "https://clob.polymarket.com";
const DEFAULT_TIMEOUT_MS = 5_000;

export type ClobMarketResolutionConfig = {
  /** CLOB public base URL (default: https://clob.polymarket.com). */
  readonly baseUrl?: string;
  /** Optional fetch implementation for tests. */
  readonly fetch?: typeof fetch;
  /** Hard per-request timeout (default 5000 ms). */
  readonly timeoutMs?: number;
};

export type ClobPriceHistoryPoint = {
  readonly t: number;
  readonly p: number;
};

export type ClobPriceHistoryParams = {
  readonly startTs?: number;
  readonly endTs?: number;
  readonly fidelity?: number;
  readonly interval?: string;
};

/**
 * Optional structured-log hook for `getPriceHistory`. When supplied, the client
 * emits one `poly.market-price-history.outbound` event per fetch — used to
 * assert PAGE_LOAD_DB_ONLY (task.5018) by tagging the caller component
 * (e.g. `trader-price-history`).
 */
export interface PriceHistoryOutboundLogger {
  info(payload: {
    event: "poly.market-price-history.outbound";
    component: string;
    asset: string;
    interval?: string;
    fidelity?: number;
  }): void;
}

export class PolymarketClobPublicClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(config?: ClobMarketResolutionConfig) {
    this.baseUrl = config?.baseUrl ?? DEFAULT_CLOB_PUBLIC_BASE_URL;
    this.fetchImpl = config?.fetch ?? fetch;
    this.timeoutMs = config?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /**
   * Fetch market resolution shape — used by wallet-metrics math.
   * Returns `null` on any error (network, parse, 4xx/5xx); callers treat
   * missing entries as "still open" — see `computeWalletMetrics`.
   */
  async getMarketResolution(
    conditionId: string
  ): Promise<MarketResolutionInput | null> {
    const url = new URL(`/markets/${conditionId}`, this.baseUrl);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url.toString(), {
        signal: controller.signal,
      });
      if (!response.ok) return null;
      const json = (await response.json()) as Record<string, unknown>;
      const rawTokens =
        (json.tokens as Array<Record<string, unknown>> | undefined) ?? [];
      return {
        closed: Boolean(json.closed),
        tokens: rawTokens.map((t) => ({
          token_id: String(t.token_id),
          winner: Boolean(t.winner),
        })),
      };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  async getPriceHistory(
    asset: string,
    params?: ClobPriceHistoryParams,
    opts?: { logger?: PriceHistoryOutboundLogger; component?: string }
  ): Promise<ClobPriceHistoryPoint[]> {
    const url = new URL("/prices-history", this.baseUrl);
    url.searchParams.set("market", asset);
    url.searchParams.set("interval", params?.interval ?? "max");
    if (params?.fidelity !== undefined) {
      url.searchParams.set("fidelity", String(params.fidelity));
    }
    if (params?.startTs !== undefined) {
      url.searchParams.set("startTs", String(params.startTs));
    }
    if (params?.endTs !== undefined) {
      url.searchParams.set("endTs", String(params.endTs));
    }

    opts?.logger?.info({
      event: "poly.market-price-history.outbound",
      component: opts.component ?? "unknown",
      asset,
      ...(params?.interval !== undefined ? { interval: params.interval } : {}),
      ...(params?.fidelity !== undefined ? { fidelity: params.fidelity } : {}),
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url.toString(), {
        signal: controller.signal,
      });
      if (!response.ok) return [];
      const json = (await response.json()) as {
        history?: Array<{ t?: unknown; p?: unknown }>;
      };
      const history = json.history ?? [];
      return history.flatMap((point) => {
        const t = Number(point.t);
        const p = Number(point.p);
        if (!Number.isFinite(t) || !Number.isFinite(p)) return [];
        return [{ t, p }];
      });
    } catch {
      return [];
    } finally {
      clearTimeout(timer);
    }
  }
}
