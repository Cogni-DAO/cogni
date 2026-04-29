// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@app/api/v1/poly/wallet/enable-trading`
 * Purpose: HTTP POST — run the Polymarket on-chain approvals ceremony for the
 *   calling user's trading wallet. Productized task.0355 — supersedes the raw-
 *   PK experiment script `scripts/experiments/approve-polymarket-allowances.ts`.
 *   Idempotent: already-satisfied targets no-op; partial failures return
 *   `ready: false` with per-step state so the Money page can re-render pills.
 * Scope: POST /api/v1/poly/wallet/enable-trading. Session auth only (v0).
 *   Delegates to `PolyTraderWalletPort.ensureTradingApprovals`; never reads
 *   the Privy client or RPC directly.
 * Invariants:
 *   - TENANT_SCOPED: billing account derived from the authenticated user.
 *   - APPROVALS_BEFORE_PLACE: success here is the only event that flips
 *     `poly_wallet_connections.trading_approvals_ready_at` from NULL → now().
 *   - PARTIAL_FAILURE_NEVER_THROWS: step reverts return 200 with `ready:false`.
 *     4xx is reserved for pre-flight errors (no connection, RPC unconfigured).
 *   - IDEMPOTENT_RETRY: POSTing twice is safe — adapter skips satisfied targets.
 * Side-effects: IO (Polygon RPC reads + up to 5 Privy-signed writes; 1 DB
 *   stamp on success).
 * Links: packages/node-contracts/src/poly.wallet.enable-trading.v1.contract.ts,
 *        nodes/poly/packages/wallet/src/port/poly-trader-wallet.port.ts,
 *        docs/spec/poly-trader-wallet-port.md,
 *        work/items/task.0355.poly-trading-wallet-enable-trading.md
 * @public
 */

import { toUserId } from "@cogni/ids";
import {
  type PolyWalletEnableTradingOutput,
  polyWalletEnableTradingOperation,
} from "@cogni/node-contracts";
import { NextResponse } from "next/server";
import { getSessionUser } from "@/app/_lib/auth/session";
import { getContainer } from "@/bootstrap/container";
import { wrapRouteHandlerWithLogging } from "@/bootstrap/http";
import {
  getPolyTraderWalletAdapter,
  WalletAdapterUnconfiguredError,
} from "@/bootstrap/poly-trader-wallet";

export const dynamic = "force-dynamic";

export const POST = wrapRouteHandlerWithLogging(
  {
    routeId: "poly.wallet.enable_trading",
    auth: { mode: "required", getSessionUser },
  },
  async (ctx, _request, sessionUser) => {
    if (!sessionUser) throw new Error("sessionUser required");

    const container = getContainer();
    const account = await container
      .accountsForUser(toUserId(sessionUser.id))
      .getOrCreateBillingAccountForUser({ userId: sessionUser.id });

    let adapter: ReturnType<typeof getPolyTraderWalletAdapter>;
    try {
      adapter = getPolyTraderWalletAdapter(ctx.log);
    } catch (err) {
      if (err instanceof WalletAdapterUnconfiguredError) {
        return NextResponse.json(
          { error: "wallet_adapter_unconfigured" },
          { status: 503 }
        );
      }
      throw err;
    }

    try {
      const result = await adapter.ensureTradingApprovals(account.id);
      const payload: PolyWalletEnableTradingOutput = {
        ready: result.ready,
        address: result.address,
        pol_balance: result.polBalance,
        steps: result.steps.map((s) => ({
          kind: s.kind,
          label: s.label,
          token_contract: s.tokenContract,
          operator: s.operator,
          state: s.state,
          tx_hash: s.txHash,
          error: s.error,
        })),
        ready_at: result.readyAt ? result.readyAt.toISOString() : null,
      };
      return NextResponse.json(
        polyWalletEnableTradingOperation.output.parse(payload)
      );
    } catch (err) {
      // Pre-flight errors are throwns from the adapter with a `.code` tag.
      const code =
        (err as { code?: string } | undefined)?.code ?? "unknown_error";
      if (code === "no_connection") {
        return NextResponse.json(
          { error: "no_active_wallet_connection" },
          { status: 409 }
        );
      }
      if (code === "polygon_rpc_unconfigured") {
        return NextResponse.json(
          { error: "polygon_rpc_unconfigured" },
          { status: 503 }
        );
      }
      ctx.log.error(
        {
          billing_account_id: account.id,
          err: err instanceof Error ? err.message : String(err),
          code,
        },
        "poly.wallet.enable_trading.error"
      );
      return NextResponse.json(
        { error: "enable_trading_failed" },
        { status: 500 }
      );
    }
  }
);
