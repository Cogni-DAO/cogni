// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/v1/ledger/epochs/[id]/finalize/route`
 * Purpose: SIWE + approver-gated endpoint for finalizing an epoch (review → finalized) with EIP-191 signature.
 * Scope: Auth-protected POST endpoint. Starts FinalizeEpochWorkflow via Temporal. Returns 202 + workflowId (WRITES_VIA_TEMPORAL). Does not perform finalization logic directly — delegates to workflow.
 * Invariants: WRITE_ROUTES_APPROVER_GATED, WRITES_VIA_TEMPORAL, EPOCH_FINALIZE_IDEMPOTENT.
 * Side-effects: IO (HTTP response, Temporal workflow start)
 * Links: docs/spec/epoch-ledger.md, contracts/ledger.finalize-epoch.v1.contract
 * @public
 */

import {
  Client,
  Connection,
  WorkflowExecutionAlreadyStartedError,
} from "@temporalio/client";
import { NextResponse } from "next/server";
import { getSessionUser } from "@/app/_lib/auth/session";
import { checkApprover } from "@/app/api/v1/attribution/_lib/approver-guard";
import { wrapRouteHandlerWithLogging } from "@/bootstrap/http";
import {
  FinalizeEpochInputSchema,
  finalizeEpochOperation,
} from "@/contracts/attribution.finalize-epoch.v1.contract";
import { getLedgerApprovers, getScopeId } from "@/shared/config";
import { serverEnv } from "@/shared/env/server-env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Task queue for ledger workflows — must match ledger-worker.ts */
const LEDGER_TASK_QUEUE = "ledger-tasks";

export const POST = wrapRouteHandlerWithLogging<{
  params: Promise<{ id: string }>;
}>(
  {
    routeId: "ledger.finalize-epoch",
    auth: { mode: "required", getSessionUser },
  },
  async (ctx, request, sessionUser, context) => {
    // WRITE_ROUTES_APPROVER_GATED
    const denied = checkApprover(ctx, sessionUser?.walletAddress);
    if (denied) return denied;

    if (!context) throw new Error("context required for dynamic routes");
    const { id } = await context.params;
    let epochId: bigint;
    try {
      epochId = BigInt(id);
    } catch {
      return NextResponse.json({ error: "Invalid epoch ID" }, { status: 400 });
    }

    // Parse and validate request body
    const body = await request.json();
    const parsed = FinalizeEpochInputSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: parsed.error.format() },
        { status: 400 }
      );
    }

    const { signature } = parsed.data;
    const signerAddress = sessionUser?.walletAddress;
    if (!signerAddress) {
      return NextResponse.json(
        { error: "SIWE session missing wallet address" },
        { status: 401 }
      );
    }

    // Start FinalizeEpochWorkflow via Temporal
    const env = serverEnv();
    const scopeId = getScopeId();
    const approvers = getLedgerApprovers();

    const workflowId = `ledger-finalize-${scopeId}-${epochId.toString()}`;

    // TODO: Replace per-request connection with a singleton/connection manager
    // to avoid connection overhead on every finalize call.
    const connection = await Connection.connect({
      address: env.TEMPORAL_ADDRESS,
    });
    const client = new Client({
      connection,
      namespace: env.TEMPORAL_NAMESPACE,
    });

    try {
      await client.workflow.start("FinalizeEpochWorkflow", {
        taskQueue: LEDGER_TASK_QUEUE,
        workflowId,
        args: [
          {
            epochId: epochId.toString(),
            signature,
            signerAddress,
            approvers,
          },
        ],
      });
    } catch (err) {
      // WorkflowExecutionAlreadyStartedError → idempotent (already running or completed)
      if (!(err instanceof WorkflowExecutionAlreadyStartedError)) {
        throw err;
      }
      ctx.log.info(
        { workflowId },
        "Finalize workflow already running — returning existing ID"
      );
    } finally {
      await connection.close();
    }

    ctx.log.info({ epochId: id, workflowId }, "ledger.finalize-epoch_accepted");

    return NextResponse.json(
      finalizeEpochOperation.output.parse({ workflowId }),
      { status: 202 }
    );
  }
);
