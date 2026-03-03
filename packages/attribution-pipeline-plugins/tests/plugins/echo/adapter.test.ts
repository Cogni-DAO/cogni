// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/attribution-pipeline-plugins/tests/plugins/echo/adapter`
 * Purpose: Unit tests for echo enricher adapter — mocked store, payload shape, hash computation.
 * Scope: Tests echo adapter logic. Does not test real I/O — store is mocked.
 * Invariants: ENRICHER_IDEMPOTENT, EVALUATION_WRITE_VALIDATED.
 * Side-effects: none
 * Links: packages/attribution-pipeline-plugins/src/plugins/echo/adapter.ts
 * @internal
 */

import type {
  EvaluationStore,
  SelectionStore,
} from "@cogni/attribution-ledger";
import type { EnricherContext } from "@cogni/attribution-pipeline-contracts";
import { describe, expect, it, vi } from "vitest";

import { createEchoAdapter } from "../../../src/plugins/echo/adapter";
import {
  ECHO_ALGO_REF,
  ECHO_DESCRIPTOR,
  ECHO_EVALUATION_REF,
  ECHO_SCHEMA_REF,
} from "../../../src/plugins/echo/descriptor";

function makeMockContext(
  receipts: Array<{
    receiptId: string;
    userId: string | null;
    source: string;
    eventType: string;
    included: boolean;
    weightOverrideMilli: bigint | null;
    metadata: Record<string, unknown> | null;
    payloadHash: string;
  }>
): EnricherContext {
  const store = {
    getEvaluation: vi.fn().mockResolvedValue(null),
    getEvaluationsForEpoch: vi.fn().mockResolvedValue([]),
    getSelectedReceiptsWithMetadata: vi.fn().mockResolvedValue(receipts),
    upsertDraftEvaluation: vi.fn(),
  } as unknown as EvaluationStore & SelectionStore;

  return {
    epochId: 1n,
    nodeId: "node-1",
    attributionStore: store,
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    profileConfig: null,
  };
}

const testReceipts = [
  {
    receiptId: "r1",
    userId: "user-1",
    source: "github",
    eventType: "pull_request",
    included: true,
    weightOverrideMilli: null,
    metadata: null,
    payloadHash: "sha256:abc",
  },
  {
    receiptId: "r2",
    userId: "user-2",
    source: "github",
    eventType: "issue_comment",
    included: true,
    weightOverrideMilli: null,
    metadata: null,
    payloadHash: "sha256:def",
  },
  {
    receiptId: "r3",
    userId: "user-1",
    source: "github",
    eventType: "pull_request",
    included: true,
    weightOverrideMilli: null,
    metadata: null,
    payloadHash: "sha256:ghi",
  },
];

describe("echo adapter", () => {
  it("produces a draft evaluation with correct refs", async () => {
    const adapter = createEchoAdapter();
    const ctx = makeMockContext(testReceipts);

    const result = await adapter.evaluateDraft(ctx);

    expect(adapter.descriptor).toBe(ECHO_DESCRIPTOR);
    expect(result.evaluationRef).toBe(ECHO_EVALUATION_REF);
    expect(result.algoRef).toBe(ECHO_ALGO_REF);
    expect(result.schemaRef).toBe(ECHO_SCHEMA_REF);
    expect(result.status).toBe("draft");
    expect(result.nodeId).toBe("node-1");
    expect(result.epochId).toBe(1n);
  });

  it("produces a locked evaluation via buildLocked", async () => {
    const adapter = createEchoAdapter();
    const ctx = makeMockContext(testReceipts);

    const result = await adapter.buildLocked(ctx);

    expect(result.status).toBe("locked");
    expect(result.evaluationRef).toBe(ECHO_EVALUATION_REF);
  });

  it("builds echo payload with event counts", async () => {
    const adapter = createEchoAdapter();
    const ctx = makeMockContext(testReceipts);

    const result = await adapter.evaluateDraft(ctx);

    expect(result.payloadJson).toEqual({
      totalEvents: 3,
      byEventType: { pull_request: 2, issue_comment: 1 },
      byUserId: { "user-1": 2, "user-2": 1 },
    });
  });

  it("includes non-empty hashes (EVALUATION_WRITE_VALIDATED)", async () => {
    const adapter = createEchoAdapter();
    const ctx = makeMockContext(testReceipts);

    const result = await adapter.evaluateDraft(ctx);

    expect(result.inputsHash).toBeTruthy();
    expect(result.payloadHash).toBeTruthy();
    expect(typeof result.inputsHash).toBe("string");
    expect(typeof result.payloadHash).toBe("string");
  });

  it("is idempotent — same receipts produce same result (ENRICHER_IDEMPOTENT)", async () => {
    const adapter = createEchoAdapter();
    const ctx1 = makeMockContext(testReceipts);
    const ctx2 = makeMockContext(testReceipts);

    const result1 = await adapter.evaluateDraft(ctx1);
    const result2 = await adapter.evaluateDraft(ctx2);

    expect(result1.inputsHash).toBe(result2.inputsHash);
    expect(result1.payloadHash).toBe(result2.payloadHash);
    expect(result1.payloadJson).toEqual(result2.payloadJson);
  });

  it("counts unresolved receipts separately (IDENTITY_BEST_EFFORT)", async () => {
    const adapter = createEchoAdapter();
    const receiptsWithUnresolved = [
      ...testReceipts,
      {
        receiptId: "r4",
        userId: null,
        source: "github",
        eventType: "pull_request",
        included: true,
        weightOverrideMilli: null,
        metadata: null,
        payloadHash: "sha256:jkl",
      },
    ];
    const ctx = makeMockContext(receiptsWithUnresolved);

    const result = await adapter.evaluateDraft(ctx);

    expect(result.payloadJson).toEqual({
      totalEvents: 4,
      byEventType: { pull_request: 3, issue_comment: 1 },
      byUserId: { "user-1": 2, "user-2": 1 },
    });
  });

  it("handles empty receipts", async () => {
    const adapter = createEchoAdapter();
    const ctx = makeMockContext([]);

    const result = await adapter.evaluateDraft(ctx);

    expect(result.payloadJson).toEqual({
      totalEvents: 0,
      byEventType: {},
      byUserId: {},
    });
    expect(result.inputsHash).toBeTruthy();
    expect(result.payloadHash).toBeTruthy();
  });
});
