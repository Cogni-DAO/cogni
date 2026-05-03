// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/v1/poly/wallet/withdraw`
 * Purpose: HTTP POST for tenant-scoped trading-wallet withdrawals.
 * Scope: Validates `polyWalletWithdrawOperation`, resolves the caller's
 *   billing account from session auth, then delegates the typed on-chain move
 *   to `PolyTraderWalletPort.withdraw`.
 * Invariants:
 *   - TENANT_SCOPED: source wallet comes from session billing account only.
 *   - NO_GENERIC_SIGNING: route forwards asset enum + amount + destination;
 *     no calldata or arbitrary contract address can enter the adapter.
 *   - IRREVERSIBLE_CONFIRMATION_REQUIRED: duplicated confirmation fields must
 *     exactly match the requested withdrawal before any signing call starts.
 * Side-effects: IO (DB lookup, Privy signing, Polygon transaction).
 * Links: nodes/poly/packages/node-contracts/src/poly.wallet.withdraw.v1.contract.ts,
 *        docs/spec/poly-trader-wallet-port.md
 * @public
 */

import { toUserId } from "@cogni/ids";
import {
  type PolyWalletWithdrawOutput,
  polyWalletWithdrawOperation,
} from "@cogni/poly-node-contracts";
import { NextResponse } from "next/server";
import { getAddress } from "viem";
import { getSessionUser } from "@/app/_lib/auth/session";
import { getContainer } from "@/bootstrap/container";
import { wrapRouteHandlerWithLogging } from "@/bootstrap/http";
import {
  getPolyTraderWalletAdapter,
  WalletAdapterUnconfiguredError,
} from "@/bootstrap/poly-trader-wallet";
import { invalidateWalletAnalysisCaches } from "@/features/wallet-analysis/server/wallet-analysis-service";

export const dynamic = "force-dynamic";

export const POST = wrapRouteHandlerWithLogging(
  {
    routeId: "poly.wallet.withdraw",
    auth: { mode: "required", getSessionUser },
  },
  async (ctx, request, sessionUser) => {
    if (!sessionUser) throw new Error("sessionUser required");

    const rawBody = await request.json().catch(() => ({}));
    const parsed = polyWalletWithdrawOperation.input.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "invalid_request", issues: parsed.error.issues },
        { status: 400 }
      );
    }

    const body = parsed.data;
    const destination = getAddress(body.destination) as `0x${string}`;
    const confirmedDestination = getAddress(
      body.confirmation.destination
    ) as `0x${string}`;
    if (
      body.confirmation.asset !== body.asset ||
      confirmedDestination !== destination ||
      body.confirmation.amount_atomic !== body.amount_atomic
    ) {
      return NextResponse.json(
        { error: "confirmation_mismatch" },
        { status: 400 }
      );
    }

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
      const result = await adapter.withdraw({
        billingAccountId: account.id,
        asset: body.asset,
        destination,
        amountAtomic: BigInt(body.amount_atomic),
        requestedByUserId: sessionUser.id,
      });

      void invalidateWalletAnalysisCaches(result.sourceAddress);

      const payload: PolyWalletWithdrawOutput = {
        asset: result.asset,
        delivered_asset: result.deliveredAsset,
        source_address: result.sourceAddress,
        destination: result.destination,
        amount_atomic: result.amountAtomic.toString(),
        primary_tx_hash: result.primaryTxHash,
        tx_hashes: [...result.txHashes],
      };
      return NextResponse.json(
        polyWalletWithdrawOperation.output.parse(payload)
      );
    } catch (err) {
      const code =
        err && typeof err === "object" && "code" in err
          ? (err as { code: string }).code
          : null;
      if (code === "no_connection") {
        return NextResponse.json(
          { error: "no_active_connection" },
          { status: 409 }
        );
      }
      if (code === "polygon_rpc_unconfigured") {
        return NextResponse.json(
          { error: "polygon_rpc_unconfigured" },
          { status: 503 }
        );
      }
      if (code === "insufficient_balance") {
        return NextResponse.json(
          { error: "insufficient_balance" },
          { status: 409 }
        );
      }
      if (code === "tx_reverted") {
        return NextResponse.json({ error: "tx_reverted" }, { status: 502 });
      }

      ctx.log.error(
        {
          err: err instanceof Error ? err.message : String(err),
          billing_account_id: account.id,
          asset: body.asset,
        },
        "poly.wallet.withdraw.failed"
      );
      return NextResponse.json({ error: "withdraw_failed" }, { status: 502 });
    }
  }
);
