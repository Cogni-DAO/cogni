// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(admin)/admin/payments/page`
 * Purpose: Server entrypoint for the admin Provider Top-Ups surface. Reads the steward +
 *   operator wallet addresses from repo-spec and hands them to the client control.
 * Scope: Server component. Access gating handled upstream by `(admin)/layout.tsx`.
 * Invariants: Addresses come from repo-spec, never user input. No on-chain action here (client → API).
 * Side-effects: IO (repo-spec read).
 * Links: src/app/(admin)/admin/payments/StewardTopUpCard.client.tsx, docs/design/node-steward-wallet.md
 * @public
 */

import type { ReactElement } from "react";

import { PageContainer } from "@/components";
import {
  getOperatorWalletConfig,
  getStewardWalletConfig,
} from "@/shared/config";

import { StewardTopUpCard } from "./StewardTopUpCard.client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default function StewardPaymentsPage(): ReactElement {
  const steward = getStewardWalletConfig();
  const operatorWallet = getOperatorWalletConfig();

  return (
    <PageContainer maxWidth="3xl">
      <div className="space-y-1">
        <h1 className="font-bold text-2xl tracking-tight">Provider Top-Ups</h1>
        <p className="text-muted-foreground text-sm">
          Manual USDC top-ups for the node's vendor services.
        </p>
      </div>
      <StewardTopUpCard
        stewardAddress={steward?.address ?? null}
        operatorWalletAddress={operatorWallet?.address ?? null}
      />
    </PageContainer>
  );
}
