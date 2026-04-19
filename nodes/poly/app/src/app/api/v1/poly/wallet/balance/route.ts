// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/v1/poly/wallet/balance`
 * Purpose: HTTP GET — operator EOA balance on Polygon (USDC.e + POL gas) + USDC notional locked in Polymarket open orders.
 * Scope: Thin endpoint — reads via viem (public Polygon RPC) + `polyTradeBundle.capability.listOpenOrders`. Returns contract shape; `stale=true` on partial failure (individual reads throw).
 * Invariants: Amounts in USD, not atomic units. Single operator wallet per pod (HARDCODED_USER).
 * Side-effects: IO (Polygon RPC + Polymarket CLOB).
 * Notes: Authenticated via session. v0 does not cache — each request hits the chain.
 * Links: docs/spec/poly-copy-trade-phase1.md
 * @public
 */

import { polyWalletBalanceOperation } from "@cogni/node-contracts";
import { EVENT_NAMES } from "@cogni/node-shared";
import { NextResponse } from "next/server";
import { createPublicClient, formatUnits, http, parseAbi } from "viem";
import { polygon } from "viem/chains";
import { getSessionUser } from "@/app/_lib/auth/session";
import { getContainer } from "@/bootstrap/container";
import { wrapRouteHandlerWithLogging } from "@/bootstrap/http";
import { serverEnv } from "@/shared/env/server-env";

export const dynamic = "force-dynamic";

/** USDC.e on Polygon mainnet (bridged USDC, the Polymarket quote token). */
const USDC_E_POLYGON = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174" as const;
const ERC20_ABI = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
]);

/** USDC.e has 6 decimals. */
const USDC_DECIMALS = 6;

export const GET = wrapRouteHandlerWithLogging(
  {
    routeId: "poly.wallet.balance",
    auth: { mode: "required", getSessionUser },
  },
  // TODO(HARDCODED_USER): single-operator prototype. Multi-tenant wallet
  // balances land in task.0315 P2 when connection-broker-keyed wallets exist.
  async (ctx, _request, _sessionUser) => {
    const env = serverEnv();
    const operator_address = env.POLY_PROTO_WALLET_ADDRESS as
      | `0x${string}`
      | undefined;

    if (!operator_address) {
      return NextResponse.json(
        polyWalletBalanceOperation.output.parse({
          operator_address:
            "0x0000000000000000000000000000000000000000" as const,
          usdc_available: 0,
          usdc_locked: 0,
          usdc_total: 0,
          pol_gas: 0,
          profile_url: "https://polymarket.com/profile/unconfigured",
          stale: true,
          error_reason: "POLY_PROTO_WALLET_ADDRESS not set",
        })
      );
    }

    const profile_url = `https://polymarket.com/profile/${operator_address.toLowerCase()}`;
    const errors: string[] = [];

    // ── Polygon reads (USDC.e + POL) ─────────────────────────────────────────
    let usdc_available = 0;
    let pol_gas = 0;
    try {
      const client = createPublicClient({ chain: polygon, transport: http() });
      const [usdcRaw, polRaw] = await Promise.all([
        client.readContract({
          address: USDC_E_POLYGON,
          abi: ERC20_ABI,
          functionName: "balanceOf",
          args: [operator_address],
        }),
        client.getBalance({ address: operator_address }),
      ]);
      usdc_available = Number(formatUnits(usdcRaw, USDC_DECIMALS));
      pol_gas = Number(formatUnits(polRaw, 18));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`polygon_read: ${msg}`);
      ctx.log.warn(
        {
          event: EVENT_NAMES.POLY_WALLET_BALANCE_POLYGON_READ_FAILED,
          errorCode: "polygon_read_failed",
          err: msg,
        },
        "polygon balance read failed"
      );
    }

    // ── Polymarket open orders (locked notional) ─────────────────────────────
    let usdc_locked = 0;
    try {
      const container = getContainer();
      const capability = container.polyTradeBundle?.capability;
      if (!capability) {
        errors.push("poly_capability: not configured");
      } else {
        const openOrders = await capability.listOpenOrders();
        usdc_locked = openOrders.reduce((sum, o) => {
          const remaining =
            (o.original_size_shares ?? 0) - (o.filled_size_shares ?? 0);
          return sum + Math.max(remaining, 0) * (o.price ?? 0);
        }, 0);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`poly_open_orders: ${msg}`);
      ctx.log.warn(
        {
          event: EVENT_NAMES.POLY_WALLET_BALANCE_OPEN_ORDERS_FAILED,
          errorCode: "open_orders_read_failed",
          err: msg,
        },
        "polymarket open orders read failed"
      );
    }

    const stale = errors.length > 0;

    return NextResponse.json(
      polyWalletBalanceOperation.output.parse({
        operator_address,
        usdc_available,
        usdc_locked,
        usdc_total: usdc_available + usdc_locked,
        pol_gas,
        profile_url,
        stale,
        error_reason: stale ? errors.join("; ") : null,
      })
    );
  }
);
