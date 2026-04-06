// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/temporal-workflows/activity-types`
 * Purpose: Explicit activity interface definitions consumed by workflows via proxyActivities<T>().
 * Scope: Type-only — does not contain implementations or I/O. Input/output types mirror the worker's
 *   activity factories but live here so the package has no import dependency on the worker service.
 * Invariants:
 *   - Per ACTIVITY_TYPES_EXPLICIT: interfaces defined here, not inferred from factories
 *   - All input/output types are plain serializable objects (JSON-safe for Temporal wire format)
 *   - Per NO_SERVICE_IMPORTS: never imports from services/
 * Side-effects: none
 * Links: docs/spec/temporal-patterns.md, docs/spec/packages-architecture.md
 * @public
 */

// ---------------------------------------------------------------------------
// Scheduler Activities (graph-run CRUD + execution)
// ---------------------------------------------------------------------------

/** Formerly `Activities` — renamed for clarity. Same shape as ReturnType<typeof createActivities>. */
export interface SchedulerActivities {
  validateGrantActivity(input: {
    grantId: string;
    graphId: string;
  }): Promise<void>;

  createGraphRunActivity(input: {
    runId: string;
    graphId?: string;
    runKind?: string;
    triggerSource?: string;
    triggerRef?: string;
    requestedBy?: string;
    dbScheduleId?: string;
    scheduledFor?: string;
    stateKey?: string;
  }): Promise<void>;

  executeGraphActivity(input: {
    nodeId: string;
    temporalScheduleId?: string;
    graphId: string;
    executionGrantId: string | null;
    input: Record<string, unknown>;
    scheduledFor: string;
    runId: string;
  }): Promise<{
    ok: boolean;
    runId: string;
    traceId: string | null;
    errorCode?: string;
    structuredOutput?: unknown;
  }>;

  updateGraphRunActivity(input: {
    runId: string;
    status: "running" | "success" | "error" | "skipped" | "cancelled";
    traceId?: string | null;
    errorMessage?: string;
    errorCode?: string;
  }): Promise<void>;
}

// ---------------------------------------------------------------------------
// Review Activities (GitHub I/O for PR review workflow)
// ---------------------------------------------------------------------------

export interface ReviewActivities {
  createCheckRunActivity(input: {
    owner: string;
    repo: string;
    headSha: string;
    installationId: number;
  }): Promise<number>;

  fetchPrContextActivity(input: {
    owner: string;
    repo: string;
    prNumber: number;
    installationId: number;
  }): Promise<{
    evidence: Record<string, unknown>;
    gatesConfig: { gates: unknown[]; failOnError: boolean };
    rules: Record<string, unknown>;
    graphMessages: Array<{ role: string; content: string }>;
    responseFormat: { prompt: string; schemaId: string };
    model: string;
    repoSpecYaml?: string;
  }>;

  postReviewResultActivity(input: Record<string, unknown>): Promise<void>;
}

// ---------------------------------------------------------------------------
// Sweep Activities (queue-sweeping agent roles)
// ---------------------------------------------------------------------------

/** Work item summary returned by fetchWorkItemsActivity. */
export interface SweepWorkItem {
  id: string;
  title: string;
  status: string;
  priority?: number;
  rank?: number;
  summary?: string;
}

export interface SweepActivities {
  /** Fetch work items matching the role's queue filter, sorted by priority. */
  fetchWorkItemsActivity(input: {
    statuses?: string[];
    labels?: string[];
    types?: string[];
  }): Promise<SweepWorkItem[]>;

  /** Log sweep result and optionally post to Discord. */
  processSweepResultActivity(input: {
    roleId: string;
    itemId: string;
    itemTitle: string;
    outcome: "success" | "error" | "no_op";
    runId: string;
  }): Promise<void>;
}

// ---------------------------------------------------------------------------
// Ledger Activities (attribution pipeline I/O)
// ---------------------------------------------------------------------------

export interface LedgerActivities {
  ensureEpochForWindow(input: {
    periodStart: string;
    periodEnd: string;
    weightConfig: Record<string, number>;
  }): Promise<{
    epochId: string;
    status: string;
    isNew: boolean;
    weightConfig: Record<string, number>;
  }>;

  findStaleOpenEpoch(input: {
    periodStart: string;
    periodEnd: string;
  }): Promise<{
    staleEpoch: {
      epochId: string;
      weightConfig: Record<string, number>;
      periodStart: string;
      periodEnd: string;
    } | null;
  }>;

  transitionEpochForWindow(input: {
    periodStart: string;
    periodEnd: string;
    weightConfig: Record<string, number>;
    closeParams: {
      staleEpochId: string;
      staleWeightConfig: Record<string, number>;
      approvers: string[];
      attributionPipeline: string;
      evaluations: ReadonlyArray<{
        nodeId: string;
        epochId: string;
        evaluationRef: string;
        status: "draft" | "locked";
        algoRef: string;
        inputsHash: string;
        payloadHash: string;
        payloadJson: Record<string, unknown>;
      }>;
      artifactsHash: string;
    };
  }): Promise<{
    epochId: string;
    status: string;
    isNew: boolean;
    weightConfig: Record<string, number>;
    closedStaleEpochId: string;
  }>;

  ensurePoolComponents(input: {
    epochId: string;
    baseIssuanceCredits: string;
  }): Promise<{ componentsEnsured: number }>;

  loadCursor(input: {
    source: string;
    stream: string;
    sourceRef: string;
  }): Promise<string | null>;

  collectFromSource(input: {
    source: string;
    streams: string[];
    cursorValue: string | null;
    periodStart: string;
    periodEnd: string;
  }): Promise<{
    events: unknown[];
    nextCursorValue: string;
    nextCursorStreamId: string;
    producerVersion: string;
  }>;

  insertReceipts(input: {
    events: unknown[];
    producerVersion: string;
  }): Promise<void>;

  saveCursor(input: {
    source: string;
    stream: string;
    sourceRef: string;
    cursorValue: string;
  }): Promise<void>;

  resolveStreams(input: { source: string }): Promise<{ streams: string[] }>;

  materializeSelection(input: {
    epochId: string;
    attributionPipeline: string;
  }): Promise<{
    totalReceipts: number;
    newSelections: number;
    resolved: number;
    unresolved: number;
  }>;

  computeAllocations(input: {
    epochId: string;
    attributionPipeline: string;
    weightConfig: Record<string, number>;
  }): Promise<{
    totalAllocations: number;
    totalProposedUnits: string;
  }>;

  finalizeEpoch(input: {
    epochId: string;
    signature: string;
    signerAddress: string;
  }): Promise<{
    statementId: string;
    poolTotalCredits: string;
    finalAllocationSetHash: string;
    statementLineCount: number;
  }>;
}

// ---------------------------------------------------------------------------
// Enrichment Activities (draft/locked evaluation pipeline)
// ---------------------------------------------------------------------------

export interface EnrichmentActivities {
  deriveWeightConfig(input: {
    attributionPipeline: string;
  }): Promise<{ weightConfig: Record<string, number> }>;

  evaluateEpochDraft(input: {
    epochId: string;
    attributionPipeline: string;
  }): Promise<{ evaluationRefs: string[]; receiptCount: number }>;

  buildLockedEvaluations(input: {
    epochId: string;
    attributionPipeline: string;
  }): Promise<{
    evaluations: ReadonlyArray<{
      nodeId: string;
      epochId: string;
      evaluationRef: string;
      status: "draft" | "locked";
      algoRef: string;
      inputsHash: string;
      payloadHash: string;
      payloadJson: Record<string, unknown>;
    }>;
    artifactsHash: string;
  }>;
}
