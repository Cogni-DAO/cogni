// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

import { PolymarketUserPnlClient } from "@cogni/market-provider/adapters/polymarket";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __setTradingWalletOverviewUserPnlClientForTests,
  getTradingWalletPnlHistory,
} from "@/features/wallet-analysis/server/trading-wallet-overview-service";

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => body,
  } as unknown as Response;
}

describe("trading-wallet-overview-service", () => {
  afterEach(() => {
    __setTradingWalletOverviewUserPnlClientForTests(undefined);
  });

  it("filters all-history points down to YTD", async () => {
    const userPnl = new PolymarketUserPnlClient({
      fetch: vi.fn().mockResolvedValue(
        jsonResponse([
          { t: 1735776000, p: 10 },
          { t: 1738368000, p: 20 },
          { t: 1740787200, p: 30 },
        ])
      ) as unknown as typeof fetch,
    });
    __setTradingWalletOverviewUserPnlClientForTests(userPnl);

    const history = await getTradingWalletPnlHistory({
      address: "0x1111111111111111111111111111111111111111",
      interval: "YTD",
      capturedAt: "2025-04-22T12:00:00.000Z",
    });

    expect(history).toEqual([
      { ts: "2025-01-02T00:00:00.000Z", pnl: 10 },
      { ts: "2025-02-01T00:00:00.000Z", pnl: 20 },
      { ts: "2025-03-01T00:00:00.000Z", pnl: 30 },
    ]);
  });

  it("preserves honest empty histories", async () => {
    const userPnl = new PolymarketUserPnlClient({
      fetch: vi
        .fn()
        .mockResolvedValue(jsonResponse([])) as unknown as typeof fetch,
    });
    __setTradingWalletOverviewUserPnlClientForTests(userPnl);

    await expect(
      getTradingWalletPnlHistory({
        address: "0x1111111111111111111111111111111111111111",
        interval: "1W",
      })
    ).resolves.toEqual([]);
  });
});
