// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/credits/AiCreditsPanel`
 * Purpose: AI credits balance + USDC top-up panel. Lifted verbatim from the
 *   former single-column credits page body so the Money page can compose it
 *   alongside the Trading Wallet panel.
 * Scope: Client component. Fetches credits summary + drives the USDC payment
 *   flow via React Query. Does not own page layout or nav.
 * Invariants: Payment amounts stored as integer cents (no float math).
 * Side-effects: IO (fetch API via React Query).
 * Links: docs/spec/payments-design.md
 * @public
 */

"use client";

import { isValidAmountInput, parseDollarsToCents } from "@cogni/node-shared";
import { useQueryClient } from "@tanstack/react-query";
import { Info } from "lucide-react";
import type { ReactElement } from "react";
import { useState } from "react";
import {
  Card,
  HintText,
  SectionCard,
  SplitInput,
  UsdcPaymentFlow,
} from "@/components";
import {
  creditsToUsd,
  useCreditsSummary,
  usePaymentFlow,
} from "@/features/payments/public";

function formatDollars(credits: number): string {
  const dollars = creditsToUsd(credits);
  return dollars.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function AiCreditsPanel(): ReactElement {
  const [amountInput, setAmountInput] = useState<string>("");
  const queryClient = useQueryClient();

  const summaryQuery = useCreditsSummary({ limit: 1 });

  const amountCents = parseDollarsToCents(amountInput);
  const isValidAmount = amountCents !== null;

  const paymentFlow = usePaymentFlow({
    amountUsdCents: amountCents ?? 200,
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["payments-summary", { limit: 1 }],
      });
    },
  });

  const handleResetAndClear = () => {
    paymentFlow.reset();
    setAmountInput("");
  };

  const balance = summaryQuery.data?.balanceCredits ?? 0;
  const balanceDisplay = summaryQuery.isLoading ? "—" : formatDollars(balance);
  const isNegative = balance < 0;

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex items-center justify-between p-6">
        <span
          className={`font-bold text-4xl ${isNegative ? "text-destructive" : ""}`}
        >
          $ {balanceDisplay}
        </span>
      </Card>

      <SectionCard title="Buy Credits">
        <SplitInput
          label="Amount"
          value={amountInput}
          onChange={(val) => {
            if (isValidAmountInput(val)) {
              setAmountInput(val);
            }
          }}
          placeholder="2.00 - 100000.00"
          disabled={
            paymentFlow.state.txHash !== null ||
            paymentFlow.state.result !== null
          }
        />

        {isValidAmount ? (
          <UsdcPaymentFlow
            amountUsdCents={amountCents}
            state={paymentFlow.state}
            onStartPayment={paymentFlow.startPayment}
            onReset={handleResetAndClear}
            disabled={summaryQuery.isLoading}
          />
        ) : (
          <button
            type="button"
            disabled
            className="w-full cursor-not-allowed rounded-md bg-muted px-4 py-2 text-muted-foreground"
          >
            Invalid amount
          </button>
        )}

        <HintText icon={<Info size={16} />}>
          Transactions may take many minutes to confirm
        </HintText>
      </SectionCard>
    </div>
  );
}
