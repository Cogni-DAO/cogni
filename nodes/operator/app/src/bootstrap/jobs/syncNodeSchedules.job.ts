// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@bootstrap/jobs/syncNodeSchedules.job`
 * Purpose: Job module that wires the node-facing recurring-work schedule sync (story.5008) to the application container — the non-graph sibling of syncGovernanceSchedules.
 * Scope: Acquires an advisory lock, resolves deps from the container, mints node-bound execution grants, and calls syncNodeSchedules. Does not contain reconcile business logic or perform tenant-facing schedule CRUD.
 * Invariants:
 *   - SINGLE_WRITER: pg_advisory_lock on a reserved pool connection prevents concurrent node-sync runs.
 *   - SYSTEM_OPS_ONLY: runs under COGNI_SYSTEM_PRINCIPAL_USER_ID; never node-callable (CRUD_AUTHORITY).
 *   - GRANT_IS_NODE_BOUND: grant scope is minted via @cogni/scheduler-core scopes (nodeTaskScope embeds nodeId) so the M1 grant↔node binding is structural, not free-text.
 * Side-effects: IO (database advisory lock + schedule-row upsert, Temporal RPC, grant creation).
 * Links: packages/scheduler-core/src/services/syncNodeSchedules.ts, nodes/operator/app/src/bootstrap/jobs/syncGovernanceSchedules.job.ts, docs/design/node-temporal-tenant-interface.md
 * @public
 */

import { toUserId } from "@cogni/ids";
import {
  COGNI_SYSTEM_BILLING_ACCOUNT_ID,
  COGNI_SYSTEM_PRINCIPAL_USER_ID,
} from "@cogni/node-shared";
import type {
  NodeScheduleEntry,
  NodeScheduleRowState,
} from "@cogni/scheduler-core";
import {
  graphExecuteScope,
  nodeScheduleIdPrefix,
  nodeTaskScope,
  syncNodeSchedules,
} from "@cogni/scheduler-core";
import cronParser from "cron-parser";
import { and, eq } from "drizzle-orm";
import { getServiceDb } from "@/adapters/server/db/drizzle.service-client";
import { getContainer } from "@/bootstrap/container";
import { getNodeId, getNodeSchedules } from "@/shared/config";
import { schedules } from "@/shared/db/schema";
import { serverEnv } from "@/shared/env/server-env";

function computeNextRun(cron: string, timezone: string): Date {
  const interval = cronParser.parseExpression(cron, {
    currentDate: new Date(),
    tz: timezone,
  });
  return interval.next().toDate();
}

const TASK_DISPATCH_PREFIX = "task:dispatch:";
const GRAPH_EXECUTE_PREFIX = "graph:execute:";

/**
 * Re-derive the canonical, node-bound grant scope from the scope the pure service
 * computed. syncNodeSchedules emits a node-agnostic `task:dispatch:{route}` for
 * http-dispatch; we lift it to the M1 node-bound `task:dispatch:{nodeId}:{route}`
 * via scopes.ts (the single mint). Graph scopes already carry their id verbatim;
 * we re-mint through graphExecuteScope so every scope string originates from one place.
 */
function nodeBoundScope(nodeId: string, scope: string): string {
  if (scope.startsWith(TASK_DISPATCH_PREFIX)) {
    const route = scope.slice(TASK_DISPATCH_PREFIX.length);
    return nodeTaskScope(nodeId, route);
  }
  if (scope.startsWith(GRAPH_EXECUTE_PREFIX)) {
    return graphExecuteScope(scope.slice(GRAPH_EXECUTE_PREFIX.length));
  }
  return scope;
}

export interface NodeScheduleSyncSummary {
  created: number;
  updated: number;
  resumed: number;
  skipped: number;
  paused: number;
}

/**
 * Run the node-facing schedule sync job.
 *
 * 1. Acquires a PostgreSQL advisory lock (single-writer).
 * 2. Resolves deps from the application container.
 * 3. Mints a node-bound ExecutionGrant per schedule and calls syncNodeSchedules.
 */
