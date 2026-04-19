// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/v1/poly/internal/sync-health`
 * Purpose: HTTP GET — aggregate sync-freshness stats for the order reconciler. Suitable for a Grafana alert rule and a dashboard freshness banner.
 * Scope: No auth — aggregate-only, no PII, no wallet addresses.
 * Invariants:
 *   - SYNC_HEALTH_IS_PUBLIC — response is Zod-validated against PolySyncHealthResponseSchema before returning.
 *   - No user scoping — this endpoint is internal metrics only.
 * Side-effects: IO (one DB SELECT via service-role client + in-process clock read).
 * Notes: reconciler_last_tick_at is null when the reconciler is not running (Polymarket creds absent) or has not completed a tick yet.
 * Links: work/items/task.0328.md, docs/spec/poly-copy-trade-phase1.md
 * @public
 */

import { PolySyncHealthResponseSchema } from "@cogni/node-contracts";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { NextResponse } from "next/server";
import { getContainer } from "@/bootstrap/container";
import { createOrderLedger } from "@/features/trading";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const container = getContainer();
    const ledger = createOrderLedger({
      db: container.serviceDb as unknown as NodePgDatabase,
      logger: container.log,
    });

    const summary = await ledger.syncHealthSummary();
    const lastTickAt = container.reconcilerLastTickAt();

    const body = PolySyncHealthResponseSchema.parse({
      ...summary,
      reconciler_last_tick_at: lastTickAt ? lastTickAt.toISOString() : null,
    });

    return NextResponse.json(body);
  } catch (err: unknown) {
    return NextResponse.json(
      {
        error: "sync_health_error",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
