// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/scheduler-worker-service/bootstrap/container`
 * Purpose: Composition root — wires concrete adapters to port interfaces.
 * Scope: All adapter construction lives here. Returns typed container against port interfaces.
 * Invariants:
 * - Only file that imports concrete adapter packages (@cogni/db-client)
 * - activities/ and workflows/ import ports only, never this module
 * Side-effects: Creates DB connection pool
 * Links: services/scheduler-worker/src/ports/index.ts
 * @internal
 */

import {
  DrizzleExecutionGrantWorkerAdapter,
  DrizzleLedgerAdapter,
  DrizzleScheduleRunAdapter,
} from "@cogni/db-client";
import { createServiceDbClient } from "@cogni/db-client/service";

import {
  GitHubAppTokenProvider,
  GitHubSourceAdapter,
} from "../adapters/ingestion/index.js";
import type { Logger } from "../observability/logger.js";

import type {
  ActivityLedgerStore,
  ExecutionGrantWorkerPort,
  ScheduleRunRepository,
  SourceAdapter,
} from "../ports/index.js";
import type { Env } from "./env.js";

/**
 * Service container — all deps typed against port interfaces.
 * Passed to createActivities() and any future consumers.
 */
export interface ServiceContainer {
  grantAdapter: ExecutionGrantWorkerPort;
  runAdapter: ScheduleRunRepository;
  config: {
    appBaseUrl: string;
    schedulerApiToken: string;
  };
  logger: Logger;
}

/**
 * Ledger container — deps for ledger activities.
 * Created separately because ledger env vars (NODE_ID, SCOPE_ID) are optional.
 */
export interface LedgerContainer {
  ledgerStore: ActivityLedgerStore;
  sourceAdapters: ReadonlyMap<string, SourceAdapter>;
  nodeId: string;
  scopeId: string;
  logger: Logger;
}

/**
 * Build the service container from validated env and logger.
 * This is the only place that instantiates concrete adapters.
 */
export function createContainer(config: Env, logger: Logger): ServiceContainer {
  const db = createServiceDbClient(config.DATABASE_URL);

  return {
    grantAdapter: new DrizzleExecutionGrantWorkerAdapter(
      db,
      logger.child?.({ component: "grant-adapter" }) ?? logger
    ),
    runAdapter: new DrizzleScheduleRunAdapter(
      db,
      logger.child?.({ component: "run-adapter" }) ?? logger
    ),
    config: {
      appBaseUrl: config.APP_BASE_URL,
      schedulerApiToken: config.SCHEDULER_API_TOKEN,
    },
    logger,
  };
}

/**
 * Build ledger container. Requires NODE_ID and SCOPE_ID in env.
 * Returns null if ledger env vars are not configured.
 */
export function createLedgerContainer(
  config: Env,
  logger: Logger
): LedgerContainer | null {
  if (!config.NODE_ID || !config.SCOPE_ID) {
    logger.info("NODE_ID or SCOPE_ID not set — ledger worker disabled");
    return null;
  }

  const db = createServiceDbClient(config.DATABASE_URL);
  const ledgerLogger = logger.child?.({ component: "ledger" }) ?? logger;

  const ledgerStore = new DrizzleLedgerAdapter(db, config.SCOPE_ID);

  // Build source adapters
  const adapters = new Map<string, SourceAdapter>();

  if (
    config.GITHUB_REVIEW_APP_ID &&
    config.GITHUB_REVIEW_APP_PRIVATE_KEY_BASE64
  ) {
    const privateKey = Buffer.from(
      config.GITHUB_REVIEW_APP_PRIVATE_KEY_BASE64,
      "base64"
    ).toString("utf-8");

    const tokenProvider = new GitHubAppTokenProvider({
      appId: config.GITHUB_REVIEW_APP_ID,
      privateKey,
      installationId: config.GITHUB_REVIEW_INSTALLATION_ID,
    });

    const repos =
      config.GITHUB_REPOS?.split(",")
        .map((r) => r.trim())
        .filter(Boolean) ?? [];

    if (repos.length > 0) {
      adapters.set(
        "github",
        new GitHubSourceAdapter({ tokenProvider, repos }, ledgerLogger)
      );
    } else {
      logger.warn(
        "GITHUB_REVIEW_APP_ID set but GITHUB_REPOS empty — GitHub adapter skipped"
      );
    }
  }

  return {
    ledgerStore,
    sourceAdapters: adapters,
    nodeId: config.NODE_ID,
    scopeId: config.SCOPE_ID,
    logger: ledgerLogger,
  };
}
