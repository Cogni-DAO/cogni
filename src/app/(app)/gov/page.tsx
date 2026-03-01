// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/gov/page`
 * Purpose: Server entrypoint for the protected governance status page.
 * Scope: Server component only; delegates all client-side behavior to GovernanceView. Does not perform data fetching.
 * Invariants: Auth enforced by (app) layout guard.
 * Side-effects: none (server render only)
 * Links: docs/spec/governance-status-api.md
 * @public
 */

import type { ReactElement } from "react";
import { Suspense } from "react";

import { PageSkeleton } from "@/components";

import { GovernanceView } from "./view";

export default function GovernancePage(): ReactElement {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <GovernanceView />
    </Suspense>
  );
}
