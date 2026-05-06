// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2026 Cogni-DAO

/**
 * Module: `features/redeem/redeem-diff`
 * Purpose: Layer-3 position-diff loop (bug.5028 v2.1) — replaces the
 *   boot-coupled full `backfillLifecycleStates` sweep with a periodic
 *   set-difference between Polymarket Data-API `/positions` and the
 *   `poly_redeem_jobs` ledger. In steady state the diff is empty
 *   (chain-log catchup at `runRedeemCatchup` has already classified
 *   every condition); per-tick cost is then one Data-API read + one DB
 *   query + zero multicalls. New conditions and stuck `unresolved`/
 *   `resolving` rows fall through to `subscriber.enqueueForCondition`.
 * Scope: Per-tenant. Pure predicate + IO coordinator; no timer (the
 *   bootstrap pipeline owns scheduling so its `stop()` can clear it).
 * Invariants:
 *   - STEADY_STATE_IS_NEAR_ZERO_WORK — when diff = ∅, no multicalls fire.
 *   - BOUNDED_BY_DIVERGENCE — classify cost is O(diff), not O(positions).
 *   - DIFF_IS_SELF_BOOTSTRAPPING — fresh funder yields known = ∅, so the
 *     first tick classifies the full position set with no special-case gate.
 *   - CONCURRENCY_CAPPED — fan-out to `enqueueForCondition` reuses
 *     `BACKFILL_ENQUEUE_CONCURRENCY = 4` + `Promise.allSettled` so one
 *     condition's failure doesn't halt the rest.
 * Side-effects: IO (Data-API read, DB read, per-condition enqueue).
 * Links: docs/spec/poly-order-position-lifecycle.md, work/items/bug.5028
 * @public
 */

import type { PolymarketDataApiClient } from "@cogni/poly-market-provider/adapters/polymarket";
import pLimit from "p-limit";
import type { Logger } from "pino";

import type { KnownRedeemCondition, RedeemJobsPort } from "@/ports";
import { EVENT_NAMES } from "@/shared/observability/events";

import type { RedeemSubscriber } from "./redeem-subscriber";

/** Stuck-classification threshold — `unresolved`/`resolving` rows older than
 *  this are re-classified to detect resolution events the chain-log catchup
 *  may have missed. 6 h gives Layer 2 ample time to catch the common case. */
export const REDEEM_DIFF_STALE_UNRESOLVED_MS = 6 * 60 * 60 * 1000;

/** Per-tick concurrency cap on `enqueueForCondition` fan-out. Mirrors
 *  `BACKFILL_ENQUEUE_CONCURRENCY` from `bootstrap/redeem-pipeline.ts:73`. */
export const REDEEM_DIFF_ENQUEUE_CONCURRENCY = 4;

const UNRESOLVED_LIFECYCLE_STATES = new Set([
  "unresolved",
  "resolving",
] as const);

function normalizeConditionId(raw: string): `0x${string}` {
  return raw.startsWith("0x")
    ? (raw as `0x${string}`)
    : (`0x${raw}` as `0x${string}`);
}

/**
 * Pure diff predicate: given the Data-API condition set, the DB-known
 * condition set, the stale-unresolved threshold, and `now`, return the
 * set of conditionIds that need (re)classification this tick.
 *
 *   diff = (api ∖ known) ∪ stale_unresolved
 *
 * Unit-testable in isolation; no IO.
 */
export function computeRedeemDiff(args: {
  apiConditionIds: ReadonlySet<`0x${string}`>;
  known: readonly KnownRedeemCondition[];
  staleUnresolvedMs: number;
  now: Date;
}): Set<`0x${string}`> {
  const { apiConditionIds, known, staleUnresolvedMs, now } = args;

  const knownIds = new Set<`0x${string}`>();
  const staleUnresolved = new Set<`0x${string}`>();
  const cutoff = now.getTime() - staleUnresolvedMs;

  for (const k of known) {
    knownIds.add(k.conditionId);
    if (
      UNRESOLVED_LIFECYCLE_STATES.has(
        k.lifecycleState as "unresolved" | "resolving"
      ) &&
      k.enqueuedAt.getTime() < cutoff
    ) {
      staleUnresolved.add(k.conditionId);
    }
  }

  const diff = new Set<`0x${string}`>();
  for (const c of apiConditionIds) {
    if (!knownIds.has(c)) diff.add(c);
  }
  for (const c of staleUnresolved) {
    diff.add(c);
  }
  return diff;
}

