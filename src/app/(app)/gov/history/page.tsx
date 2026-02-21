// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/gov/history/page`
 * Purpose: Server entrypoint for the epoch history page.
 * Scope: Server component only; delegates all client behavior to EpochHistoryView. Does not perform data fetching.
 * Invariants: Auth enforced by (app) layout guard.
 * Side-effects: none (server render only)
 * Links: src/contracts/governance.epoch.v1.contract.ts
 * @public
 */

import type { ReactElement } from "react";

import { EpochHistoryView } from "./view";

export default function EpochHistoryPage(): ReactElement {
  return <EpochHistoryView />;
}
