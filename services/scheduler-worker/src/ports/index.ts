// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/scheduler-worker-service/ports`
 * Purpose: Port barrel — interface contracts + typed error classes for worker HTTP-delegated persistence (task.0280).
 * Scope: Interfaces + throwable error classes only. No framework deps, no concrete adapters, no runtime I/O. Error classes live here (not adapters/) so activities/ can import them without violating the clean-architecture boundary.
 * Invariants: Named exports only; activities/ imports only from this module; adapter impl lives in adapters/run-http.ts.
 * Side-effects: none
 * Links: Consumed by activities/, workflows/, bootstrap/, and adapters/run-http.ts
 * @public
 */

// Ledger ports from @cogni/attribution-ledger
export type { AttributionStore } from "@cogni/attribution-ledger";
// Ingestion ports from @cogni/ingestion-core
export type {
  CollectParams,
  CollectResult,
  DataSourceRegistration,
  PollAdapter,
  SourceAdapter,
  StreamCursor,
  WebhookNormalizer,
} from "@cogni/ingestion-core";

// Scheduler run + grant writers are HTTP-delegated (task.0280). Port interfaces
// live here; HTTP adapters in services/scheduler-worker/src/adapters/run-http.ts
// implement them. Activities import these types only — never the adapter module.
// The direct-DB ports (GraphRunRepository, ExecutionGrantWorkerPort) stay in
// @cogni/scheduler-core for node-app use.

import type { ActorId } from "@cogni/ids";
import type {
  InternalReviewCreateCheckRunInput,
  InternalReviewPostPrCommentInput,
  InternalReviewPostPrCommentOutput,
  InternalReviewPrContextInput,
  InternalReviewPrContextOutput,
  InternalReviewUpdateCheckRunInput,
} from "@cogni/node-contracts";
import type { ExecutionGrant, GraphRunKind } from "@cogni/scheduler-core";

/** Write subset of graph_runs persistence, routed by nodeId. */
export interface GraphRunHttpWriter {
  createRun: (
    actorId: ActorId,
    nodeId: string,
    params: {
      runId: string;
      graphId?: string;
      runKind?: GraphRunKind;
      triggerSource?: string;
      triggerRef?: string;
      requestedBy?: string;
      scheduleId?: string;
      scheduledFor?: Date;
      stateKey?: string;
    }
  ) => Promise<void>;

  markRunStarted: (
    actorId: ActorId,
    nodeId: string,
    runId: string,
    traceId?: string
  ) => Promise<void>;

  markRunCompleted: (
    actorId: ActorId,
    nodeId: string,
    runId: string,
    status: "success" | "error" | "skipped" | "cancelled",
    errorMessage?: string,
    errorCode?: string
  ) => Promise<void>;
}

/**
 * GitHub-plane client for PR review, HTTP-delegated to the operator's internal
 * review API (bug.5000). The worker holds no GitHub credential; every call
 * routes to the operator with Bearer SCHEDULER_API_TOKEN.
 */
export interface ReviewHttpClient {
  createCheckRun: (input: InternalReviewCreateCheckRunInput) => Promise<number>;
  updateCheckRun: (input: InternalReviewUpdateCheckRunInput) => Promise<void>;
  postPrComment: (
    input: InternalReviewPostPrCommentInput
  ) => Promise<InternalReviewPostPrCommentOutput>;
  fetchPrContext: (
    input: InternalReviewPrContextInput
  ) => Promise<InternalReviewPrContextOutput>;
}

/** Grant validation routed by nodeId — returns the grant on success, throws on 403. */
export interface ExecutionGrantHttpValidator {
  validateGrantForGraph: (
    actorId: ActorId,
    nodeId: string,
    grantId: string,
    graphId: string
  ) => Promise<ExecutionGrant>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Error types raised by the HTTP adapters. Defined in the ports module so that
// activities/ can import them without violating the clean-architecture rule
// (activities never import adapters). The adapter implementation throws these;
// activities catch and translate to Temporal ApplicationFailure.
// ─────────────────────────────────────────────────────────────────────────────

/** Any HTTP-layer failure not mapped to a grant-specific error. */
export class RunHttpClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean
  ) {
    super(message);
    this.name = "RunHttpClientError";
  }
}

export class GrantNotFoundError extends Error {
  readonly code = "grant_not_found" as const;
  constructor(grantId: string) {
    super(`Grant not found: ${grantId}`);
    this.name = "GrantNotFoundError";
  }
}
export class GrantExpiredError extends Error {
  readonly code = "grant_expired" as const;
  constructor(grantId: string) {
    super(`Grant expired: ${grantId}`);
    this.name = "GrantExpiredError";
  }
}
export class GrantRevokedError extends Error {
  readonly code = "grant_revoked" as const;
  constructor(grantId: string) {
    super(`Grant revoked: ${grantId}`);
    this.name = "GrantRevokedError";
  }
}
export class GrantScopeMismatchError extends Error {
  readonly code = "grant_scope_mismatch" as const;
  constructor(grantId: string, graphId: string) {
    super(`Grant scope mismatch: ${grantId} cannot execute ${graphId}`);
    this.name = "GrantScopeMismatchError";
  }
}
