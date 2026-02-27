// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/scheduler-worker/tests/enrichment-activities.test`
 * Purpose: Verifies evaluateEpochDraft and buildLockedEvaluations activity behavior — payload structure, idempotency, and Temporal wire-format safety.
 * Scope: Covers echo enricher (cogni.echo.v0) with mocked store. Does NOT cover workflow orchestration or DB integration.
 * Invariants:
 * - ENRICHER_IDEMPOTENT: Same receipts produce same hashes across draft and locked runs.
 * - BIGINT_WIRE_SAFE: buildLockedEvaluations output survives JSON.stringify (no BigInt in wire format).
 * Side-effects: none (mocked store)
 * Links: services/scheduler-worker/src/activities/enrichment.ts
 * @internal
 */

import type {
  AttributionStore,
  SelectedReceiptWithMetadata,
} from "@cogni/attribution-ledger";
import { describe, expect, it, vi } from "vitest";

import {
  createEnrichmentActivities,
  ECHO_ALGO_REF,
  ECHO_EVALUATION_REF,
} from "../src/activities/enrichment.js";

const NODE_ID = "aaaaaaaa-0000-0000-0000-000000000001";

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: () => mockLogger,
} as unknown as Parameters<typeof createEnrichmentActivities>[0]["logger"];

function makeMockStore(
  overrides: Partial<AttributionStore> = {}
): AttributionStore {
  return {
    createEpoch: vi.fn(),
    getOpenEpoch: vi.fn().mockResolvedValue(null),
    getEpochByWindow: vi.fn().mockResolvedValue(null),
    getEpoch: vi.fn(),
    listEpochs: vi.fn(),
    closeIngestion: vi.fn(),
    closeIngestionWithEvaluations: vi.fn(),
    finalizeEpoch: vi.fn(),
    upsertDraftEvaluation: vi.fn(),
    getEvaluationsForEpoch: vi.fn().mockResolvedValue([]),
    getEvaluation: vi.fn().mockResolvedValue(null),
    getSelectedReceiptsWithMetadata: vi.fn().mockResolvedValue([]),
    insertIngestionReceipts: vi.fn(),
    getReceiptsForWindow: vi.fn(),
    upsertSelection: vi.fn(),
    getSelectionForEpoch: vi.fn(),
    getUnresolvedSelection: vi.fn(),
    insertAllocations: vi.fn(),
    upsertAllocations: vi.fn(),
    deleteStaleAllocations: vi.fn(),
    updateAllocationFinalUnits: vi.fn(),
    getAllocationsForEpoch: vi.fn(),
    getSelectedReceiptsForAllocation: vi.fn().mockResolvedValue([]),
    upsertCursor: vi.fn(),
    getCursor: vi.fn().mockResolvedValue(null),
    insertPoolComponent: vi.fn(),
    getPoolComponentsForEpoch: vi.fn(),
    insertEpochStatement: vi.fn(),
    getStatementForEpoch: vi.fn(),
    insertStatementSignature: vi.fn(),
    getSignaturesForStatement: vi.fn(),
    insertSelectionDoNothing: vi.fn(),
    resolveIdentities: vi.fn().mockResolvedValue(new Map()),
    finalizeEpochAtomic: vi.fn(),
    getUnselectedReceipts: vi.fn().mockResolvedValue([]),
    updateSelectionUserId: vi.fn(),
    ...overrides,
  } as AttributionStore;
}

function makeReceipts(count: number): SelectedReceiptWithMetadata[] {
  return Array.from({ length: count }, (_, i) => ({
    receiptId: `ev-${i}`,
    userId: i % 2 === 0 ? "user-aaa" : "user-bbb",
    source: "github",
    eventType: i % 3 === 0 ? "pr_merged" : "review_submitted",
    included: true,
    weightOverrideMilli: null,
    metadata: { title: `PR #${i}` },
    payloadHash: `hash-${i}`,
  }));
}

// ── evaluateEpochDraft ────────────────────────────────────────────