export interface RunDiffTickDeps {
  redeemJobs: RedeemJobsPort;
  dataApiClient: PolymarketDataApiClient;
  subscriber: RedeemSubscriber;
  funderAddress: `0x${string}`;
  log: Logger;
  now?: () => Date;
  staleUnresolvedMs?: number;
  concurrency?: number;
}

/**
 * Per-tenant tick: compute the diff and fan out `enqueueForCondition` calls
 * for conditions in the diff. Idempotent (subscriber.enqueueForCondition
 * dedupes via the `(funder, condition_id)` unique index). Logs per-tick
 * metrics under `POLY_REDEEM_DIFF_TICK_COMPLETE` for Loki observability.
 */
export async function runRedeemDiffTick(deps: RunDiffTickDeps): Promise<void> {
  const startedAt = Date.now();
  const now = deps.now ? deps.now() : new Date();
  const staleMs = deps.staleUnresolvedMs ?? REDEEM_DIFF_STALE_UNRESOLVED_MS;
  const concurrency = deps.concurrency ?? REDEEM_DIFF_ENQUEUE_CONCURRENCY;

  const positions = await deps.dataApiClient.listAllUserPositions(
    deps.funderAddress
  );
  const apiConditionIds = new Set<`0x${string}`>();
  for (const p of positions) {
    if (!p.conditionId) continue;
    apiConditionIds.add(normalizeConditionId(p.conditionId));
  }

  const known = await deps.redeemJobs.listKnownConditionsForFunder(
    deps.funderAddress
  );
  const diff = computeRedeemDiff({
    apiConditionIds,
    known,
    staleUnresolvedMs: staleMs,
    now,
  });

  if (diff.size === 0) {
    const mem = process.memoryUsage();
    deps.log.info(
      {
        event: EVENT_NAMES.POLY_REDEEM_DIFF_TICK_COMPLETE,
        durationMs: Date.now() - startedAt,
        funder: deps.funderAddress,
        position_count: positions.length,
        api_condition_count: apiConditionIds.size,
        known_condition_count: known.length,
        diff_size: 0,
        heap_used_mb: Math.round(mem.heapUsed / 1024 / 1024),
        rss_mb: Math.round(mem.rss / 1024 / 1024),
      },
      "redeem diff: no divergence"
    );
    return;
  }

  const limit = pLimit(concurrency);
  const enqueueResults = await Promise.allSettled(
    Array.from(diff, (conditionId) =>
      limit(() => deps.subscriber.enqueueForCondition(conditionId, positions))
    )
  );
  const failures = enqueueResults.filter(
    (r): r is PromiseRejectedResult => r.status === "rejected"
  );

  const mem = process.memoryUsage();
  deps.log.info(
    {
      event: EVENT_NAMES.POLY_REDEEM_DIFF_TICK_COMPLETE,
      durationMs: Date.now() - startedAt,
      funder: deps.funderAddress,
      position_count: positions.length,
      api_condition_count: apiConditionIds.size,
      known_condition_count: known.length,
      diff_size: diff.size,
      classify_succeeded: enqueueResults.length - failures.length,
      classify_failed: failures.length,
      heap_used_mb: Math.round(mem.heapUsed / 1024 / 1024),
      rss_mb: Math.round(mem.rss / 1024 / 1024),
    },
    failures.length > 0
      ? "redeem diff: divergence classified with partial failures"
      : "redeem diff: divergence classified"
  );
  if (failures.length > 0) {
    for (const f of failures) {
      const err = f.reason;
      deps.log.warn(
        {
          event: EVENT_NAMES.POLY_REDEEM_DIFF_TICK_FAILED,
          funder: deps.funderAddress,
          err: err instanceof Error ? err.message : String(err),
        },
        "redeem diff: enqueueForCondition rejected"
      );
    }
  }
}
