// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/credits/TradingWalletWithdrawDialog`
 * Purpose: Poly Money-page adapter for the shared wallet withdrawal flow.
 * Scope: Client component. Supplies Poly asset metadata, balances, API submit
 *   callback, cache invalidation, and Polygonscan tx links to the kit-level
 *   `WithdrawalFlowDialog`.
 * Invariants: DESTINATION_PASTED_V0; no SIWE-wallet defaulting in this slice.
 * Side-effects: IO (fetch API via submit callback; React Query invalidation).
 * Links: nodes/poly/packages/node-contracts/src/poly.wallet.withdraw.v1.contract.ts
 * @public
 */

"use client";

import type {
  PolyWalletBalancesOutput,
  PolyWalletWithdrawalAsset,
  PolyWalletWithdrawOutput,
} from "@cogni/poly-node-contracts";
import { useQueryClient } from "@tanstack/react-query";
import type { ReactElement } from "react";
import {
  type WithdrawalAssetOption,
  WithdrawalFlowDialog,
  type WithdrawalSubmitInput,
  type WithdrawalSubmitResult,
} from "@/components";

async function postWithdrawal(
  input: WithdrawalSubmitInput<PolyWalletWithdrawalAsset>
): Promise<PolyWalletWithdrawOutput> {
  const res = await fetch("/api/v1/poly/wallet/withdraw", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      asset: input.asset,
      destination: input.destination,
      amount_atomic: input.amountAtomic,
      confirmation: {
        asset: input.asset,
        destination: input.confirmationDestination,
        amount_atomic: input.amountAtomic,
        irreversible: true,
      },
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error =
      body && typeof body === "object" && "error" in body
        ? String(body.error)
        : `withdraw failed: ${res.status}`;
    throw new Error(error);
  }
  return body as PolyWalletWithdrawOutput;
}

function polygonScanTx(hash: string): string {
  return `https://polygonscan.com/tx/${hash}`;
}

function polyWithdrawalAssets(
  balances: PolyWalletBalancesOutput | undefined
): readonly WithdrawalAssetOption<PolyWalletWithdrawalAsset>[] {
  return [
    {
      id: "usdc_e",
      label: "USDC.e",
      deliveredLabel: "USDC.e",
      decimals: 6,
      balance: balances?.usdc_e,
    },
    {
      id: "pusd",
      label: "pUSD",
      deliveredLabel: "USDC.e",
      decimals: 6,
      balance: balances?.pusd,
      helperText:
        "pUSD withdrawals unwrap on Polygon and deliver USDC.e to the destination.",
    },
    {
      id: "pol",
      label: "POL",
      deliveredLabel: "POL",
      decimals: 18,
      balance: balances?.pol,
      allowMax: false,
      balanceFractionDigits: 6,
      helperText:
        "Leave some POL in the trading wallet for Polygon transaction fees.",
    },
  ];
}

export function TradingWalletWithdrawDialog({
  balances,
}: {
  balances: PolyWalletBalancesOutput | undefined;
}): ReactElement {
  const queryClient = useQueryClient();

  return (
    <WithdrawalFlowDialog<PolyWalletWithdrawalAsset>
      title="Withdraw trading funds"
      triggerLabel="Withdraw"
      assets={polyWithdrawalAssets(balances)}
      defaultAsset="pusd"
      getTransactionHref={polygonScanTx}
      onSubmit={async (input): Promise<WithdrawalSubmitResult> => {
        const result = await postWithdrawal(input);
        return { txHashes: result.tx_hashes };
      }}
      onSubmitted={() => {
        void queryClient.invalidateQueries({
          queryKey: ["poly-wallet-balances"],
        });
        void queryClient.invalidateQueries({
          queryKey: ["poly-wallet-status"],
        });
      }}
    />
  );
}
