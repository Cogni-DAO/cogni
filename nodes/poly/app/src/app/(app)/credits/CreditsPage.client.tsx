// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/credits/CreditsPage.client`
 * Purpose: Money page composed of two panels — AI Credits (USDC top-up)
 *   and the Polymarket Trading Wallet (per-tenant Privy wallet balances +
 *   stubbed fund/withdraw). Two columns on desktop; mobile uses Credits /
 *   Wallet pill toggle. Route stays `/credits` so existing links and footer
 *   nav stay stable.
 * Scope: Client layout shell only. Panels own their own data fetching.
 * Invariants: No URL rename — relabel-only per the project charter.
 * Side-effects: none (panels perform their own IO).
 * Links: packages/node-contracts/src/poly.wallet.connection.v1.contract.ts,
 *        packages/node-contracts/src/poly.wallet.balances.v1.contract.ts
 * @public
 */

"use client";

import { type ReactElement, useState } from "react";
import { PageContainer } from "@/components";
import { cn } from "@/shared/util/cn";
import { AiCreditsPanel } from "./AiCreditsPanel";
import { TradingWalletPanel } from "./TradingWalletPanel";

type MobileTab = "credits" | "wallet";

export function CreditsPageClient(): ReactElement {
  const [mobileTab, setMobileTab] = useState<MobileTab>("credits");

  return (
    <PageContainer maxWidth="2xl">
      {/* Mobile toggle — hidden ≥md. Keeps the visual hierarchy minimal: two
          pill-buttons, one active at a time, switching which panel renders. */}
      <div className="mb-4 flex gap-2 md:hidden">
        <button
          type="button"
          onClick={() => setMobileTab("credits")}
          className={cn(
            "flex-1 rounded-md px-3 py-2 font-medium text-sm",
            mobileTab === "credits"
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground"
          )}
          aria-pressed={mobileTab === "credits"}
        >
          AI Credits
        </button>
        <button
          type="button"
          onClick={() => setMobileTab("wallet")}
          className={cn(
            "flex-1 rounded-md px-3 py-2 font-medium text-sm",
            mobileTab === "wallet"
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground"
          )}
          aria-pressed={mobileTab === "wallet"}
        >
          Trading wallet
        </button>
      </div>

      {/* Desktop grid — two columns ≥md; panels stack on mobile with only the
          selected tab visible. */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div className={cn(mobileTab === "credits" ? "" : "hidden md:block")}>
          <AiCreditsPanel />
        </div>
        <div className={cn(mobileTab === "wallet" ? "" : "hidden md:block")}>
          <TradingWalletPanel />
        </div>
      </div>
    </PageContainer>
  );
}
