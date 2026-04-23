// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/v1/poly/wallets/stats/route`
 * Purpose: Batched per-wallet windowed stats — POST /api/v1/poly/wallets/stats.
 * Scope: Accepts { timePeriod, addresses[] } and returns a stats map keyed by address.
 *        Per-(wallet, timePeriod) results are cached 60s at the capability layer.
 *        Up to 50 addresses per request; fan-out bounded to 4 concurrent capability calls.
 *        Does not place orders or mutate state.
 * Invariants:
 *   - AUTH_REQUIRED: Internal dashboard endpoint; session user must be present.
 *   - CAPABILITY_NOT_ADAPTER: Route calls WalletCapability; never imports the Data API client directly.
 *   - READ_ONLY: Proxies public read-only Polymarket endpoints.
 *   - NO_SECRETS: Polymarket Data API is public — no credentials touched.
 * Side-effects: IO (HTTP via capability)
 * Links: work/items/task.0346, packages/node-contracts/src/poly.wallet-window-stats.v1.contract.ts
 * @public
 */

import {
  WalletWindowStatsBatchRequestSchema,
  WalletWindowStatsBatchSchema,
} from "@cogni/node-contracts";
import { NextResponse } from "next/server";
import pLimit from "p-limit";
import { createWalletCapability } from "@/bootstrap/capabilities/wallet";
import { wrapRouteHandlerWithLogging } from "@/bootstrap/http";
import { getServerSessionUser } from "@/lib/auth/server";

export const dynamic = "force-dynamic";
export const maxDuration = 30; // seconds — 50 wallets × p-limit(4) × ~300ms each

// Capability singleton: survives across requests in the same worker,
// sharing the module-level cache in wallet.ts.
const walletCapability = createWalletCapability();

// Bound outbound fan-out: each wallet call makes 2 HTTP requests (trades + positions).
// 50 addresses × 2 requests = 100 outbound; p-limit(4) keeps it to ≤8 concurrent.
const limiter = pLimit(4);

export const POST = wrapRouteHandlerWithLogging(
  {
    routeId: "poly.wallets.stats",
    auth: { mode: "required", getSessionUser: getServerSessionUser },
  },
  async (_ctx, request) => {
    const body: unknown = await request.json();
    const parsed = WalletWindowStatsBatchRequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.format() },
        { status: 400 }
      );
    }

    const { timePeriod, addresses } = parsed.data;

    const entries = await Promise.all(
      addresses.map((address) =>
        limiter(async () => {
          const stats = await walletCapability.getWalletWindowStats({
            address,
            timePeriod,
          });
          return [address, stats] as const;
        })
      )
    );

    const result = WalletWindowStatsBatchSchema.parse({
      timePeriod,
      stats: Object.fromEntries(entries),
    });

    return NextResponse.json(result);
  }
);
