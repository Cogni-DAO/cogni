// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/setup/dao/payments/page`
 * Purpose: Server entrypoint for payment activation — reads repo-spec state and passes to client component.
 * Scope: Reads operator_wallet + cogni_dao from repo-spec. Does not perform transactions.
 * Invariants: Repo-spec is the single source of truth for activation readiness.
 * Side-effects: IO (filesystem read of .cogni/repo-spec.yaml)
 * Links: docs/spec/node-formation.md
 * @public
 */

export const dynamic = "force-dynamic";

import type { ReactElement } from "react";

import {
  getDaoTreasuryAddress,
  getOperatorWalletConfig,
} from "@/shared/config";

import { PaymentActivationPageClient } from "./PaymentActivationPage.client";

export default function PaymentActivationPage(): ReactElement {
  const operatorWallet = getOperatorWalletConfig();
  const daoTreasury = getDaoTreasuryAddress();

  return (
    <PaymentActivationPageClient
      operatorWalletAddress={operatorWallet?.address ?? null}
      daoTreasuryAddress={daoTreasury ?? null}
    />
  );
}
