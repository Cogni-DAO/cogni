// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/(app)/runtimes/dev/page`
 * Purpose: Server entrypoint for the BYO-runtime dev console. Auth-gates and renders the client view.
 * Scope: Server component only; delegates client behavior to RuntimesDevView. Suspense boundary required for useSearchParams().
 * Invariants:
 *   - Auth check runs server-side; unauthenticated users are redirected.
 *   - The page never mints credentials for the local agent — the user's `cogni dev` CLI brought its own tunnel URL via the `?baseUrl=` query string.
 * Side-effects: none (server render only)
 * Links: src/app/(app)/runtimes/dev/view.tsx, docs/research/byo-agent-runtime-bridge.md
 * @public
 */

import { redirect } from "next/navigation";
import type { ReactElement } from "react";
import { Suspense } from "react";

import { getServerSessionUser } from "@/lib/auth/server";

import { RuntimesDevView } from "./view";

export default async function RuntimesDevPage(): Promise<ReactElement> {
  const user = await getServerSessionUser();
  if (!user) {
    redirect("/");
  }
  return (
    <Suspense>
      <RuntimesDevView />
    </Suspense>
  );
}
