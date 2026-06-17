// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@app/api/v1/nodes/[id]/observability-token`
 * Purpose: v0 of north-star ② (task.5025) — a developer-RBAC'd dev self-serves the observability
 *   READ credential for their node so they can query their deployment's Grafana/Loki **directly**.
 *   This unblocks the "did my node's runs emit logs in Loki?" verification rung that assertLive
 *   deliberately does NOT self-query (the operator is an ISSUER here, never a query proxy).
 * Scope: Thin HTTP shell — Cogni-token auth, developer-RBAC gate (SAME `node.flight` tuple as flight),
 *   resolve {id} via dev1's registry, hand back the operator's env-held shared Viewer token. No
 *   cluster/GH auth. v0 credential is env-wide (NOT node-scoped); per-node isolation is vNext.
 * Invariants:
 *   - COGNI_TOKEN_ONLY (Bearer-first); DEVELOPER_GATED (`node.flight`); fail-closed without a store.
 *   - ISSUER_NOT_PROXY: returns a credential the dev queries with directly; never proxies a query.
 *   - GRACEFUL_UNWIRED: 503 `observability_unwired` until ESO wires the shared token (no fake pass).
 *   - TOKEN_NEVER_LOGGED: bare GET (no body logging); the token rides the authed response only.
 * Side-effects: IO (registry read, authz check)
 * Links: src/features/nodes/observability-access.ts, docs/spec/grafana-observability-access.md,
 *   docs/spec/substrate-access-grant.md, flight-status/route.ts (same tuple), task.5025
 * @public
 */

import type { AuthzDecisionCode } from "@cogni/authorization-core";
import { NextResponse } from "next/server";

import { getSessionUser } from "@/app/_lib/auth/session";
import { getContainer, resolveNodeRegistry } from "@/bootstrap/container";
import { resolveObservabilityAccess } from "@/features/nodes/observability-access";
import { serverEnv } from "@/shared/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  // Consume dev1's registry: match {id} as either the repo-spec nodeId (UUID) or the slug.
  const summaries = await resolveNodeRegistry().listPublic();
  const node = summaries.find((n) => n.nodeId === id || n.slug === id);
  if (!node?.nodeId) {
    return NextResponse.json({ error: "node_not_found" }, { status: 404 });
  }

  // Developer-gated: the SAME `node.flight` tuple as flight. Fail-closed (deny) without a store.
  const authorization = getContainer().authorization;
  if (!authorization) {
    return NextResponse.json({ error: "authz_unavailable" }, { status: 503 });
  }
  const decision = await authorization.check({
    actorId: `user:${sessionUser.id}`,
    action: "node.flight",
    resource: `node:${node.nodeId}`,
    context: { tenantId: node.nodeId, nodeId: node.nodeId },
  });
  if (decision.decision !== "allow") {
    const code: AuthzDecisionCode = decision.code;
    return NextResponse.json(
      { error: code },
      { status: code === "authz_unavailable" ? 503 : 403 }
    );
  }

  const env = serverEnv();
  const access = resolveObservabilityAccess({
    grafanaUrl: env.GRAFANA_URL,
    viewerToken: env.GRAFANA_VIEWER_TOKEN,
  });
  if (access.status === "unwired") {
    return NextResponse.json(
      {
        error: "observability_unwired",
        message:
          "operator holds no Grafana viewer token in this env — ESO wire of " +
          "cogni/<env>/_shared/{GRAFANA_URL,GRAFANA_SERVICE_ACCOUNT_TOKEN} is pending",
      },
      { status: 503 }
    );
  }

  return NextResponse.json({
    nodeId: node.nodeId,
    slug: node.slug,
    grafanaUrl: access.grafanaUrl,
    token: access.token,
    scope: access.scope,
    isolation: access.isolation,
    caveat: access.caveat,
  });
}
