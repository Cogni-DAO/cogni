// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/scheduler-worker/tests/enrichment-activities.test`
 * Purpose: Verifies enrichEpochDraft and buildFinalArtifacts activity behavior — payload structure, idempotency, and Temporal wire-format safety.
 * Scope: Covers echo enricher (cogni.echo.v0) with mocked store. Does NOT cover workflow orchestration or DB integration.
 * Invariants:
 * - ENRICHER_IDEMPOTENT: Same events produce same hashes across draft and locked runs.
 * - BIGINT_WIRE_SAFE: buildFinalArtifacts output survives JSON.stringify (no BigInt in wire format).
 * Side-effects: none (mocked store)
 * Links: services/scheduler-worker/src/activities/enrichment.ts
 * @internal
 */

import type {
  ActivityLedgerStore,
  CuratedEventWithMetadata,
} from "@cogni/ledger-core";
import { describe, expect, it, vi } from "vitest";

import {
  createEnrichmentActivities,
  ECHO_ALGO_REF,
  ECHO_ARTIFACT_REF,
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
  overrides: Partial<ActivityLedgerStore> = {}
): ActivityLedgerStore {
  return {
    createEpoch: vi.fn(),
    getOpenEpoch: vi.fn().mockResolvedValue(null),
    getEpochByWindow: vi.fn().mockResolvedValue(null),
    getEpoch: vi.fn(),
    listEpochs: vi.fn(),
    closeIngestion: vi.fn(),
    closeIngestionWithArtifacts: vi.fn(),
    finalizeEpoch: vi.fn(),
    upsertDraftArtifact: vi.fn(),
    getArtifactsForEpoch: vi.fn().mockResolvedValue([]),
    getArtifact: vi.fn().mockResolvedValue(null),
    getCuratedEventsWithMetadata: vi.fn().mockResolvedValue([]),
    insertActivityEvents: vi.fn(),
    getActivityForWindow: vi.fn(),
    upsertCuration: vi.fn(),
    getCurationForEpoch: vi.fn(),
    getUnresolvedCuration: vi.fn(),
    insertAllocations: vi.fn(),
    upsertAllocations: vi.fn(),
    deleteStaleAllocations: vi.fn(),
    updateAllocationFinalUnits: vi.fn(),
    getAllocationsForEpoch: vi.fn(),
    getCuratedEventsForAllocation: vi.fn().mockResolvedValue([]),
    upsertCursor: vi.fn(),
    getCursor: vi.fn().mockResolvedValue(null),
    insertPoolComponent: vi.fn(),
    getPoolComponentsForEpoch: vi.fn(),
    insertPayoutStatement: vi.fn(),
    getStatementForEpoch: vi.fn(),
    insertStatementSignature: vi.fn(),
    getSignaturesForStatement: vi.fn(),
    insertCurationDoNothing: vi.fn(),
    resolveIdentities: vi.fn().mockResolvedValue(new Map()),
    finalizeEpochAtomic: vi.fn(),
    getUncuratedEvents: vi.fn().mockResolvedValue([]),
    updateCurationUserId: vi.fn(),
    ...overrides,
  } as ActivityLedgerStore;
}

function makeEvents(count: number): CuratedEventWithMetadata[] {
  return Array.from({ length: count }, (_, i) => ({
    eventId: `ev-${i}`,
    userId: i % 2 === 0 ? "user-aaa" : "user-bbb",
    source: "github",
    eventType: i % 3 === 0 ? "pr_merged" : "review_submitted",
    included: true,
    weightOverrideMilli: null,
    metadata: { title: `PR #${i}` },
    payloadHash: `hash-${i}`,
  }));
}

// ── enrichEpochDraft ────────────────────────────────────────────

