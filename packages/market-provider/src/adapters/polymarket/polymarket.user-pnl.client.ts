// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/market-provider/adapters/polymarket/polymarket.user-pnl.client`
 * Purpose: Read-only client for Polymarket's public user P/L chart service.
 * Scope: HTTP fetch + Zod validation only. Does not read env, persist state,
 *   or write to upstreams.
 * Invariants:
 *   - READ_ONLY: only GET requests against the public P/L endpoint.
 *   - FAILS_CLOSED: malformed upstream payloads throw instead of being silently
 *     reshaped into fake chart points.
 * Side-effects: IO (HTTP fetch to https://user-pnl-api.polymarket.com).
 * Links: docs/design/poly-dashboard-balance-and-positions.md
 * @public
 */

import { z } from "zod";

const DEFAULT_USER_PNL_BASE_URL = "https://user-pnl-api.polymarket.com";
const DEFAULT_TIMEOUT_MS = 5_000;

export const PolymarketUserPnlIntervalSchema = z.enum([
  "6h",
  "12h",
  "1d",
  "1w",
  "1m",
  "all",
  "max",
]);
export type PolymarketUserPnlInterval = z.infer<
  typeof PolymarketUserPnlIntervalSchema
>;

export const PolymarketUserPnlFidelitySchema = z.enum([
  "1h",
  "3h",
  "12h",
  "18h",
  "1d",
]);
export type PolymarketUserPnlFidelity = z.infer<
  typeof PolymarketUserPnlFidelitySchema
>;

export const PolymarketUserPnlPointSchema = z.object({
  t: z.coerce.number().int().nonnegative(),
  p: z.coerce.number(),
});
export type PolymarketUserPnlPoint = z.infer<
  typeof PolymarketUserPnlPointSchema
>;

export const PolymarketUserPnlResponseSchema = z.array(
  PolymarketUserPnlPointSchema
);

export interface PolymarketUserPnlClientConfig {
  baseUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export interface GetUserPnlParams {
  interval: PolymarketUserPnlInterval;
  fidelity?: PolymarketUserPnlFidelity;
}

export class PolymarketUserPnlClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(config?: PolymarketUserPnlClientConfig) {
    this.baseUrl = config?.baseUrl ?? DEFAULT_USER_PNL_BASE_URL;
    this.fetchImpl = config?.fetch ?? fetch;
    this.timeoutMs = config?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async getUserPnl(
    wallet: string,
    params: GetUserPnlParams
  ): Promise<PolymarketUserPnlPoint[]> {
    assertWallet(wallet);

    const url = new URL("/user-pnl", this.baseUrl);
    url.searchParams.set("user_address", wallet);
    url.searchParams.set("interval", params.interval);
    if (params.fidelity) {
      url.searchParams.set("fidelity", params.fidelity);
    }

    const json = await this.fetchJson(url);
    return PolymarketUserPnlResponseSchema.parse(json);
  }

  private async fetchJson(url: URL): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url.toString(), {
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(
          `Polymarket user-pnl API error: ${response.status} ${response.statusText} (${url.pathname})`
        );
      }
      return await response.json();
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new Error(
          `Polymarket user-pnl API timeout after ${this.timeoutMs}ms (${url.pathname})`
        );
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}

function assertWallet(wallet: string): void {
  if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
    throw new Error(`Invalid wallet address: ${wallet}`);
  }
}
