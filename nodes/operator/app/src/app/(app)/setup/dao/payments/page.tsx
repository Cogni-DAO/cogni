// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/setup/dao/payments/page`
 * Purpose: Server entrypoint for payment activation. Sources the operator-wallet + DAO addresses
 *   from the local `.cogni/repo-spec.yaml`.
 * Scope: Reads input source; delegates wallet interaction to the client component.
 * Invariants: CHILD_OWNS_OPERATOR_WALLET — payment activation runs in the child node trust domain.
 * Side-effects: IO (filesystem read of repo-spec)
 * Links: docs/spec/node-formation.md, task.5083
 * @public
 */

import type { ReactElement } from "react";

import {
  getDaoTreasuryAddress,
  getOperatorWalletConfig,
} from "@/shared/config";

import { PaymentActivationPageClient } from "./PaymentActivationPage.client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function PaymentActivationPage(): Promise<ReactElement> {
  const operatorWallet = getOperatorWalletConfig();
  const daoTreasury = getDaoTreasuryAddress();

  return (
    <PaymentActivationPageClient
      operatorWalletAddress={operatorWallet?.address ?? null}
      daoTreasuryAddress={daoTreasury ?? null}
    />
  );
}
