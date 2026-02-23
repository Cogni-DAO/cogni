// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/v1/public/ledger/epochs/[id]/allocations/route`
 * Purpose: Public HTTP endpoint for epoch allocations (finalized epochs only).
 * Scope: Public route using wrapPublicRoute(); returns proposed and final allocations for finalized epochs. Does not contain business logic.
 * Invariants: NODE_SCOPED, ALL_MATH_BIGINT, VALIDATE_IO, PUBLIC_READS_FINALIZED_ONLY.
 * Side-effects: IO (HTTP response, database read)
 * Links: docs/spec/epoch-ledger.md, contracts/ledger.epoch-allocations.v1.contract
 * @public
 */

import { NextResponse } from "next/server";
import { toAllocationDto } from "@/app/api/v1/public/ledger/_lib/ledger-dto";
import { getContainer } from "@/bootstrap/container";
import { wrapPublicRoute } from "@/bootstrap/http";
import { epochAllocationsOperation } from "@/contracts/ledger.epoch-allocations.v1.contract";

export const dynamic = "force-dynamic";

export const GET = wrapPublicRoute(
  {
    routeId: "ledger.epoch-allocations.public",
    cacheTtlSeconds: 60,
    staleWhileRevalidateSeconds: 300,
  },
  async (_ctx, _request, context) => {
    const { id } = await (context as { params: Promise<{ id: string }> })
      .params;
    let epochId: bigint;
    try {
      epochId = BigInt(id);
    } catch {
      return NextResponse.json({ error: "Invalid epoch ID" }, { status: 400 });
    }

    const store = getContainer().activityLedgerStore;

    // PUBLIC_READS_FINALIZED_ONLY: verify epoch is finalized
    const epoch = await store.getEpoch(epochId);
    if (!epoch || epoch.status !== "finalized") {
      return NextResponse.json({ error: "Epoch not found" }, { status: 404 });
    }

    const allocations = await store.getAllocationsForEpoch(epochId);

    return NextResponse.json(
      epochAllocationsOperation.output.parse({
        allocations: allocations.map(toAllocationDto),
        epochId: id,
      })
    );
  }
);