export async function runNodeSchedulesSyncJob(): Promise<NodeScheduleSyncSummary> {
  const container = getContainer();
  const { log } = container;

  if (!serverEnv().NODE_SCHEDULES_ENABLED) {
    log.info({}, "Node schedules disabled, skipping sync");
    return { created: 0, updated: 0, resumed: 0, skipped: 0, paused: 0 };
  }

  log.info({}, "Starting node schedule sync job");

  // Advisory lock: non-blocking single-writer guard. Pin a single pool connection
  // so lock + unlock use the same session (session-scoped advisory locks only
  // release on the connection that acquired them).
  const serviceDb = getServiceDb();
  const reservedConn = await serviceDb.$client.reserve();
  const [lockRow] =
    await reservedConn`SELECT pg_try_advisory_lock(hashtext('node_schedules_sync')) AS acquired`;
  const acquired = (lockRow as { acquired: boolean } | undefined)?.acquired;
  if (!acquired) {
    reservedConn.release();
    log.info({}, "Node schedule sync already running, skipping");
    return { created: 0, updated: 0, resumed: 0, skipped: 0, paused: 0 };
  }

  try {
    const nodeId = getNodeId();
    const ownerUserId = COGNI_SYSTEM_PRINCIPAL_USER_ID;
    const systemUserId = toUserId(COGNI_SYSTEM_PRINCIPAL_USER_ID);
    // NodeScheduleConfig (repo-spec) and NodeScheduleEntry (scheduler-core) are the
    // same shape; only payload type-width differs (unknown ⊋ JsonValue, safe at
    // runtime — values are parsed JSON). Unifying the two types is a follow-up.
    const entries =
      getNodeSchedules() as unknown as readonly NodeScheduleEntry[];

    const result = await syncNodeSchedules(entries, {
      nodeId,
      ownerUserId,
      ensureNodeGrant: async (scope) => {
        const grant = await container.executionGrantPort.ensureGrant({
          userId: systemUserId,
          billingAccountId: COGNI_SYSTEM_BILLING_ACCOUNT_ID,
          scopes: [nodeBoundScope(nodeId, scope)],
        });
        return grant.id;
      },
      upsertNodeScheduleRow: async (params): Promise<NodeScheduleRowState> => {
        const nextRunAt = computeNextRun(params.cron, params.timezone);

        // Scope lookup to the system tenant to avoid cross-tenant collisions.
        const existingRows = await serviceDb
          .select({
            id: schedules.id,
            cron: schedules.cron,
            timezone: schedules.timezone,
            input: schedules.input,
          })
          .from(schedules)
          .where(
            and(
              eq(schedules.ownerUserId, params.ownerUserId),
              eq(schedules.temporalScheduleId, params.temporalScheduleId)
            )
          )
          .limit(1);
        const existing = existingRows[0];

        if (existing) {
          await serviceDb
            .update(schedules)
            .set({
              executionGrantId: params.executionGrantId,
              graphId: params.graphId,
              input: params.input,
              cron: params.cron,
              timezone: params.timezone,
              enabled: true,
              nextRunAt,
              updatedAt: new Date(),
            })
            .where(eq(schedules.id, existing.id));
          return {
            dbScheduleId: existing.id,
            priorCron: existing.cron,
            priorTimezone: existing.timezone,
            priorInput: (existing.input ??
              null) as NodeScheduleRowState["priorInput"],
            existed: true,
          };
        }

        const [row] = await serviceDb
          .insert(schedules)
          .values({
            temporalScheduleId: params.temporalScheduleId,
            ownerUserId: params.ownerUserId,
            executionGrantId: params.executionGrantId,
            graphId: params.graphId,
            input: params.input,
            cron: params.cron,
            timezone: params.timezone,
            enabled: true,
            nextRunAt,
          })
          .returning();
        if (!row) throw new Error("Insert returned no row");
        return {
          dbScheduleId: row.id,
          priorCron: null,
          priorTimezone: null,
          priorInput: null,
          existed: false,
        };
      },
      scheduleControl: container.scheduleControl,
      listNodeScheduleIds: () =>
        container.scheduleControl.listScheduleIds(nodeScheduleIdPrefix(nodeId)),
      disableScheduleRow: async (temporalScheduleId: string) => {
        // Direct DB update via serviceDb (same pattern as upsertNodeScheduleRow):
        // the Temporal pause is already handled by the sync service's prune step.
        await serviceDb
          .update(schedules)
          .set({ enabled: false, nextRunAt: null, updatedAt: new Date() })
          .where(
            and(
              eq(schedules.ownerUserId, ownerUserId),
              eq(schedules.temporalScheduleId, temporalScheduleId)
            )
          );
      },
      log,
    });

    log.info(
      {
        created: result.created.length,
        updated: result.updated.length,
        resumed: result.resumed.length,
        skipped: result.skipped.length,
        paused: result.paused.length,
      },
      "Node schedule sync complete"
    );

    return {
      created: result.created.length,
      updated: result.updated.length,
      resumed: result.resumed.length,
      skipped: result.skipped.length,
      paused: result.paused.length,
    };
  } finally {
    // Release advisory lock on the same connection that acquired it.
    await reservedConn`SELECT pg_advisory_unlock(hashtext('node_schedules_sync'))`;
    reservedConn.release();
  }
}
