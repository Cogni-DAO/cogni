// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@bootstrap/jobs/definitions/compute-balance.job`
 * Purpose: Hourly compute-substrate spend probe (story.5011). Reads each provider account
 *   balance via ctx.deps.computeCapability and emits Pino→Loki events so the operator (and a
 *   Grafana alert) see a low balance BEFORE a suspension takes an environment down — the gap
 *   that silently killed preview on 2026-06-19.
 * Scope: One scheduled job; the read goes through the container's ComputeResourcePort.
 * Invariants:
 *   - FAIL_LOUD: a read error emits COMPUTE_BALANCE_CHECK_FAILED and is swallowed, so a broken
 *     probe is itself visible/alertable rather than a silently-dead monitor (maximumAttempts:1).
 *   - STRUCTURED_LOKI_EVENT: event name carried in both the payload `event` field and the message.
 * Side-effects: emits log events; performs an outbound HTTPS read to the compute provider.
 * Links: ComputeResourcePort (@cogni/ai-tools), infra/grafana/alerts/compute-balance.alerts.yaml
 * @public
 */

import type { ComputeBalance } from "@cogni/ai-tools";

import type { Container } from "@/bootstrap/container";
import { serverEnv } from "@/shared/env";
import { defineScheduledJob } from "@/shared/node-app-scaffold/scheduled-jobs";
import { EVENT_NAMES } from "@/shared/observability";

export const computeBalance = defineScheduledJob<Container>({
  id: "compute-balance",
  // Balances move slowly; hourly is ample and cheap.
  cron: "0 * * * *",
  run: async (ctx) => {
    const lowThreshold = serverEnv().COMPUTE_BALANCE_LOW_THRESHOLD;

    let balances: readonly ComputeBalance[];
    try {
      balances = await ctx.deps.computeCapability.balances();
    } catch (error) {
      ctx.logger.error(
        {
          event: EVENT_NAMES.COMPUTE_BALANCE_CHECK_FAILED,
          nodeId: ctx.nodeId,
          jobId: ctx.jobId,
          reason: error instanceof Error ? error.message : "unknown error",
        },
        EVENT_NAMES.COMPUTE_BALANCE_CHECK_FAILED
      );
      return;
    }

    for (const b of balances) {
      ctx.logger.info(
        {
          event: EVENT_NAMES.COMPUTE_BALANCE_OBSERVED,
          provider: b.provider,
          accountId: b.accountId,
          currency: b.currency,
          remaining: b.remaining,
          estimatedDaysRemaining: b.estimatedDaysRemaining,
        },
        EVENT_NAMES.COMPUTE_BALANCE_OBSERVED
      );

      if (b.remaining < lowThreshold) {
        ctx.logger.warn(
          {
            event: EVENT_NAMES.COMPUTE_BALANCE_LOW,
            provider: b.provider,
            accountId: b.accountId,
            currency: b.currency,
            remaining: b.remaining,
            threshold: lowThreshold,
          },
          EVENT_NAMES.COMPUTE_BALANCE_LOW
        );
      }
    }
  },
});
