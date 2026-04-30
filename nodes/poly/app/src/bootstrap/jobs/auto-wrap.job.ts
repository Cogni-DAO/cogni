// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@bootstrap/jobs/auto-wrap.job`
 * Purpose: 60-second scan loop that wraps idle USDC.e at consenting tenants'
 *   funder addresses into spendable pUSD. Closes the deposit / V1-redeem /
 *   transfer leaks where cash returns as USDC.e but only pUSD funds CLOB BUYs.
 * Scope: Wiring + cadence only. Exports the pure `runAutoWrapTick(deps)` for
 *   unit tests and the `startAutoWrap(deps) → AutoWrapJobHandle` shim for the
 *   container. Does NOT contain on-chain logic; that lives behind
 *   `PolyTraderWalletPort.wrapIdleUsdcE` (task.0429).
 * Invariants:
 *   - SINGLE_WRITER — exactly one process runs this job. Enforced by caller
 *     (POLY_ROLE=trader + replicas=1 joint invariant).
 *   - TICK_IS_SELF_HEALING — per-row errors are caught + metered; tick
 *     continues for remaining rows and never crashes the interval.
 *   - DUST_GUARD — adapter's `wrapIdleUsdcE` enforces the floor; the job
 *     trusts the adapter's `skipped: below_floor` outcome.
 *   - CONSENT_REVOCABLE — each tick re-derives the consent set from DB; a
 *     revoke is honored on the next tick with no extra plumbing.
 * Side-effects: starts a `setInterval`, emits logs + metrics.
 * Links: work/items/task.0429.poly-auto-wrap-consent-loop.md
 *
 * @public
 */

import { EVENT_NAMES, type LoggerPort, type MetricsPort } from "@cogni/node-shared";
import type { PolyTraderWalletPort } from "@cogni/poly-wallet";

export const AUTO_WRAP_METRICS = {
  /** One per tick. Always increments, even when zero rows scanned. */
  ticksTotal: "poly_auto_wrap_ticks_total",
  /** Outcome counter. Labels: outcome=wrapped|skipped|errored, reason=... */
  outcomesTotal: "poly_auto_wrap_outcomes_total",
  /** One per tick that escaped per-row try/catch. Structural bug. */
  tickErrorsTotal: "poly_auto_wrap_tick_errors_total",
} as const;

const AUTO_WRAP_POLL_MS = 60_000;
const AUTO_WRAP_ROW_LIMIT = 200;

/**
 * Eligible-row reader. Returns `billing_account_id`s for connections that
 * have granted auto-wrap consent + are not revoked (connection or wrap-side).
 * Provided by the container; the job is DB-shape-agnostic.
 *
 * Implementation backs onto the partial index
 * `poly_wallet_connections_auto_wrap_eligible_idx`.
 */
export type ListEligibleAutoWrapConnections = (limit: number) => Promise<
  readonly { readonly billingAccountId: string }[]
>;

export interface AutoWrapJobDeps {
  walletPort: Pick<PolyTraderWalletPort, "wrapIdleUsdcE">;
  listEligible: ListEligibleAutoWrapConnections;
  logger: LoggerPort;
  metrics: MetricsPort;
}

export interface AutoWrapJobHandle {
  stop: () => void;
  getLastTickAt: () => Date | null;
}

interface TickSummary {
  readonly scanned: number;
  readonly wrapped: number;
  readonly skipped: number;
  readonly errored: number;
}

/**
 * Run one auto-wrap pass. Exported for direct unit-test consumption; the
 * `startAutoWrap` shim wraps it in a `setInterval`.
 *
 * @public
 */
export async function runAutoWrapTick(
  deps: AutoWrapJobDeps
): Promise<TickSummary> {
  const log = deps.logger.child({ component: "auto-wrap" });
  const eligible = await deps.listEligible(AUTO_WRAP_ROW_LIMIT);
  let wrapped = 0;
  let skipped = 0;
  let errored = 0;

  for (const row of eligible) {
    try {
      const result = await deps.walletPort.wrapIdleUsdcE(row.billingAccountId);
      if (result.outcome === "wrapped") {
        wrapped += 1;
        deps.metrics.incr(AUTO_WRAP_METRICS.outcomesTotal, {
          outcome: "wrapped",
        });
      } else {
        skipped += 1;
        deps.metrics.incr(AUTO_WRAP_METRICS.outcomesTotal, {
          outcome: "skipped",
          reason: result.reason,
        });
      }
    } catch (err: unknown) {
      errored += 1;
      deps.metrics.incr(AUTO_WRAP_METRICS.outcomesTotal, {
        outcome: "errored",
      });
      log.error(
        {
          event: EVENT_NAMES.POLY_AUTO_WRAP_ROW_ERROR,
          billing_account_id: row.billingAccountId,
          err: err instanceof Error ? err.message : String(err),
        },
        "auto-wrap: row error (continuing)"
      );
    }
  }

  deps.metrics.incr(AUTO_WRAP_METRICS.ticksTotal, {});
  log.info(
    {
      event: EVENT_NAMES.POLY_AUTO_WRAP_TICK_COMPLETED,
      scanned: eligible.length,
      wrapped,
      skipped,
      errored,
    },
    "auto-wrap tick completed"
  );
  return { scanned: eligible.length, wrapped, skipped, errored };
}

/**
 * Start the 60s auto-wrap poll. Returns an `AutoWrapJobHandle` with `stop` +
 * `getLastTickAt`. Caller is responsible for ensuring exactly-one execution
 * (POLY_ROLE=trader + replicas=1).
 *
 * @public
 */
export function startAutoWrap(deps: AutoWrapJobDeps): AutoWrapJobHandle {
  const log = deps.logger.child({ component: "auto-wrap-job" });
  log.info(
    {
      event: EVENT_NAMES.POLY_AUTO_WRAP_SINGLETON_CLAIM,
      poll_ms: AUTO_WRAP_POLL_MS,
    },
    "auto-wrap starting (SINGLE_WRITER — alert on duplicate pods running this)"
  );

  let lastTickAt: Date | null = null;

  async function tick(): Promise<void> {
    try {
      await runAutoWrapTick(deps);
      lastTickAt = new Date();
    } catch (err: unknown) {
      deps.metrics.incr(AUTO_WRAP_METRICS.tickErrorsTotal, {});
      log.error(
        {
          event: EVENT_NAMES.POLY_AUTO_WRAP_TICK_ERROR,
          err: err instanceof Error ? err.message : String(err),
        },
        "auto-wrap: tick threw (continuing)"
      );
    }
  }

  void tick();

  const intervalHandle = setInterval(() => {
    void tick();
  }, AUTO_WRAP_POLL_MS);

  return {
    stop() {
      clearInterval(intervalHandle);
      log.info(
        { event: EVENT_NAMES.POLY_AUTO_WRAP_STOPPED },
        "auto-wrap stopped"
      );
    },
    getLastTickAt() {
      return lastTickAt;
    },
  };
}
