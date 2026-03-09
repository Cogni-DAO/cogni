// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/work/page`
 * Purpose: Work dashboard page shell — scans filesystem for work items.
 * Scope: Auth check + server-side data loading. Does not implement business logic or modify files.
 * Invariants: Protected route (server-side auth check). MARKDOWN_READONLY.
 * Side-effects: IO (filesystem scan)
 * Links: [WorkDashboardView](./view.tsx), [getWorkItems](../../../lib/work-scanner.ts)
 * @public
 */

import { redirect } from "next/navigation";

import { getServerSessionUser } from "@/lib/auth/server";
import { getWorkItems } from "@/lib/work-scanner";
import { WorkDashboardView } from "./view";

export default async function WorkPage() {
  const user = await getServerSessionUser();
  if (!user) {
    redirect("/");
  }

  const items = await getWorkItems();

  return <WorkDashboardView items={items} />;
}
