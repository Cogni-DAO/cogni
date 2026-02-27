// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/scheduler-worker-service/ledger-worker`
 * Purpose: Temporal Worker for the ledger-tasks queue — epoch collection workflows.
 * Scope: Creates Temporal Worker with ledger activities and CollectEpochWorkflow. Does not contain business logic.
 * Invariants:
 *   - Separate task queue (ledger-tasks) from scheduler-tasks
 *   - All dependencies injected via LedgerContainer from bootstrap/container.ts
 *   - Per TEMPORAL_DETERMINISM: Workflows are bundled separately from activities
 * Side-effects: IO (connects to Temporal, starts worker)
 * Links: docs/spec/epoch-ledger.md, docs/spec/temporal-patterns.md
 * @internal
 */

import { NativeConnection, Worker } from "@temporalio/worker";

import { createEnrichmentActivities } from "./activities/enrichment.js";
import { createLedgerActivities } from "./activities/ledger.js";
import type { LedgerContainer } from "./bootstrap/container.js";
import type { Env } from "./bootstrap/env.js";
import type { Logger } from "./observability/logger.js";

/** Task queue for ledger workflows — separate from scheduler-tasks */
export const LEDGER_TASK_QUEUE = "ledger-tasks";

export interface LedgerWorkerConfig {
  env: Env;
  logger: Logger;
  container: LedgerContainer;
}

/**
 * Starts the Temporal ledger worker for epoch collection workflows.
 * Returns a cleanup function to stop the worker gracefully.
 */
export async function startLedgerWorker(
  config: LedgerWorkerConfig
): Promise<{ shutdown: () => Promise<void> }> {
  const { env, logger, container } = config;

  logger.info(
    {
      temporalAddress: env.TEMPORAL_ADDRESS,
      namespace: env.TEMPORAL_NAMESPACE,
      taskQueue: LEDGER_TASK_QUEUE,
      nodeId: container.nodeId,
      scopeId: container.scopeId,
    },
    "Starting ledger worker"
  );

  const connection = await NativeConnection.connect({
    address: env.TEMPORAL_ADDRESS,
  });

  const ledgerActivities = createLedgerActivities({
    ledgerStore: container.ledgerStore,
    sourceAdapters: container.sourceAdapters,
    nodeId: container.nodeId,
    scopeId: container.scopeId,
    logger: container.logger,
  });

  const enrichmentActivities = createEnrichmentActivities({
    ledgerStore: container.ledgerStore,
    nodeId: container.nodeId,
    logger: container.logger,
  });

  const activities = { ...ledgerActivities, ...enrichmentActivities };

  const worker = await Worker.create({
    connection,
    namespace: env.TEMPORAL_NAMESPACE,
    taskQueue: LEDGER_TASK_QUEUE,
    workflowsPath: new URL("./workflows/ledger-workflows.js", import.meta.url)
      .pathname,
    activities,
  });

  logger.info(
    { namespace: env.TEMPORAL_NAMESPACE, taskQueue: LEDGER_TASK_QUEUE },
    "Ledger Worker created"
  );

  const runPromise = worker.run();

  runPromise.catch((err) => {
    logger.error({ err }, "Ledger worker run failed");
  });

  logger.info({}, "Ledger worker started, polling for tasks");

  return {
    shutdown: async () => {
      logger.info({}, "Shutting down Ledger Worker");
      worker.shutdown();
      await runPromise;
      await connection.close();
      logger.info({}, "Ledger Worker shutdown complete");
    },
  };
}
