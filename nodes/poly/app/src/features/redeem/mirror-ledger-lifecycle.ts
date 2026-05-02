// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `features/redeem/mirror-ledger-lifecycle`
 * Purpose: Best-effort bridge from the redeem state machine into the
 *   `poly_copy_trade_fills.position_lifecycle` read model.
 * Scope: Shared by the manual route and event-driven redeem pipeline. Does not
 *   decide lifecycle; callers pass the state they have already committed to
 *   the redeem job row.
 * Links: work item 5006, nodes/poly/app/src/features/trading/order-ledger.ts
 * @public
 */

import type { RedeemLifecycleState } from "@/core";

interface LoggerLike {
  info: (obj: object, msg?: string) => void;
  warn: (obj: object, msg?: string) => void;
}

export interface LedgerLifecycleMirrorPort {
  markPositionLifecycleByAsset(input: {
    billing_account_id: string;
    token_id: string;
    lifecycle: RedeemLifecycleState;
    updated_at: Date;
  }): Promise<number>;
}

export interface LedgerLifecycleMirrorDeps {
  orderLedger: LedgerLifecycleMirrorPort;
  billingAccountId: string;
  logger: LoggerLike;
}

export async function mirrorRedeemLifecycleToLedger(
  deps: LedgerLifecycleMirrorDeps,
  input: {
    conditionId: string;
    positionId: string;
    lifecycle: RedeemLifecycleState;
    source: string;
  }
): Promise<void> {
  try {
    const updated = await deps.orderLedger.markPositionLifecycleByAsset({
      billing_account_id: deps.billingAccountId,
      token_id: input.positionId,
      lifecycle: input.lifecycle,
      updated_at: new Date(),
    });
    deps.logger.info(
      {
        event: "poly.redeem.lifecycle_mirrored_to_ledger",
        billing_account_id: deps.billingAccountId,
        condition_id: input.conditionId,
        position_id: input.positionId,
        lifecycle: input.lifecycle,
        source: input.source,
        updated_rows: updated,
      },
      "redeem lifecycle mirrored to order ledger"
    );
  } catch (err) {
    deps.logger.warn(
      {
        event: "poly.redeem.lifecycle_mirror_failed",
        billing_account_id: deps.billingAccountId,
        condition_id: input.conditionId,
        position_id: input.positionId,
        lifecycle: input.lifecycle,
        source: input.source,
        err: err instanceof Error ? err.message : String(err),
      },
      "redeem lifecycle mirror to order ledger failed"
    );
  }
}
