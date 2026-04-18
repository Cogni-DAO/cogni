// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/v1/poly/copy-trade/targets`
 * Purpose: HTTP GET — list wallets the operator is monitoring / copy-trading. v0 returns the single env-derived target; P2 returns rows from `poly_copy_trade_targets`.
 * Scope: Thin validator — parses query params, reads env + kill-switch, maps to contract response. No DB writes; no business logic.
 * Invariants: Response shape is contract-defined; HARDCODED_USER noted inline.
 * Side-effects: IO (reads env + `poly_copy_trade_config` via OrderLedger.snapshotState for `enabled`).
 * Notes: Authenticated via session. Single-operator prototype — response is not user-scoped. Follow-up: multi-tenant per-user target lists (task.0315 P2).
 * Links: docs/spec/poly-copy-trade-phase1.md, work/items/task.0315.poly-copy-trade-prototype.md
 * @public
 */

import {
  type PolyCopyTradeTarget,
  polyCopyTradeTargetsOperation,
} from "@cogni/node-contracts";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { NextResponse } from "next/server";
import { getSessionUser } from "@/app/_lib/auth/session";
import { getContainer } from "@/bootstrap/container";
import { wrapRouteHandlerWithLogging } from "@/bootstrap/http";
import { buildMirrorTargetConfig } from "@/bootstrap/jobs/copy-trade-mirror.job";
import { createOrderLedger } from "@/features/trading";
import { serverEnv } from "@/shared/env/server-env";

export const dynamic = "force-dynamic";

export const GET = wrapRouteHandlerWithLogging(
  {
    routeId: "poly.copy_trade.targets",
    auth: { mode: "required", getSessionUser },
  },
  // TODO(HARDCODED_USER): response ignores `sessionUser` — single-operator
  // prototype. Multi-tenant targets land in task.0315 P2; when they do,
  // resolve per-user targets via `poly_copy_trade_targets.owner_id = sessionUser.id`.
  async (ctx, _request, _sessionUser) => {
    const env = serverEnv();
    const targets: PolyCopyTradeTarget[] = [];
    if (env.COPY_TRADE_TARGET_WALLET) {
      const target_wallet = env.COPY_TRADE_TARGET_WALLET as `0x${string}`;
      const config = buildMirrorTargetConfig(target_wallet);
      // In v0 the `poly_copy_trade_config.enabled` singleton IS the
      // per-target monitoring flag (one wallet, one bit). P2 moves this
      // onto `poly_copy_trade_targets.enabled` per row. `snapshotState`
      // is already FAIL_CLOSED on DB read failure so the dashboard surfaces
      // `enabled=false` rather than a misleading true when Postgres is down.
      const ledger = createOrderLedger({
        db: getContainer().serviceDb as unknown as NodePgDatabase,
        logger: ctx.log,
      });
      const snapshot = await ledger.snapshotState(config.target_id);
      targets.push({
        target_id: config.target_id,
        target_wallet,
        mode: config.mode,
        mirror_usdc: config.mirror_usdc,
        max_daily_usdc: config.max_daily_usdc,
        max_fills_per_hour: config.max_fills_per_hour,
        enabled: snapshot.enabled,
        source: "env",
      });
    }
    return NextResponse.json(
      polyCopyTradeTargetsOperation.output.parse({ targets })
    );
  }
);
