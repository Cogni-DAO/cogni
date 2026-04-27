// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/v1/vcs/flight`
 * Purpose: CI-gated candidate-a flight request for external AI agents.
 *   Verifies CI is green for the PR head SHA, then dispatches candidate-flight.yml.
 *   The candidate slot controller (GitHub Actions workflow) owns the actual slot lease
 *   on the deploy branch — this endpoint does not replicate that logic.
 * Scope: Auth → CI gate → dispatch. No lease table. No polling hacks.
 * Invariants:
 *   - AUTH_REQUIRED: Bearer token (machine agents) or SIWE session. No open access.
 *   - CI_GATE: Rejects 422 if CI is not fully green for the PR head SHA.
 *   - CAPABILITY_BOUNDARY: Calls VcsCapability only — no direct Octokit in this file.
 *   - CONTRACTS_ARE_TRUTH: Input/output parsed through flightOperation contract.
 *   - NO_LEASE_SPLIT_BRAIN: Slot lease lives on the deploy branch (candidate-slot-controller);
 *     this route does not write a competing lease.
 * Side-effects: IO (GitHub REST API via VcsCapability)
 * Links: task.0361, packages/node-contracts/src/vcs.flight.v1.contract.ts,
 *   docs/spec/agentic-contribution-loop.md
 * @public
 */

import { flightOperation } from "@cogni/node-contracts";
import { NextResponse } from "next/server";
import { getSessionUser } from "@/app/_lib/auth/session";
import { getContainer } from "@/bootstrap/container";
import { wrapRouteHandlerWithLogging } from "@/bootstrap/http";
import { getGithubRepo } from "@/shared/config/repoSpec.server";
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

export const POST = wrapRouteHandlerWithLogging(
  { routeId: "vcs.flight", auth: { mode: "required", getSessionUser } },
  async (ctx, request) => {
    const parsed = flightOperation.input.safeParse(await request.json());
    if (!parsed.success) {
      logRequestWarn(ctx.log, parsed.error, "VALIDATION_ERROR");
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }
    const { prNumber } = parsed.data;

    const { owner, repo } = getGithubRepo();
    const container = getContainer();
    const vcs = container.vcsCapability;

    // CI gate: verify all checks are green for the exact PR head SHA
    const ciStatus = await vcs.getCiStatus({ owner, repo, prNumber });
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
      const dispatch = await vcs.dispatchCandidateFlight({
        owner,
        repo,
        prNumber,
        headSha: ciStatus.headSha,
      });

      return NextResponse.json(
        flightOperation.output.parse({
          dispatched: dispatch.dispatched,
          slot: "candidate-a",
          prNumber: dispatch.prNumber,
          headSha: dispatch.headSha,
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
