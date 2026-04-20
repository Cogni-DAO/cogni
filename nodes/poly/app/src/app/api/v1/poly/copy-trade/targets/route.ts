// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/v1/poly/copy-trade/targets`
 * Purpose: HTTP GET — list wallets the operator is monitoring / copy-trading. v0 reads
 *          from `CopyTradeTargetSource` (env-backed); P2 swaps the source to a
 *          DB-backed impl with no route changes.
 * Scope: Thin validator — asks the port for wallets, reads the singleton kill-switch
 *        from the ledger, maps to contract response. No DB writes; no business logic.
 * Invariants:
 *   - Response shape is contract-defined.
 *   - HARDCODED_USER: response is not user-scoped in v0 (single-operator prototype).
 *   - GLOBAL_KILL_SWITCH: every target shares `poly_copy_trade_config.enabled` —
 *     there is no per-target enable flag in v0.
 * Side-effects: IO (reads env via port + `poly_copy_trade_config` via OrderLedger.snapshotState).
 * Notes: Authenticated via session. Follow-up: multi-tenant per-user target lists (task.0315 P2).
 * Links: docs/spec/poly-copy-trade-phase1.md, work/items/task.0315.poly-copy-trade-prototype.md
 * @public
 */

import {
  type PolyCopyTradeTarget,
  polyCopyTradeTargetsOperation,
} from "@cogni/node-contracts";
import {
  COGNI_SYSTEM_BILLING_ACCOUNT_ID,
  COGNI_SYSTEM_PRINCIPAL_USER_ID,
} from "@cogni/node-shared";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { NextResponse } from "next/server";
import { getSessionUser } from "@/app/_lib/auth/session";
import { getContainer } from "@/bootstrap/container";
import { wrapRouteHandlerWithLogging } from "@/bootstrap/http";
import { buildMirrorTargetConfig } from "@/bootstrap/jobs/copy-trade-mirror.job";
import { createOrderLedger } from "@/features/trading";

export const dynamic = "force-dynamic";

export const GET = wrapRouteHandlerWithLogging(
  {
    routeId: "poly.copy_trade.targets",
    auth: { mode: "required", getSessionUser },
  },
  // TODO(task.0318 A4): switch from `listAllActive` (system-wide enumerator)
  // to `listForActor(sessionUser.id)` so each user sees only their own
  // tracked wallets. CP A4 also lands the POST + DELETE routes for CRUD.
  // Today the read uses listAllActive so the existing single-operator
  // candidate-a flight (system-tenant rows) keeps rendering on the dashboard.
  async (ctx, _request, _sessionUser) => {
    const container = getContainer();
    const enumerated = await container.copyTradeTargetSource.listAllActive();
    const wallets = enumerated.map((e) => e.targetWallet);
    const targets: PolyCopyTradeTarget[] = [];
    if (wallets.length > 0) {
      const ledger = createOrderLedger({
        db: container.serviceDb as unknown as NodePgDatabase,
        logger: ctx.log,
      });
      const configs = wallets.map((wallet) => ({
        wallet,
        config: buildMirrorTargetConfig({
          targetWallet: wallet,
          billingAccountId: COGNI_SYSTEM_BILLING_ACCOUNT_ID,
          createdByUserId: COGNI_SYSTEM_PRINCIPAL_USER_ID,
        }),
      }));
      const firstConfig = configs[0];
      if (!firstConfig) throw new Error("unreachable"); // guarded by wallets.length > 0
      const snapshot = await ledger.snapshotState(
        firstConfig.config.target_id,
        COGNI_SYSTEM_BILLING_ACCOUNT_ID
      );
      for (const { wallet, config } of configs) {
        targets.push({
          target_id: config.target_id,
          target_wallet: wallet,
          mode: config.mode,
          mirror_usdc: config.mirror_usdc,
          max_daily_usdc: config.max_daily_usdc,
          max_fills_per_hour: config.max_fills_per_hour,
          enabled: snapshot.enabled,
          source: "env",
        });
      }
    }
    return NextResponse.json(
      polyCopyTradeTargetsOperation.output.parse({ targets })
    );
  }
);