describe("evaluateEpochDraft", () => {
  it("produces correct echo payload structure", async () => {
    const receipts = makeReceipts(5);
    const store = makeMockStore({
      getSelectedReceiptsWithMetadata: vi.fn().mockResolvedValue(receipts),
    });

    const { evaluateEpochDraft } = createEnrichmentActivities({
      attributionStore: store,
      nodeId: NODE_ID,
      logger: mockLogger,
    });

    const result = await evaluateEpochDraft({ epochId: "1" });

    expect(result.evaluationRef).toBe(ECHO_EVALUATION_REF);
    expect(result.receiptCount).toBe(5);

    // Verify upsertDraftEvaluation was called with correct payload structure
    expect(store.upsertDraftEvaluation).toHaveBeenCalledOnce();
    const call = vi.mocked(store.upsertDraftEvaluation).mock.calls[0][0];
    expect(call.evaluationRef).toBe(ECHO_EVALUATION_REF);
    expect(call.algoRef).toBe(ECHO_ALGO_REF);
    expect(call.status).toBe("draft");
    expect(call.nodeId).toBe(NODE_ID);
    expect(call.epochId).toBe(1n);

    // Verify payload shape
    const payload = call.payloadJson as {
      totalEvents: number;
      byEventType: Record<string, number>;
      byUserId: Record<string, number>;
    };
    expect(payload.totalEvents).toBe(5);
    expect(payload.byEventType).toBeDefined();
    expect(payload.byUserId).toBeDefined();
    expect(payload.byUserId["user-aaa"]).toBe(3);
    expect(payload.byUserId["user-bbb"]).toBe(2);
  });

  it("calls upsertDraftEvaluation with status='draft'", async () => {
    const store = makeMockStore({
      getSelectedReceiptsWithMetadata: vi
        .fn()
        .mockResolvedValue(makeReceipts(2)),
    });

    const { evaluateEpochDraft } = createEnrichmentActivities({
      attributionStore: store,
      nodeId: NODE_ID,
      logger: mockLogger,
    });

    await evaluateEpochDraft({ epochId: "1" });

    const call = vi.mocked(store.upsertDraftEvaluation).mock.calls[0][0];
    expect(call.status).toBe("draft");
  });

  it("handles no receipts — writes evaluation with empty counts", async () => {
    const store = makeMockStore({
      getSelectedReceiptsWithMetadata: vi.fn().mockResolvedValue([]),
    });

    const { evaluateEpochDraft } = createEnrichmentActivities({
      attributionStore: store,
      nodeId: NODE_ID,
      logger: mockLogger,
    });

    const result = await evaluateEpochDraft({ epochId: "1" });

    expect(result.receiptCount).toBe(0);
    expect(store.upsertDraftEvaluation).toHaveBeenCalledOnce();

    const payload = vi.mocked(store.upsertDraftEvaluation).mock.calls[0][0]
      .payloadJson as { totalEvents: number };
    expect(payload.totalEvents).toBe(0);
  });
});

// ── buildLockedEvaluations ─────────────────────────────────────────

describe("buildLockedEvaluations", () => {
  it("returns evaluations and artifactsHash without writing to store", async () => {
    const receipts = makeReceipts(3);
    const store = makeMockStore({
      getSelectedReceiptsWithMetadata: vi.fn().mockResolvedValue(receipts),
    });

    const { buildLockedEvaluations } = createEnrichmentActivities({
      attributionStore: store,
      nodeId: NODE_ID,
      logger: mockLogger,
    });

    const result = await buildLockedEvaluations({ epochId: "1" });

    expect(result.evaluations).toHaveLength(1);
    expect(result.evaluations[0].evaluationRef).toBe(ECHO_EVALUATION_REF);
    expect(result.evaluations[0].status).toBe("locked");
    expect(result.artifactsHash).toMatch(/^[a-f0-9]{64}$/);

    // Should NOT write to store
    expect(store.upsertDraftEvaluation).not.toHaveBeenCalled();
    expect(store.closeIngestionWithEvaluations).not.toHaveBeenCalled();
  });

  it("returns valid artifactsHash", async () => {
    const store = makeMockStore({
      getSelectedReceiptsWithMetadata: vi
        .fn()
        .mockResolvedValue(makeReceipts(2)),
    });

    const { buildLockedEvaluations } = createEnrichmentActivities({
      attributionStore: store,
      nodeId: NODE_ID,
      logger: mockLogger,
    });

    const result = await buildLockedEvaluations({ epochId: "1" });
    expect(result.artifactsHash).toMatch(/^[a-f0-9]{64}$/);
  });
});

// ── Idempotency ─────────────────────────────────────────────────

describe("idempotency", () => {
  it("same receipts produce same hashes across evaluateEpochDraft and buildLockedEvaluations", async () => {
    const receipts = makeReceipts(4);
    const store = makeMockStore({
      getSelectedReceiptsWithMetadata: vi.fn().mockResolvedValue(receipts),
    });

    const activities = createEnrichmentActivities({
      attributionStore: store,
      nodeId: NODE_ID,
      logger: mockLogger,
    });

    await activities.evaluateEpochDraft({ epochId: "1" });
    const finalResult = await activities.buildLockedEvaluations({
      epochId: "1",
    });

    // Draft and final should have same payload hash and inputs hash
    const draftCall = vi.mocked(store.upsertDraftEvaluation).mock.calls[0][0];
    const finalEvaluation = finalResult.evaluations[0];

    expect(draftCall.payloadHash).toBe(finalEvaluation.payloadHash);
    expect(draftCall.inputsHash).toBe(finalEvaluation.inputsHash);

    // buildLockedEvaluations returns wire format (epochId as string, not bigint)
    expect(finalEvaluation.epochId).toBe("1");
    expect(typeof finalEvaluation.epochId).toBe("string");
  });

  it("buildLockedEvaluations output survives JSON.stringify (no BigInt regression)", async () => {
    const store = makeMockStore({
      getSelectedReceiptsWithMetadata: vi
        .fn()
        .mockResolvedValue(makeReceipts(3)),
    });

    const { buildLockedEvaluations } = createEnrichmentActivities({
      attributionStore: store,
      nodeId: NODE_ID,
      logger: mockLogger,
    });

    const result = await buildLockedEvaluations({ epochId: "999" });

    // This is the exact operation Temporal performs on activity return values.
    // If any nested field is bigint, JSON.stringify throws TypeError.
    expect(() => JSON.stringify(result)).not.toThrow();
  });
});