describe("enrichEpochDraft", () => {
  it("produces correct echo payload structure", async () => {
    const events = makeEvents(5);
    const store = makeMockStore({
      getCuratedEventsWithMetadata: vi.fn().mockResolvedValue(events),
    });

    const { enrichEpochDraft } = createEnrichmentActivities({
      ledgerStore: store,
      nodeId: NODE_ID,
      logger: mockLogger,
    });

    const result = await enrichEpochDraft({ epochId: "1" });

    expect(result.artifactRef).toBe(ECHO_ARTIFACT_REF);
    expect(result.eventCount).toBe(5);

    // Verify upsertDraftArtifact was called with correct payload structure
    expect(store.upsertDraftArtifact).toHaveBeenCalledOnce();
    const call = vi.mocked(store.upsertDraftArtifact).mock.calls[0][0];
    expect(call.artifactRef).toBe(ECHO_ARTIFACT_REF);
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

  it("calls upsertDraftArtifact with status='draft'", async () => {
    const store = makeMockStore({
      getCuratedEventsWithMetadata: vi.fn().mockResolvedValue(makeEvents(2)),
    });

    const { enrichEpochDraft } = createEnrichmentActivities({
      ledgerStore: store,
      nodeId: NODE_ID,
      logger: mockLogger,
    });

    await enrichEpochDraft({ epochId: "1" });

    const call = vi.mocked(store.upsertDraftArtifact).mock.calls[0][0];
    expect(call.status).toBe("draft");
  });

  it("handles no events — writes artifact with empty counts", async () => {
    const store = makeMockStore({
      getCuratedEventsWithMetadata: vi.fn().mockResolvedValue([]),
    });

    const { enrichEpochDraft } = createEnrichmentActivities({
      ledgerStore: store,
      nodeId: NODE_ID,
      logger: mockLogger,
    });

    const result = await enrichEpochDraft({ epochId: "1" });

    expect(result.eventCount).toBe(0);
    expect(store.upsertDraftArtifact).toHaveBeenCalledOnce();

    const payload = vi.mocked(store.upsertDraftArtifact).mock.calls[0][0]
      .payloadJson as { totalEvents: number };
    expect(payload.totalEvents).toBe(0);
  });
});

// ── buildFinalArtifacts ─────────────────────────────────────────

describe("buildFinalArtifacts", () => {
  it("returns artifacts and artifactsHash without writing to store", async () => {
    const events = makeEvents(3);
    const store = makeMockStore({
      getCuratedEventsWithMetadata: vi.fn().mockResolvedValue(events),
    });

    const { buildFinalArtifacts } = createEnrichmentActivities({
      ledgerStore: store,
      nodeId: NODE_ID,
      logger: mockLogger,
    });

    const result = await buildFinalArtifacts({ epochId: "1" });

    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0].artifactRef).toBe(ECHO_ARTIFACT_REF);
    expect(result.artifacts[0].status).toBe("locked");
    expect(result.artifactsHash).toMatch(/^[a-f0-9]{64}$/);

    // Should NOT write to store
    expect(store.upsertDraftArtifact).not.toHaveBeenCalled();
    expect(store.closeIngestionWithArtifacts).not.toHaveBeenCalled();
  });

  it("returns valid artifactsHash", async () => {
    const store = makeMockStore({
      getCuratedEventsWithMetadata: vi.fn().mockResolvedValue(makeEvents(2)),
    });

    const { buildFinalArtifacts } = createEnrichmentActivities({
      ledgerStore: store,
      nodeId: NODE_ID,
      logger: mockLogger,
    });

    const result = await buildFinalArtifacts({ epochId: "1" });
    expect(result.artifactsHash).toMatch(/^[a-f0-9]{64}$/);
  });
});

// ── Idempotency ─────────────────────────────────────────────────

describe("idempotency", () => {
  it("same events produce same hashes across enrichEpochDraft and buildFinalArtifacts", async () => {
    const events = makeEvents(4);
    const store = makeMockStore({
      getCuratedEventsWithMetadata: vi.fn().mockResolvedValue(events),
    });

    const activities = createEnrichmentActivities({
      ledgerStore: store,
      nodeId: NODE_ID,
      logger: mockLogger,
    });

    await activities.enrichEpochDraft({ epochId: "1" });
    const finalResult = await activities.buildFinalArtifacts({ epochId: "1" });

    // Draft and final should have same payload hash and inputs hash
    const draftCall = vi.mocked(store.upsertDraftArtifact).mock.calls[0][0];
    const finalArtifact = finalResult.artifacts[0];

    expect(draftCall.payloadHash).toBe(finalArtifact.payloadHash);
    expect(draftCall.inputsHash).toBe(finalArtifact.inputsHash);

    // buildFinalArtifacts returns wire format (epochId as string, not bigint)
    expect(finalArtifact.epochId).toBe("1");
    expect(typeof finalArtifact.epochId).toBe("string");
  });

  it("buildFinalArtifacts output survives JSON.stringify (no BigInt regression)", async () => {
    const store = makeMockStore({
      getCuratedEventsWithMetadata: vi.fn().mockResolvedValue(makeEvents(3)),
    });

    const { buildFinalArtifacts } = createEnrichmentActivities({
      ledgerStore: store,
      nodeId: NODE_ID,
      logger: mockLogger,
    });

    const result = await buildFinalArtifacts({ epochId: "999" });

    // This is the exact operation Temporal performs on activity return values.
    // If any nested field is bigint, JSON.stringify throws TypeError.
    expect(() => JSON.stringify(result)).not.toThrow();
  });
});
