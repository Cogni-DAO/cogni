// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/unit/app/_facades/attribution/claimants.server`
 * Purpose: Verifies claimant-share facade evaluation selection across epoch states.
 * Scope: Covers evaluation status selection and fallback behavior with a mocked attribution store; does not test HTTP routes or DB adapters.
 * Invariants:
 * - REVIEW_USES_LOCKED_EVALUATIONS: review epochs load locked claimant-share evaluations
 * - OPEN_USES_DRAFT_EVALUATIONS: open epochs load draft claimant-share evaluations
 * Side-effects: none
 * Links: src/app/_facades/attribution/claimants.server.ts
 * @internal
 */

import type { AttributionStore } from "@cogni/attribution-ledger";
import { describe, expect, it, vi } from "vitest";

import { loadClaimantShareSubjectsForEpoch } from "@/app/_facades/attribution/claimants.server";

const baseEpoch = {
  id: 1n,
  nodeId: "aaaaaaaa-0000-0000-0000-000000000001",
  scopeId: "bbbbbbbb-0000-0000-0000-000000000001",
  periodStart: new Date("2026-02-17T00:00:00Z"),
  periodEnd: new Date("2026-02-24T00:00:00Z"),
  weightConfig: { "github:pr_merged": 1000 },
  poolTotalCredits: null,
  approverSetHash: null,
  allocationAlgoRef: null,
  weightConfigHash: null,
  artifactsHash: null,
  openedAt: new Date("2026-02-17T00:00:00Z"),
  closedAt: null,
  createdAt: new Date("2026-02-17T00:00:00Z"),
} as const;

function makeStore(
  overrides: Partial<AttributionStore> = {}
): AttributionStore {
  return {
    createEpoch: vi.fn(),
    getOpenEpoch: vi.fn(),
    getEpochByWindow: vi.fn(),
    getEpoch: vi.fn(),
    listEpochs: vi.fn(),
    closeIngestion: vi.fn(),
    closeIngestionWithEvaluations: vi.fn(),
    finalizeEpoch: vi.fn(),
    upsertDraftEvaluation: vi.fn(),
    getEvaluationsForEpoch: vi.fn(),
    getEvaluation: vi.fn().mockResolvedValue({
      id: "eval-1",
      nodeId: baseEpoch.nodeId,
      epochId: baseEpoch.id,
      evaluationRef: "cogni.claimant_shares.v0",
      status: "locked",
      algoRef: "claimant-shares-v0",
      inputsHash: "a".repeat(64),
      payloadHash: "b".repeat(64),
      payloadJson: {
        version: 1,
        subjects: [
          {
            subjectRef: "receipt-1",
            subjectKind: "receipt",
            units: "1000",
            source: "github",
            eventType: "pr_merged",
            receiptIds: ["receipt-1"],
            claimantShares: [
              {
                claimant: { kind: "user", userId: "user-1" },
                sharePpm: 1_000_000,
              },
            ],
            metadata: null,
          },
        ],
      },
      payloadRef: null,
      createdAt: new Date("2026-02-24T00:00:00Z"),
    }),
    getSelectedReceiptsForAttribution: vi.fn().mockResolvedValue([]),
    getSelectedReceiptsWithMetadata: vi.fn(),
    insertIngestionReceipts: vi.fn(),
    getReceiptsForWindow: vi.fn(),
    upsertSelection: vi.fn(),
    getSelectionForEpoch: vi.fn(),
    getUnresolvedSelection: vi.fn(),
    insertUserProjections: vi.fn(),
    upsertUserProjections: vi.fn(),
    deleteStaleUserProjections: vi.fn(),
    getUserProjectionsForEpoch: vi.fn(),
    replaceFinalClaimantAllocations: vi.fn(),
    getFinalClaimantAllocationsForEpoch: vi.fn(),
    getSelectedReceiptsForAllocation: vi.fn(),
    upsertCursor: vi.fn(),
    getCursor: vi.fn(),
    insertPoolComponent: vi.fn(),
    getPoolComponentsForEpoch: vi.fn(),
    insertEpochStatement: vi.fn(),
    getStatementForEpoch: vi.fn(),
    insertStatementSignature: vi.fn(),
    getSignaturesForStatement: vi.fn(),
    insertSelectionDoNothing: vi.fn(),
    resolveIdentities: vi.fn(),
    getUserDisplayNames: vi.fn().mockResolvedValue(new Map()),
    finalizeEpochAtomic: vi.fn(),
    getUnselectedReceipts: vi.fn(),
    updateSelectionUserId: vi.fn(),
    upsertReviewSubjectOverride: vi.fn(),
    batchUpsertReviewSubjectOverrides: vi.fn(),
    deleteReviewSubjectOverride: vi.fn(),
    getReviewSubjectOverridesForEpoch: vi.fn(),
    ...overrides,
  } as AttributionStore;
}

describe("app/_facades/attribution/claimants.server", () => {
  it("uses locked claimant evaluations for review epochs", async () => {
    const store = makeStore();

    const subjects = await loadClaimantShareSubjectsForEpoch(store, {
      ...baseEpoch,
      status: "review",
    });

    expect(store.getEvaluation).toHaveBeenCalledWith(
      1n,
      "cogni.claimant_shares.v0",
      "locked"
    );
    expect(subjects).toHaveLength(1);
  });

  it("uses draft claimant evaluations for open epochs", async () => {
    const store = makeStore();

    await loadClaimantShareSubjectsForEpoch(store, {
      ...baseEpoch,
      status: "open",
    });

    expect(store.getEvaluation).toHaveBeenCalledWith(
      1n,
      "cogni.claimant_shares.v0",
      "draft"
    );
  });
});
