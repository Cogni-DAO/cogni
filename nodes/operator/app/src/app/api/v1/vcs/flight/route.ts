// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/v1/vcs/flight`
 * Purpose: CI-gated candidate-a flight request for external AI agents.
 *   Supports PR flights and candidate-only node-ref flights for externally built submodule nodes.
 *   The candidate slot controller (GitHub Actions workflow) owns the actual slot lease
 *   on the deploy branch — this endpoint does not replicate that logic.
 * Scope: Auth → CI gate → dispatch. No lease table. No polling hacks.
 * Invariants:
 *   - AUTH_REQUIRED: Bearer token (machine agents) or SIWE session. No open access.
 *   - CI_GATE: Rejects 422 if CI is not fully green for the PR head SHA.
 *   - OPERATOR_DEPLOY_PLANE: Hosted flight dispatch goes through an operator-local port.
 *   - NODE_REF_CANDIDATE_ONLY: nodeRef dispatch targets candidate-a only; preview/prod are out of scope.
 *   - CONTRACTS_ARE_TRUTH: Input/output parsed through flightOperation contract.
 *   - NO_LEASE_SPLIT_BRAIN: Slot lease lives on the deploy branch (candidate-slot-controller);
 *     this route does not write a competing lease.
 * Side-effects: IO (DB read, GitHub REST API via OperatorDeployPlanePort)
 * Links: task.0370, packages/node-contracts/src/vcs.flight.v1.contract.ts,
 *   docs/spec/development-lifecycle.md
 * @public
 */

import { withTenantScope } from "@cogni/db-client";
import { type UserId, userActor } from "@cogni/ids";
import { flightOperation } from "@cogni/node-contracts";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getSessionUser } from "@/app/_lib/auth/session";
import { createOperatorDeployPlane } from "@/bootstrap/capabilities/operator-deploy-plane";
import { resolveAppDb } from "@/bootstrap/container";
import { wrapRouteHandlerWithLogging } from "@/bootstrap/http";
import type {
  OperatorDeployPlanePort,
  PreparedNodeRefCandidateFlight,
} from "@/ports";
import { getGithubRepo } from "@/shared/config/repoSpec.server";
import { nodes } from "@/shared/db/nodes";
import { type ServerEnv, serverEnv } from "@/shared/env";
import { logRequestWarn, type RequestContext } from "@/shared/observability";

export const runtime = "nodejs";

function handleDispatchError(
  ctx: RequestContext,
  error: unknown
): NextResponse | null {
  if (
    error &&
    typeof error === "object" &&
    "status" in error &&
    (error as { status: number }).status === 404
  ) {
    logRequestWarn(ctx.log, error, "WORKFLOW_NOT_FOUND");
    return NextResponse.json(
      { error: "candidate-flight.yml workflow not found on this repo" },
      { status: 503 }
    );
  }
  return null;
}

function handleDeployPlaneError(error: unknown): NextResponse | null {
  if (
    error &&
    typeof error === "object" &&
    "status" in error &&
    typeof (error as { status: unknown }).status === "number"
  ) {
    const err = error as { status: number; code?: string; message?: string };
    return NextResponse.json(
      {
        error: err.message ?? "node-ref flight preflight failed",
        errorCode: err.code ?? "deploy_plane_error",
      },
      { status: err.status }
    );
  }
  return null;
}

function getNodeRefParentRepo(env: ServerEnv): {
  readonly owner: string;
  readonly repo: string;
} {
  if (!env.NODE_SUBMODULE_PARENT_OWNER || !env.NODE_SUBMODULE_PARENT_REPO) {
    throw new Error(
      "operator not configured for node-ref flight: NODE_SUBMODULE_PARENT_OWNER + NODE_SUBMODULE_PARENT_REPO required"
    );
  }
  return {
    owner: env.NODE_SUBMODULE_PARENT_OWNER,
    repo: env.NODE_SUBMODULE_PARENT_REPO,
  };
}

