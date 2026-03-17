// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/setup/dao/payments/page`
 * Purpose: Server entrypoint for payment activation page; delegates to client component.
 * Scope: Server component only. Does not perform data fetching or transaction logic.
 * Invariants: Requires authenticated session via (app) route group.
 * Side-effects: none
 * Links: docs/spec/node-formation.md
 * @public
 */

import type { ReactElement } from "react";

import { PaymentActivationPageClient } from "./PaymentActivationPage.client";

export default function PaymentActivationPage(): ReactElement {
  return <PaymentActivationPageClient />;
}
