// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/v1/vcs/pr`
 * Purpose: HTTP endpoint for external agents to open a GitHub PR from an existing remote branch.
 * Scope: Validates input with contract, delegates to VcsCapability.createPr, returns PR number + URL.
 *   Does not create branches, push code, or apply patches — agent is responsible for pushing its branch first.
 * Invariants:
 *   - AUTH_REQUIRED: Accepts Bearer token (machine agents) or SIWE session. No open access.
 *   - CAPABILITY_BOUNDARY: Calls VcsCapability only — no direct GitHub API or Octokit in this file.
 *   - CONTRACTS_ARE_TRUTH: Input/output parsed through createPrOperation contract.
 * Side-effects: IO (GitHub REST API via VcsCapability)
 * Links: task.0360, packages/node-contracts/src/vcs.create-pr.v1.contract.ts,
 *   docs/guides/agent-api-validation.md
 * @public
 */

import { createPrOperation } from "@cogni/node-contracts";
import { NextResponse } from "next/server";
import { getSessionUser } from "@/app/_lib/auth/session";
import { getContainer } from "@/bootstrap/container";
import { wrapRouteHandlerWithLogging } from "@/bootstrap/http";
import { getGithubRepo } from "@/shared/config/repoSpec.server";
import { logRequestWarn, type RequestContext } from "@/shared/observability";

export const runtime = "nodejs";

function handleRouteError(
  ctx: RequestContext,
  error: unknown
): NextResponse | null {
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof (error as { message: unknown }).message === "string" &&
    (error as { message: string }).message.includes("already exists")
  ) {
    logRequestWarn(ctx.log, error, "PR_ALREADY_EXISTS");
    return NextResponse.json(
      { error: "A pull request from this branch already exists" },
      { status: 409 }
    );
  }
  return null;
}

export const POST = wrapRouteHandlerWithLogging(
  { routeId: "vcs.create-pr", auth: { mode: "required", getSessionUser } },
  async (ctx, request) => {
    const parsed = createPrOperation.input.safeParse(await request.json());
    if (!parsed.success) {
      logRequestWarn(ctx.log, parsed.error, "VALIDATION_ERROR");
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }
    const input = parsed.data;

    try {
      const { owner, repo } = getGithubRepo();
      const container = getContainer();
      const { createPr } = container.vcsCapability;
      if (!createPr) {
        return NextResponse.json(
          { error: "VCS capability not configured on this node" },
          { status: 503 }
        );
      }
      const result = await createPr.call(container.vcsCapability, {
        owner,
        repo,
        branch: input.branch,
        title: input.title,
        body: input.body,
        base: input.base,
      });

      return NextResponse.json(createPrOperation.output.parse(result), {
        status: 201,
      });
    } catch (error) {
      const errorResponse = handleRouteError(ctx, error);
      if (errorResponse) return errorResponse;
      throw error;
    }
  }
);
