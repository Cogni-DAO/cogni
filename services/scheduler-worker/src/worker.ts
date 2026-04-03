// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/scheduler-worker-service/worker`
 * Purpose: Temporal Worker bootstrap and lifecycle management.
 * Scope: Creates Temporal Worker with activities and workflows. Does not contain business logic.
 * Invariants:
 *   - Per WORKER_NEVER_CONTROLS_SCHEDULES: Does NOT depend on ScheduleControlPort
 *   - Per TEMPORAL_DETERMINISM: Workflows are bundled separately from activities
 *   - All dependencies injected via ServiceContainer from bootstrap/container.ts
 *   - No concrete adapter imports — uses container for wiring
 * Side-effects: IO (connects to Temporal, starts worker)
 * Links: docs/spec/scheduler.md, docs/spec/temporal-patterns.md
 * @internal
 */

import { createRequire } from "node:module";
import { NativeConnection, Worker } from "@temporalio/worker";

import { createActivities } from "./activities/index.js";
import { createReviewActivities } from "./activities/review.js";
import { createSweepActivities } from "./activities/sweep.js";
import { createContainer } from "./bootstrap/container.js";
import type { Env } from "./bootstrap/env.js";
import { logWorkerEvent, WORKER_EVENT_NAMES } from "./observability/index.js";
import type { Logger } from "./observability/logger.js";

const require = createRequire(import.meta.url);

/**
 * Configuration for starting the Temporal scheduler worker.
 */
export interface SchedulerWorkerConfig {
  /** Validated environment */
  env: Env;
  /** Logger instance */
  logger: Logger;
}

/**
 * Starts the Temporal scheduler worker with injected configuration.
 * Returns a cleanup function to stop the worker gracefully.
 */
export async function startSchedulerWorker(
  config: SchedulerWorkerConfig
): Promise<{ shutdown: () => Promise<void> }> {
  const { env, logger } = config;

  logWorkerEvent(logger, WORKER_EVENT_NAMES.LIFECYCLE_STARTING, {
    temporalAddress: env.TEMPORAL_ADDRESS,
    namespace: env.TEMPORAL_NAMESPACE,
    taskQueue: env.TEMPORAL_TASK_QUEUE,
    phase: "temporal_connect",
  });

  // Create Temporal connection
  const connection = await NativeConnection.connect({
    address: env.TEMPORAL_ADDRESS,
  });

  // Build service container (all concrete adapter wiring)
  const container = createContainer(env, logger);

  // Create activities with injected deps (typed against ports)
  const graphActivities = createActivities({
    grantAdapter: container.grantAdapter,
    runAdapter: container.runAdapter,
    config: container.config,
    logger:
      container.logger.child?.({ component: "activities" }) ?? container.logger,
  });

  // Create review activities (GitHub API for PR review workflow)
  const reviewActivities =
    env.GH_REVIEW_APP_ID && env.GH_REVIEW_APP_PRIVATE_KEY_BASE64
      ? createReviewActivities({
          ghAppId: env.GH_REVIEW_APP_ID,
          ghPrivateKey: Buffer.from(
            env.GH_REVIEW_APP_PRIVATE_KEY_BASE64,
            "base64"
          ).toString("utf-8"),
          logger:
            container.logger.child?.({ component: "review-activities" }) ??
            container.logger,
        })
      : {};

  // Create sweep activities (queue-sweeping agent roles)
  // Sweeps are operator-only; extract operator URL from node endpoints.
  const operatorBaseUrl = container.config.nodeEndpoints.get("operator");
  if (!operatorBaseUrl) {
    throw new Error(
      'COGNI_NODE_ENDPOINTS must include "operator" entry for sweep activities'
    );
  }
  const sweepActivities = createSweepActivities({
    config: {
      operatorBaseUrl,
      schedulerApiToken: container.config.schedulerApiToken,
    },
    logger:
      container.logger.child?.({ component: "sweep-activities" }) ??
      container.logger,
  });

  // Create Temporal Worker
  const worker = await Worker.create({
    connection,
    namespace: env.TEMPORAL_NAMESPACE,
    taskQueue: env.TEMPORAL_TASK_QUEUE,
    workflowsPath: require.resolve("@cogni/temporal-workflows/scheduler"),
    activities: { ...graphActivities, ...reviewActivities, ...sweepActivities },
  });

  logWorkerEvent(logger, WORKER_EVENT_NAMES.LIFECYCLE_STARTING, {
    namespace: env.TEMPORAL_NAMESPACE,
    taskQueue: env.TEMPORAL_TASK_QUEUE,
    phase: "worker_created",
  });

  // Start the worker (runs in background)
  const runPromise = worker.run();

  // Handle worker errors
  runPromise.catch((err) => {
    logger.error(
      { event: WORKER_EVENT_NAMES.LIFECYCLE_FATAL, err },
      WORKER_EVENT_NAMES.LIFECYCLE_FATAL
    );
  });

  logWorkerEvent(logger, WORKER_EVENT_NAMES.LIFECYCLE_STARTING, {
    phase: "polling",
  });

  // Return shutdown function
  return {
    shutdown: async () => {
      logWorkerEvent(logger, WORKER_EVENT_NAMES.LIFECYCLE_SHUTDOWN, {
        phase: "temporal_worker",
      });
      worker.shutdown();
      await runPromise;
      await connection.close();
      logWorkerEvent(
        logger,
        WORKER_EVENT_NAMES.LIFECYCLE_SHUTDOWN_COMPLETE,
        {}
      );
    },
  };
}
