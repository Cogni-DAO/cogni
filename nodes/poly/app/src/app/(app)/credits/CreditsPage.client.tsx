// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/credits/CreditsPage.client`
 * Purpose: Money page composed of two panels — AI Credits (USDC top-up)
 *   and the Polymarket Trading Wallet (per-tenant Privy wallet balances +
 *   the first-user onboarding surface). Two columns only at `lg+` so the
 *   wallet card gets room for its deposit hero; narrower viewports use a
 *   Credits / Wallet pill toggle. Route stays `/credits` so existing links
 *   and footer nav stay stable.
 * Scope: Client layout shell only. Panels own their own data fetching.
 * Invariants:
 *   - No URL rename — relabel-only per the project charter.
 *   - WALLET_BREAKPOINT_LG (task.0365): the two-column grid only kicks in
 *     at `lg` (≥1024px). Below that the wallet card renders at full width
 *     so the deposit address + enable-trading button never cramp.
 * Side-effects: none (panels perform their own IO).
 * Links: packages/node-contracts/src/poly.wallet.connection.v1.contract.ts,
 *        packages/node-contracts/src/poly.wallet.balances.v1.contract.ts,
 *        work/items/task.0365.poly-onboarding-ux-polish-v0-1.md
 * @public
 */

"use client";

import { type ReactElement, useState } from "react";
import { PageContainer } from "@/components";
import { cn } from "@/shared/util/cn";
import { AiCreditsPanel } from "./AiCreditsPanel";
import { OnboardingProgress } from "./OnboardingProgress";
import { TradingWalletPanel } from "./TradingWalletPanel";

type NarrowTab = "credits" | "wallet";

export function CreditsPageClient(): ReactElement {
  // First-user hot path is the trading wallet — default the narrow-viewport
  // tab to Wallet so aspiring users land on deposit + enable flow, not on
  // AI credits. AI credits is a returning-user action.
  const [narrowTab, setNarrowTab] = useState<NarrowTab>("wallet");

  return (
    <PageContainer maxWidth="2xl">
      <OnboardingProgress />

      {/* Narrow-viewport toggle — hidden ≥lg. Keeps the visual hierarchy
          minimal: two pill-buttons, one active at a time, switching which
          panel renders. */}
      <div className="mb-4 flex gap-2 lg:hidden">
        <button
          type="button"
          onClick={() => setNarrowTab("wallet")}
          className={cn(
            "flex-1 rounded-md px-3 py-2 font-medium text-sm transition-colors",
            narrowTab === "wallet"
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground hover:text-foreground"
          )}
          aria-pressed={narrowTab === "wallet"}
        >
          Trading wallet
        </button>
        <button
          type="button"
          onClick={() => setNarrowTab("credits")}
          className={cn(
            "flex-1 rounded-md px-3 py-2 font-medium text-sm transition-colors",
            narrowTab === "credits"
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground hover:text-foreground"
          )}
          aria-pressed={narrowTab === "credits"}
        >
          AI credits
        </button>
      </div>

      {/* Two columns only at lg+ — wallet first so the deposit hero is the
          page's anchor point on desktop too. */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className={cn(narrowTab === "wallet" ? "" : "hidden lg:block")}>
          <TradingWalletPanel />
        </div>
        <div className={cn(narrowTab === "credits" ? "" : "hidden lg:block")}>
          <AiCreditsPanel />
        </div>
      </div>
    </PageContainer>
  );
}
