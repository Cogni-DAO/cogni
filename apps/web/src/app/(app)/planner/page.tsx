// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/planner/page`
 * Purpose: Planner page shell — 24-hour grid view of scheduled graph executions.
 * Scope: Auth check only. Delegates to PlannerView client component.
 * Invariants: Protected route (server-side auth check).
 * Side-effects: IO
 * @public
 */

import { redirect } from "next/navigation";

import { getServerSessionUser } from "@/lib/auth/server";
import { PlannerView } from "./view";

export default async function PlannerPage() {
  const user = await getServerSessionUser();
  if (!user) {
    redirect("/");
  }

  return <PlannerView />;
}
