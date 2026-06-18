// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@bootstrap/jobs/syncNodeSchedules.job`
 * Purpose: Job module that wires this node's repo-spec recurring `schedules` into Temporal via syncNodeSchedules.
 * Scope: Acquires advisory lock, resolves deps from the container, mints node-bound grants, and reconciles. Does not contain reconcile logic (that is the pure syncNodeSchedules service).
 * Invariants:
 *   - SINGLE_WRITER: pg_advisory_lock on a reserved pinned pool connection prevents concurrent runs (mirror of governance sync).
 *   - SYSTEM_PRINCIPAL: rows owned by COGNI_SYSTEM_PRINCIPAL_USER_ID (same tenant + table as governance schedules).
 *   - SCOPE_IS_NODE_BOUND (M1): the grant scope is re-derived to `task:dispatch:<nodeId>:<route>` so the worker's validateGrantForScope passes; the service's per-route scope is route-only.
 * Side-effects: IO (database advisory lock, Temporal RPC, grant creation)
 * Links: packages/scheduler-core/src/services/syncNodeSchedules.ts, docs/spec/temporal-patterns.md
 * @public
 */

import { toUserId } from "@cogni/ids";
import {
  COGNI_SYSTEM_BILLING_ACCOUNT_ID,
  COGNI_SYSTEM_PRINCIPAL_USER_ID,
} from "@cogni/node-shared";
import {
  graphExecuteScope,
  type NodeScheduleEntry,
  type NodeScheduleRowState,
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

function computeNextRun(cron: string, timezone: string): Date {
  const interval = cronParser.parseExpression(cron, {
    currentDate: new Date(),
    tz: timezone,
  });
  return interval.next().toDate();
}

export interface NodeScheduleSyncSummary {
  created: number;
  updated: number;
  resumed: number;
  skipped: number;
  paused: number;
}

/** The scheduler-core JsonValue, surfaced via indexed access (no type-fest dep). */
type SchedulePayload = NodeScheduleEntry["payload"];
type ScheduleInput = NodeScheduleRowState["priorInput"];

/**
 * Map a NodeScheduleConfig (repo-spec accessor shape) onto the scheduler-core
 * NodeScheduleEntry the pure service consumes. Both shapes are structurally
 * identical (route XOR graph, opaque payload); this is a typed copy with the
 * payload narrowed to the scheduler-core JsonValue map.
 */
function toEntry(
  s: ReturnType<typeof getNodeSchedules>[number]
): NodeScheduleEntry {
  return {
    id: s.id,
    nodeId: s.nodeId,
    cron: s.cron,
    timezone: s.timezone,
    kind: s.kind,
    ...(s.route !== undefined ? { route: s.route } : {}),
    ...(s.graph !== undefined ? { graph: s.graph } : {}),
    payload: s.payload as SchedulePayload,
  };
}

/**
 * Run the node-schedules sync job.
 *
 * 1. Acquires a PostgreSQL advisory lock (single-writer).
 * 2. Resolves deps from the application container.
 * 3. Calls syncNodeSchedules with this node's repo-spec `schedules`.
 */
export async function runNodeSchedulesSyncJob(): Promise<NodeScheduleSyncSummary> {
  const container = getContainer();
  const { log } = container;

  const nodeId = getNodeId();
  const entries = getNodeSchedules().map(toEntry);

  log.info(
    { nodeId, count: entries.length },
    "Starting node schedule sync job"
  );

  // Advisory lock: non-blocking single-writer guard. Pin one pool connection so
  // lock + unlock share the same session (session-scoped advisory locks only
  // release on the connection that acquired them). Mirror of governance sync.
  const serviceDb = getServiceDb();
  const reservedConn = await serviceDb.$client.reserve();
  const [lockRow] =
    await reservedConn`SELECT pg_try_advisory_lock(hashtext('node_schedules_sync')) AS acquired`;
  const acquired = (lockRow as { acquired: boolean } | undefined)?.acquired;
  if (!acquired) {
    reservedConn.release();
    log.info({ nodeId }, "Node schedule sync already running, skipping");
    return { created: 0, updated: 0, resumed: 0, skipped: 0, paused: 0 };
  }

  try {
    const systemUserId = toUserId(COGNI_SYSTEM_PRINCIPAL_USER_ID);

    const result = await syncNodeSchedules(entries, {
      nodeId,
      ownerUserId: COGNI_SYSTEM_PRINCIPAL_USER_ID,
      ensureNodeGrant: async (scope: string) => {
        // SCOPE_IS_NODE_BOUND (M1): the pure service emits a route-only scope
        // (`task:dispatch:<route>`) for http-dispatch; the worker validates the
        // node-bound `task:dispatch:<nodeId>:<route>`. Re-derive the node-bound
        // scope here (the single mint lives in scheduler-core scopes.ts) so the
        // minted grant matches what validateGrantForScope asserts. Graph scopes
        // (`graph:execute:<graphId>`) are already node-agnostic — pass through.
        const ROUTE_PREFIX = "task:dispatch:";
        const boundScope = scope.startsWith(ROUTE_PREFIX)
          ? nodeTaskScope(nodeId, scope.slice(ROUTE_PREFIX.length))
          : scope.startsWith("graph:execute:")
            ? scope
            : graphExecuteScope(scope);
        const grant = await container.executionGrantPort.ensureGrant({
          userId: systemUserId,
          billingAccountId: COGNI_SYSTEM_BILLING_ACCOUNT_ID,
          scopes: [boundScope],
        });
        return grant.id;
      },
      upsertNodeScheduleRow: async (params): Promise<NodeScheduleRowState> => {
        const nextRunAt = computeNextRun(params.cron, params.timezone);

        // SELECT the prior row BEFORE upserting — the pure service needs the
        // STORED cron/timezone/input for REAL_CRON_DRIFT detection (Temporal
        // compiles crons to calendars, so the DB is the SSOT).
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
            priorInput: (existing.input ?? null) as ScheduleInput,
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
        // Direct DB update via serviceDb (same pattern as upsertNodeScheduleRow,
        // and identical to governance's disableSchedule). The Temporal pause is
        // already handled by the sync service's prune step.
        await serviceDb
          .update(schedules)
          .set({ enabled: false, nextRunAt: null, updatedAt: new Date() })
          .where(
            and(
              eq(schedules.ownerUserId, COGNI_SYSTEM_PRINCIPAL_USER_ID),
              eq(schedules.temporalScheduleId, temporalScheduleId)
            )
          );
      },
      log,
    });

    const summary: NodeScheduleSyncSummary = {
      created: result.created.length,
      updated: result.updated.length,
      resumed: result.resumed.length,
      skipped: result.skipped.length,
      paused: result.paused.length,
    };

    log.info({ nodeId, ...summary }, "Node schedule sync complete");
    return summary;
  } finally {
    await reservedConn`SELECT pg_advisory_unlock(hashtext('node_schedules_sync'))`;
    reservedConn.release();
  }
}
