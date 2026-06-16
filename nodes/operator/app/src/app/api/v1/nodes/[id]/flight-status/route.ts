// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/v1/nodes/[id]/flight-status`
 * Purpose: The substrate VERIFICATION GATE endpoint — GET per-node, per-env proof that a node not only
 *   deployed (serving) but actually carries a real graph run. Lets a dev (or /validate-candidate) catch
 *   the "green-but-dead" class — 200-but-no-Temporal-poller, stale routing, worker-401 — that Argo can't see.
 * Scope: Thin HTTP shell — Cogni-token auth, resolve {id}→slug, derive the root zone, delegate to the
 *   feature verifier with a real-fetch prober. No cluster/GH auth, no business logic here.
 * Invariants: COGNI_TOKEN_ONLY (getSessionUser = Bearer-first); NO_CLUSTER_AUTH; read-only (no mutation).
 * Side-effects: IO (DB read for slug, network probes via the prober)
 * Links: src/features/nodes/flight-status.ts, src/adapters/server/node-flight/node-prober.adapter.ts, task.5021
 * @public
 */

import { NextResponse } from "next/server";

import { getSessionUser } from "@/app/_lib/auth/session";
import { resolveNodeRegistry } from "@/bootstrap/container";
import { createNodeProber } from "@/bootstrap/node-flight.factory";
import { rootDomain, verifyFlightStatus } from "@/features/nodes/flight-status";
import { serverEnv } from "@/shared/env";
import { baseDomain } from "@/shared/node-registry/resolve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Probing three envs (each: serving + a poet completion that may take seconds) can exceed the default.
export const maxDuration = 120;

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(
  _request: Request,
  ctx: RouteParams
): Promise<NextResponse> {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;

  // Consume dev1's registry: match {id} as either the repo-spec nodeId (UUID) or the slug. The registry
  // exposes only PUBLIC node facts, so no owner-gating. (A raw nodes.id query would uuid-cast-error on a
  // slug like "operator" — that 500 is exactly what the candidate-a self-exercise caught.)
  const summaries = await resolveNodeRegistry().listPublic();
  const node = summaries.find((n) => n.nodeId === id || n.slug === id);
  const slug = node?.slug ?? id;

  const apex = baseDomain(serverEnv());
  if (!apex) {
    return NextResponse.json(
      {
        error: "no_base_domain",
        message: "operator DOMAIN/APP_BASE_URL unset",
      },
      { status: 503 }
    );
  }

  const status = await verifyFlightStatus(
    {
      nodeId: node?.nodeId ?? id,
      slug,
      primary: node?.primary ?? slug === "operator",
      baseDomain: rootDomain(apex),
    },
    createNodeProber()
  );

  return NextResponse.json(status);
}
