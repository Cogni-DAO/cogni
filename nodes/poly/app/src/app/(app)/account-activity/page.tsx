// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/account-activity/page`
 * Purpose: Auth-gated entry for the user's full account-activity view.
 * Scope: Server component. Auth check only.
 * Invariants: TENANT_SCOPED via session.
 * Side-effects: IO (session)
 * Links: bug.5000, [view](./view.tsx)
 * @public
 */

import { redirect } from "next/navigation";

import { getServerSessionUser } from "@/lib/auth/server";
import { AccountActivityView } from "./view";

export default async function AccountActivityPage() {
  const user = await getServerSessionUser();
  if (!user) {
    redirect("/");
  }
  return <AccountActivityView />;
}
