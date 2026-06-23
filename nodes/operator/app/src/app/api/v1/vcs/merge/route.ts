// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `@app/api/v1/vcs/merge`
 * Purpose: Agent-initiated, operator-executed merge of a green operator-monorepo PR into `main`.
 *   The external agent (e.g. `flock-leader`, read-only on GitHub) can never `gh pr merge`; it
 *   calls this route and the operator GitHub App performs the merge on its behalf — the App is
 *   the sole GitHub-privilege bridge.
 * Scope: Auth → RBAC → CI/state gate → merge. Wraps the existing `VcsCapability.mergePr`; adds NO
 *   deploy-brain / script / workflow logic (freeze-policy compliant).
 * Invariants:
 *   - AUTH_REQUIRED: Bearer token (machine agents) or SIWE session.
 *   - MERGE_AUTHORITY_IS_OPERATOR_NODE: gated on `can_flight` for the OPERATOR node (resolved
 *     server-side by slug), because merging the monorepo is a repo-level operator authority — not
 *     an arbitrary agent-supplied node. NOTE: this gates the single most IRREVERSIBLE repo action
 *     (merge-to-main) on `can_flight`, a deliberate least-privilege concession accepted only
 *     because a dedicated `can_merge` relation needs an OpenFGA model re-bootstrap. A `merger` /
 *     `can_merge` role + scope-to-node + a probation tier (first N merges human-reviewed, then
 *     graduate) is the COMMITTED vNext — this is intentional MVP over-trust.
 *   - NO_REPO_FROM_AGENT: owner/repo are env-resolved (operator's own monorepo), never the body.
 *   - BRANCH_PROTECTION_IS_AUTHORITY: GitHub independently rejects a non-green merge (405); the
 *     `evaluateMergeGate` pre-check is fast-fail UX + clear errors, not the sole gate.
 *   - NO_SEPARATION_OF_DUTIES (V0): autonomous self-merge on green is intended ("no human required
 *     for routine merges"); a second-reviewer policy is vNext. The operator-App execution boundary
 *     is the structural control today.
 *   - CONTRACTS_ARE_TRUTH: input/output parsed through `mergeOperation`.
 * Side-effects: IO (DB read, GitHub REST merge via VcsCapability).
 * Links: packages/node-contracts/src/vcs.merge.v1.contract.ts,
 *   nodes/operator/app/src/features/vcs/merge-gate.ts, docs/spec/development-lifecycle.md
 * @public
 */

import { mergeOperation } from "@cogni/node-contracts";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getSessionUser } from "@/app/_lib/auth/session";
import { stubVcsCapability } from "@/bootstrap/capabilities/vcs";
import { getContainer, resolveServiceDb } from "@/bootstrap/container";
import { wrapRouteHandlerWithLogging } from "@/bootstrap/http";
import { authorizeNodeAction } from "@/features/vcs/authorize-node-action";
import {
  classifyMergeFailure,
  evaluateMergeGate,
} from "@/features/vcs/merge-gate";
import { nodes } from "@/shared/db/nodes";
import { serverEnv } from "@/shared/env";
import { EVENT_NAMES, logEvent } from "@/shared/observability";

export const runtime = "nodejs";

/** Merging the monorepo is the operator node's authority — gate on it, not the body. */
const OPERATOR_NODE_SLUG = "operator";

export const POST = wrapRouteHandlerWithLogging(
  { routeId: "vcs.merge", auth: { mode: "required", getSessionUser } },
  async (ctx, request, sessionUser) => {
    const startedAt = performance.now();
    const durationMs = () => Math.round(performance.now() - startedAt);

    const fail = (
      status: number,
      errorCode: string,
      error: string,
      extra: Record<string, unknown> = {}
    ): NextResponse => {
      const level = status >= 500 ? "error" : "warn";
      ctx.log[level](
        {
          event: EVENT_NAMES.VCS_MERGE_REQUEST_COMPLETE,
          reqId: ctx.reqId,
          routeId: ctx.routeId,
          outcome: "error",
          status,
          errorCode,
          durationMs: durationMs(),
          ...extra,
        },
        EVENT_NAMES.VCS_MERGE_REQUEST_COMPLETE
      );
      return NextResponse.json({ error, errorCode }, { status });
    };

    // 1. Validate input. owner/repo are NOT accepted from the agent.
    const parsed = mergeOperation.input.safeParse(await request.json());
    if (!parsed.success) {
      return fail(400, "validation_error", "Invalid request");
    }
    const { prNumber, method } = parsed.data;

    // 2. Resolve the operator node row (with ownerUserId — needed by the no-OpenFGA fallback).
    const db = resolveServiceDb();
    const node = (
      await db
        .select()
        .from(nodes)
        .where(eq(nodes.slug, OPERATOR_NODE_SLUG))
        .limit(1)
    )[0];
    if (!node) {
      return fail(
        503,
        "operator_node_unresolved",
        "operator node not registered",
        { prNumber }
      );
    }

    // 3. RBAC — reuse can_flight on the operator node (see MERGE_AUTHORITY_IS_OPERATOR_NODE).
    const authz = await authorizeNodeAction({
      sessionUser,
      node,
      action: "node.flight",
    });
    if (!authz.ok) {
      const error =
        authz.errorCode === "authz_unavailable"
          ? "authorization unavailable"
          : authz.errorCode === "billing_account_missing"
            ? "billing account required"
            : "not authorized";
      return fail(authz.status, authz.errorCode, error, { prNumber });
    }

    // 4. VcsCapability configured? (stub throws on use — detect structurally.)
    const vcs = getContainer().vcsCapability;
    if (vcs === stubVcsCapability) {
      return fail(503, "vcs_not_configured", "VCS not configured", {
        prNumber,
      });
    }

    // 5. Merge target = the operator's own monorepo (env-scoped, anti-spoof).
    const env = serverEnv();
    const owner = env.NODE_SUBMODULE_PARENT_OWNER;
    const repo = env.NODE_SUBMODULE_PARENT_REPO;
    if (!owner || !repo) {
      return fail(
        503,
        "merge_target_not_configured",
        "merge target repo not configured",
        { prNumber }
      );
    }

    // 6. CI / state gate (fast-fail; GitHub branch protection is the real backstop).
    const ci = await vcs.getCiStatus({ owner, repo, prNumber });
    const prCtx = {
      prNumber,
      prAuthor: ci.author,
      baseBranch: ci.baseBranch,
      allGreen: ci.allGreen,
    };
    const rejection = evaluateMergeGate(ci);
    if (rejection) {
      return fail(
        rejection.status,
        rejection.errorCode,
        rejection.error,
        prCtx
      );
    }

    // 7. Merge (squash). Classify failure on the surfaced GitHub HTTP status.
    const result = await vcs.mergePr({ owner, repo, prNumber, method });
    if (!result.merged) {
      const f = classifyMergeFailure(result.status, result.message);
      return fail(f.status, f.errorCode, f.error, {
        ...prCtx,
        githubStatus: result.status,
      });
    }

    // 8. Success.
    logEvent(
      ctx.log,
      EVENT_NAMES.VCS_MERGE_REQUEST_COMPLETE,
      {
        reqId: ctx.reqId,
        routeId: ctx.routeId,
        outcome: "success",
        status: 200,
        prNumber,
        prAuthor: ci.author,
        mergeSha8: result.sha?.slice(0, 8),
        durationMs: durationMs(),
      },
      EVENT_NAMES.VCS_MERGE_REQUEST_COMPLETE
    );

    return NextResponse.json(
      mergeOperation.output.parse({
        merged: true,
        prNumber,
        sha: result.sha,
        baseBranch: "main",
        method,
        message: result.message,
      }),
      { status: 200 }
    );
  }
);
