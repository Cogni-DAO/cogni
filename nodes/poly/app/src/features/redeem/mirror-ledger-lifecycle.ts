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
import { EVENT_NAMES } from "@/shared/observability/events";

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
    terminal_correction?: "redeem_reorg";
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
    terminalCorrection?: "redeem_reorg";
  }
): Promise<void> {
  try {
    const updated = await deps.orderLedger.markPositionLifecycleByAsset({
      billing_account_id: deps.billingAccountId,
      token_id: input.positionId,
      lifecycle: input.lifecycle,
      updated_at: new Date(),
      ...(input.terminalCorrection !== undefined
        ? { terminal_correction: input.terminalCorrection }
        : {}),
    });
    deps.logger.info(
      {
        event: EVENT_NAMES.POLY_REDEEM_LIFECYCLE_MIRRORED,
        lifecycle: input.lifecycle,
        source: input.source,
        terminal_correction: input.terminalCorrection ?? null,
        updated_rows: updated,
      },
      "redeem lifecycle mirrored to order ledger"
    );
  } catch {
    deps.logger.warn(
      {
        event: EVENT_NAMES.POLY_REDEEM_LIFECYCLE_MIRROR_FAILED,
        lifecycle: input.lifecycle,
        source: input.source,
        terminal_correction: input.terminalCorrection ?? null,
        errorCode: "ledger_lifecycle_write_failed",
      },
      "redeem lifecycle mirror to order ledger failed"
    );
  }
}
