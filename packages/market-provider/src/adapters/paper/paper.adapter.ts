// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/market-provider/adapters/paper/paper.adapter`
 * Purpose: Paper-trading adapter — simulates order placement against market book snapshots.
 * Scope: Shape frozen in Phase 1 (all methods throw NotImplemented); body lands in Phase 3 (task.0315). Does not hold credentials, does not hit a platform, does not write to DB, does not load env.
 * Invariants:
 *   - ADAPTERS_NOT_IN_CORE, PACKAGES_NO_ENV.
 *   - MARKET_PROVIDER_SHAPE_FROZEN: the constructor signature and method list are stable from P1 on; only bodies change.
 * Side-effects: none (P1 shape; methods throw). Phase 3 will add IO (HTTP fetch for book snapshot) + DB write to `paper_orders`.
 * Links: work/items/task.0315.poly-copy-trade-prototype.md (Phase 3 — Paper-adapter body)
 * @public
 */

import type {
  GetOrderResult,
  OrderIntent,
  OrderReceipt,
} from "../../domain/order.js";
import type {
  ListMarketsParams,
  MarketProvider,
  NormalizedMarket,
} from "../../domain/schemas.js";
import type {
  MarketProviderConfig,
  MarketProviderPort,
} from "../../port/market-provider.port.js";

export interface PaperAdapterConfig extends MarketProviderConfig {
  /**
   * The underlying platform this paper adapter simulates. Labels telemetry +
   * `decisions_total{source=...}` so a paper Kalshi run isn't mis-reported as
   * `polymarket`. Defaults to `polymarket` — P1 only mirrors Polymarket.
   */
  providerIdentity?: MarketProvider;
  /**
   * Delay (seconds) between observed_at and book-snapshot time used to derive
   * the synthetic fill price. Default in P3: 5.
   */
  snapshotDelaySeconds?: number;
  /**
   * Upstream read-only adapter for book snapshots (injected in P3).
   * Typed as the port itself — paper relies on `listMarkets` / book methods added
   * in the Walk phase, NOT on any placement methods.
   */
  readSource?: MarketProviderPort;
}

/**
 * PaperAdapter — Phase 1 stub. All methods throw `NotImplementedError`
 * (a plain `Error` with `name: "NotImplementedError"`). The constructor and
 * method surface are frozen here so container wiring can reference the adapter
 * ahead of Phase 3 landing its body.
 */
export class PaperAdapter implements MarketProviderPort {
  readonly provider: MarketProvider;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- stored when body lands in P3
  private readonly config: PaperAdapterConfig;

  constructor(config: PaperAdapterConfig = {}) {
    this.config = config;
    this.provider = config.providerIdentity ?? "polymarket";
  }

  listMarkets(_params?: ListMarketsParams): Promise<NormalizedMarket[]> {
    return Promise.reject(notImplemented("listMarkets"));
  }

  placeOrder(_intent: OrderIntent): Promise<OrderReceipt> {
    return Promise.reject(notImplemented("placeOrder"));
  }

  cancelOrder(_orderId: string): Promise<void> {
    return Promise.reject(notImplemented("cancelOrder"));
  }

  getOrder(_orderId: string): Promise<GetOrderResult> {
    return Promise.reject(notImplemented("getOrder"));
  }
}

function notImplemented(method: string): Error {
  const err = new Error(
    `PaperAdapter.${method}() is a Phase 1 stub. Body lands in Phase 3 (see task.0315).`
  );
  err.name = "NotImplementedError";
  return err;
}