export const POST = wrapRouteHandlerWithLogging(
  { routeId: "vcs.flight", auth: { mode: "required", getSessionUser } },
  async (ctx, request, sessionUser) => {
    const parsed = flightOperation.input.safeParse(await request.json());
    if (!parsed.success) {
      logRequestWarn(ctx.log, parsed.error, "VALIDATION_ERROR");
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const env = serverEnv();
    let deployPlane: OperatorDeployPlanePort;
    try {
      deployPlane = createOperatorDeployPlane(env);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "deploy plane not configured";
      return NextResponse.json({ error: message }, { status: 503 });
    }

    const { prNumber, nodeRef } = parsed.data;
    if (nodeRef) {
      const db = resolveAppDb();
      const rows = await withTenantScope(
        db,
        userActor(sessionUser.id as UserId),
        async (tx) =>
          tx
            .select()
            .from(nodes)
            .where(
              and(
                eq(nodes.id, nodeRef.nodeId),
                eq(nodes.ownerUserId, sessionUser.id)
              )
            )
            .limit(1)
      );
      const node = rows[0];
      if (!node) {
        return NextResponse.json({ error: "not found" }, { status: 404 });
      }

      let parentRepo: ReturnType<typeof getNodeRefParentRepo>;
      try {
        parentRepo = getNodeRefParentRepo(env);
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "node-ref flight parent repo not configured";
        return NextResponse.json({ error: message }, { status: 503 });
      }

      let prepared: PreparedNodeRefCandidateFlight;
      try {
        prepared = await deployPlane.prepareNodeRefCandidateFlight({
          parentOwner: parentRepo.owner,
          parentRepo: parentRepo.repo,
          nodeId: node.id,
          slug: node.slug,
          sourceSha: nodeRef.sourceSha,
        });
      } catch (error) {
        const response = handleDeployPlaneError(error);
        if (response) return response;
        throw error;
      }

      const parentPin = prepared.parentPin;
      if (parentPin.status === "pin_pr_opened") {
        const ciStatus = await deployPlane.getCiStatus({
          owner: parentRepo.owner,
          repo: parentRepo.repo,
          prNumber: parentPin.prNumber,
        });
        if (ciStatus.headSha !== parentPin.parentHeadSha) {
          return NextResponse.json(
            {
              error:
                "parent pin PR CI head does not match the prepared pin commit",
              parentPrNumber: parentPin.prNumber,
              expectedHeadSha: parentPin.parentHeadSha,
              actualHeadSha: ciStatus.headSha,
            },
            { status: 409 }
          );
        }
        if (!ciStatus.allGreen || ciStatus.pending) {
          return NextResponse.json(
            {
              error: "Parent pin PR CI is not green for this node-ref flight.",
              parentPrNumber: parentPin.prNumber,
              parentHeadSha: parentPin.parentHeadSha,
              allGreen: ciStatus.allGreen,
              pending: ciStatus.pending,
            },
            { status: 422 }
          );
        }
      }

      try {
        const dispatch = await deployPlane.dispatchNodeRefCandidateFlight({
          owner: parentRepo.owner,
          repo: parentRepo.repo,
          slug: prepared.slug,
          sourceSha: prepared.sourceSha,
        });

        return NextResponse.json(
          flightOperation.output.parse({
            dispatched: dispatch.dispatched,
            slot: "candidate-a",
            nodeRef: {
              nodeId: prepared.nodeId,
              slug: prepared.slug,
              sourceSha: prepared.sourceSha,
              sourceRepo: prepared.sourceRepo,
              image: prepared.image,
              ...(parentPin.prNumber
                ? {
                    parentPrNumber: parentPin.prNumber,
                    parentHeadSha: parentPin.parentHeadSha,
                  }
                : {}),
            },
            workflowUrl: dispatch.workflowUrl,
            message: dispatch.message,
          }),
          { status: 202 }
        );
      } catch (error) {
        const errorResponse = handleDispatchError(ctx, error);
        if (errorResponse) return errorResponse;
        throw error;
      }
    }

    if (!prNumber) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const { owner, repo } = getGithubRepo();

    // CI gate: verify all checks are green for the exact PR head SHA
    const ciStatus = await deployPlane.getCiStatus({ owner, repo, prNumber });
    if (!ciStatus.allGreen || ciStatus.pending) {
      logRequestWarn(
        ctx.log,
        { prNumber, allGreen: ciStatus.allGreen, pending: ciStatus.pending },
        "CI_NOT_GREEN"
      );
      return NextResponse.json(
        {
          error: `CI is not green for PR #${prNumber}. Resolve failing checks before requesting a flight.`,
          headSha: ciStatus.headSha,
          allGreen: ciStatus.allGreen,
          pending: ciStatus.pending,
        },
        { status: 422 }
      );
    }

    // Dispatch candidate-flight.yml — the workflow owns the slot lease
    try {
      const dispatch = await deployPlane.dispatchCandidateFlight({
        owner,
        repo,
        prNumber,
        headSha: ciStatus.headSha,
      });

      return NextResponse.json(
        flightOperation.output.parse({
          dispatched: dispatch.dispatched,
          slot: "candidate-a",
          prNumber,
          headSha: ciStatus.headSha,
          workflowUrl: dispatch.workflowUrl,
          message: dispatch.message,
        }),
        { status: 202 }
      );
    } catch (error) {
      const errorResponse = handleDispatchError(ctx, error);
      if (errorResponse) return errorResponse;
      throw error;
    }
  }
);
