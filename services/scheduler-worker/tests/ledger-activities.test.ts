// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/scheduler-worker/tests/ledger-activities.test`
 * Purpose: Unit tests for ledger activity functions, epoch window computation, and curateAndResolve.
 * Scope: Tests each activity in isolation with mocked store/adapter. Covers identity resolution, curation auto-population, and admin-field preservation.
 * @internal
 */

import type {
  ActivityEvent,
  CollectResult,
  SourceAdapter,
} from "@cogni/ingestion-core";
import type {
  ActivityLedgerStore,
  LedgerEpoch,
  LedgerSourceCursor,
  UncuratedEvent,
} from "@cogni/ledger-core";
import { computeEpochWindowV1 } from "@cogni/ledger-core";
import { describe, expect, it, vi } from "vitest";

import { createLedgerActivities } from "../src/activities/ledger.js";

const NODE_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const SCOPE_ID = "bbbbbbbb-0000-0000-0000-000000000001";

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: () => mockLogger,
} as unknown as Parameters<typeof createLedgerActivities>[0]["logger"];

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
    updateAllocationFinalUnits: vi.fn(),
    getAllocationsForEpoch: vi.fn(),
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
    upsertAllocations: vi.fn(),
    deleteStaleAllocations: vi.fn(),
    getCuratedEventsForAllocation: vi.fn().mockResolvedValue([]),
    finalizeEpochAtomic: vi.fn(),
    getUncuratedEvents: vi.fn().mockResolvedValue([]),
    updateCurationUserId: vi.fn(),
    ...overrides,
  } as ActivityLedgerStore;
}

function makeMockAdapter(events: ActivityEvent[] = []): SourceAdapter {
  return {
    source: "github",
    version: "0.3.0",
    streams: () => [
      {
        id: "pull_requests",
        name: "PRs",
        cursorType: "timestamp" as const,
        defaultPollInterval: 3600,
      },
    ],
    collect: vi.fn().mockResolvedValue({
      events,
      nextCursor: {
        streamId: "pull_requests",
        value: "2026-02-22T00:00:00.000Z",
        retrievedAt: new Date(),
      },
    } satisfies CollectResult),
  };
}

function makeEpoch(overrides: Partial<LedgerEpoch> = {}): LedgerEpoch {
  return {
    id: 1n,
    nodeId: NODE_ID,
    scopeId: SCOPE_ID,
    status: "open",
    periodStart: new Date("2026-02-16T00:00:00Z"),
    periodEnd: new Date("2026-02-23T00:00:00Z"),
    weightConfig: { "github:pr_merged": 1000 },
    poolTotalCredits: null,
    approverSetHash: null,
    allocationAlgoRef: null,
    weightConfigHash: null,
    artifactsHash: null,
    openedAt: new Date(),
    closedAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}

function makeEvent(id = "github:pr:test/repo:1"): ActivityEvent {
  return {
    id,
    source: "github",
    eventType: "pr_merged",
    platformUserId: "12345",
    platformLogin: "testuser",
    artifactUrl: "https://github.com/test/repo/pull/1",
    metadata: { title: "Test PR" },
    payloadHash: "abc123",
    eventTime: new Date("2026-02-20T12:00:00Z"),
  };
}

function makeUncuratedEvent(
  overrides: Partial<UncuratedEvent["event"]> & {
    hasExistingCuration?: boolean;
  } = {}
): UncuratedEvent {
  const { hasExistingCuration = false, ...eventOverrides } = overrides;
  return {
    event: {
      id: "github:pr:test/repo:1",
      nodeId: NODE_ID,
      scopeId: SCOPE_ID,
      source: "github",
      eventType: "pr_merged",
      platformUserId: "12345",
      platformLogin: "testuser",
      artifactUrl: "https://github.com/test/repo/pull/1",
      metadata: { title: "Test PR" },
      payloadHash: "abc123",
      producer: "github",
      producerVersion: "0.3.0",
      eventTime: new Date("2026-02-20T12:00:00Z"),
      retrievedAt: new Date("2026-02-20T12:01:00Z"),
      ingestedAt: new Date("2026-02-20T12:02:00Z"),
      ...eventOverrides,
    },
    hasExistingCuration,
  };
}

// ── computeEpochWindowV1 ────────────────────────────────────────

describe("computeEpochWindowV1", () => {
  it("aligns to Monday 00:00 UTC for a 7-day epoch", () => {
    // 2026-02-22 is a Sunday
    const result = computeEpochWindowV1({
      asOfIso: "2026-02-22T06:00:00Z",
      epochLengthDays: 7,
      timezone: "UTC",
      weekStart: "monday",
    });

    expect(result.periodStartIso).toBe("2026-02-16T00:00:00.000Z");
    expect(result.periodEndIso).toBe("2026-02-23T00:00:00.000Z");
  });

  it("returns same window for any day within the same week", () => {
    const monday = computeEpochWindowV1({
      asOfIso: "2026-02-16T00:00:00Z",
      epochLengthDays: 7,
      timezone: "UTC",
      weekStart: "monday",
    });
    const wednesday = computeEpochWindowV1({
      asOfIso: "2026-02-18T12:00:00Z",
      epochLengthDays: 7,
      timezone: "UTC",
      weekStart: "monday",
    });
    const sunday = computeEpochWindowV1({
      asOfIso: "2026-02-22T23:59:59Z",
      epochLengthDays: 7,
      timezone: "UTC",
      weekStart: "monday",
    });

    expect(monday.periodStartIso).toBe(wednesday.periodStartIso);
    expect(monday.periodStartIso).toBe(sunday.periodStartIso);
    expect(monday.periodEndIso).toBe(wednesday.periodEndIso);
  });

  it("advances to next epoch on Monday boundary", () => {
    const sunday = computeEpochWindowV1({
      asOfIso: "2026-02-22T23:59:59Z",
      epochLengthDays: 7,
      timezone: "UTC",
      weekStart: "monday",
    });
    const nextMonday = computeEpochWindowV1({
      asOfIso: "2026-02-23T00:00:00Z",
      epochLengthDays: 7,
      timezone: "UTC",
      weekStart: "monday",
    });

    expect(sunday.periodEndIso).toBe(nextMonday.periodStartIso);
  });

  it("handles 14-day epoch correctly", () => {
    const result = computeEpochWindowV1({
      asOfIso: "2026-02-22T06:00:00Z",
      epochLengthDays: 14,
      timezone: "UTC",
      weekStart: "monday",
    });

    // 14-day periods from anchor (2026-01-05)
    // Period 0: Jan 5 - Jan 19, Period 1: Jan 19 - Feb 2, Period 2: Feb 2 - Feb 16, Period 3: Feb 16 - Mar 2
    expect(result.periodStartIso).toBe("2026-02-16T00:00:00.000Z");
    expect(result.periodEndIso).toBe("2026-03-02T00:00:00.000Z");
  });
});

// ── createLedgerActivities ──────────────────────────────────────

describe("createLedgerActivities", () => {
  it("returns all expected activity functions", () => {
    const activities = createLedgerActivities({
      ledgerStore: makeMockStore(),
      sourceAdapters: new Map(),
      nodeId: NODE_ID,
      scopeId: SCOPE_ID,
      logger: mockLogger,
    });

    expect(activities.ensureEpochForWindow).toBeTypeOf("function");
    expect(activities.loadCursor).toBeTypeOf("function");
    expect(activities.collectFromSource).toBeTypeOf("function");
    expect(activities.insertEvents).toBeTypeOf("function");
    expect(activities.saveCursor).toBeTypeOf("function");
  });
});

// ── ensureEpochForWindow ────────────────────────────────────────

describe("ensureEpochForWindow", () => {
  it("creates a new epoch when none exists", async () => {
    const epoch = makeEpoch();
    const store = makeMockStore({
      getEpochByWindow: vi.fn().mockResolvedValue(null),
      createEpoch: vi.fn().mockResolvedValue(epoch),
    });

    const { ensureEpochForWindow } = createLedgerActivities({
      ledgerStore: store,
      sourceAdapters: new Map(),
      nodeId: NODE_ID,
      scopeId: SCOPE_ID,
      logger: mockLogger,
    });

    const result = await ensureEpochForWindow({
      periodStart: "2026-02-16T00:00:00.000Z",
      periodEnd: "2026-02-23T00:00:00.000Z",
      weightConfig: { "github:pr_merged": 1000 },
    });

    expect(result.isNew).toBe(true);
    expect(result.epochId).toBe("1");
    expect(result.weightConfig).toEqual({ "github:pr_merged": 1000 });
    expect(store.createEpoch).toHaveBeenCalledOnce();
  });

  it("returns existing epoch when window matches (open)", async () => {
    const epoch = makeEpoch();
    const store = makeMockStore({
      getEpochByWindow: vi.fn().mockResolvedValue(epoch),
    });

    const { ensureEpochForWindow } = createLedgerActivities({
      ledgerStore: store,
      sourceAdapters: new Map(),
      nodeId: NODE_ID,
      scopeId: SCOPE_ID,
      logger: mockLogger,
    });

    const result = await ensureEpochForWindow({
      periodStart: epoch.periodStart.toISOString(),
      periodEnd: epoch.periodEnd.toISOString(),
      weightConfig: { "github:pr_merged": 1000 },
    });

    expect(result.isNew).toBe(false);
    expect(result.epochId).toBe("1");
    expect(result.weightConfig).toEqual({ "github:pr_merged": 1000 });
    expect(store.createEpoch).not.toHaveBeenCalled();
  });

  it("returns finalized epoch found by window — does not create new", async () => {
    const epoch = makeEpoch({ status: "finalized", closedAt: new Date() });
    const store = makeMockStore({
      getEpochByWindow: vi.fn().mockResolvedValue(epoch),
    });

    const { ensureEpochForWindow } = createLedgerActivities({
      ledgerStore: store,
      sourceAdapters: new Map(),
      nodeId: NODE_ID,
      scopeId: SCOPE_ID,
      logger: mockLogger,
    });

    const result = await ensureEpochForWindow({
      periodStart: epoch.periodStart.toISOString(),
      periodEnd: epoch.periodEnd.toISOString(),
      weightConfig: { "github:pr_merged": 1000 },
    });

    expect(result.isNew).toBe(false);
    expect(result.status).toBe("finalized");
    expect(store.createEpoch).not.toHaveBeenCalled();
  });

  it("logs warning on weight config drift and returns pinned config", async () => {
    const epoch = makeEpoch({
      weightConfig: { "github:pr_merged": 500 },
    });
    const store = makeMockStore({
      getEpochByWindow: vi.fn().mockResolvedValue(epoch),
    });

    const logger = {
      ...mockLogger,
      warn: vi.fn(),
    } as unknown as Parameters<typeof createLedgerActivities>[0]["logger"];

    const { ensureEpochForWindow } = createLedgerActivities({
      ledgerStore: store,
      sourceAdapters: new Map(),
      nodeId: NODE_ID,
      scopeId: SCOPE_ID,
      logger,
    });

    const result = await ensureEpochForWindow({
      periodStart: epoch.periodStart.toISOString(),
      periodEnd: epoch.periodEnd.toISOString(),
      weightConfig: { "github:pr_merged": 1000 },
    });

    // Returns pinned config from existing epoch, not input
    expect(result.weightConfig).toEqual({ "github:pr_merged": 500 });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ pinnedWeights: { "github:pr_merged": 500 } }),
      expect.stringContaining("Weight config drift")
    );
  });
});

// ── loadCursor ──────────────────────────────────────────────────

describe("loadCursor", () => {
  it("returns null when no cursor exists", async () => {
    const store = makeMockStore();
    const { loadCursor } = createLedgerActivities({
      ledgerStore: store,
      sourceAdapters: new Map(),
      nodeId: NODE_ID,
      scopeId: SCOPE_ID,
      logger: mockLogger,
    });

    const result = await loadCursor({
      source: "github",
      stream: "pull_requests",
      sourceRef: "test/repo",
    });

    expect(result).toBeNull();
  });

  it("returns cursor value when one exists", async () => {
    const cursor: LedgerSourceCursor = {
      nodeId: NODE_ID,
      scopeId: SCOPE_ID,
      source: "github",
      stream: "pull_requests",
      sourceRef: "test/repo",
      cursorValue: "2026-02-20T00:00:00Z",
      retrievedAt: new Date(),
    };
    const store = makeMockStore({
      getCursor: vi.fn().mockResolvedValue(cursor),
    });

    const { loadCursor } = createLedgerActivities({
      ledgerStore: store,
      sourceAdapters: new Map(),
      nodeId: NODE_ID,
      scopeId: SCOPE_ID,
      logger: mockLogger,
    });

    const result = await loadCursor({
      source: "github",
      stream: "pull_requests",
      sourceRef: "test/repo",
    });

    expect(result).toBe("2026-02-20T00:00:00Z");
  });
});

// ── collectFromSource ───────────────────────────────────────────

describe("collectFromSource", () => {
  it("returns empty events when no adapter exists for source", async () => {
    const { collectFromSource } = createLedgerActivities({
      ledgerStore: makeMockStore(),
      sourceAdapters: new Map(),
      nodeId: NODE_ID,
      scopeId: SCOPE_ID,
      logger: mockLogger,
    });

    const result = await collectFromSource({
      source: "discord",
      streams: ["messages"],
      cursorValue: null,
      periodStart: "2026-02-16T00:00:00Z",
      periodEnd: "2026-02-23T00:00:00Z",
    });

    expect(result.events).toHaveLength(0);
    expect(result.producerVersion).toBe("unknown");
  });

  it("calls adapter.collect() and returns events with producerVersion", async () => {
    const event = makeEvent();
    const adapter = makeMockAdapter([event]);
    const adapters = new Map<string, SourceAdapter>([["github", adapter]]);

    const { collectFromSource } = createLedgerActivities({
      ledgerStore: makeMockStore(),
      sourceAdapters: adapters,
      nodeId: NODE_ID,
      scopeId: SCOPE_ID,
      logger: mockLogger,
    });

    const result = await collectFromSource({
      source: "github",
      streams: ["pull_requests"],
      cursorValue: null,
      periodStart: "2026-02-16T00:00:00Z",
      periodEnd: "2026-02-23T00:00:00Z",
    });

    expect(result.events).toHaveLength(1);
    expect(result.events[0].id).toBe("github:pr:test/repo:1");
    expect(result.producerVersion).toBe("0.3.0");
    expect(adapter.collect).toHaveBeenCalledOnce();
  });
});

// ── insertEvents ────────────────────────────────────────────────

describe("insertEvents", () => {
  it("does nothing when events array is empty", async () => {
    const store = makeMockStore();
    const { insertEvents } = createLedgerActivities({
      ledgerStore: store,
      sourceAdapters: new Map(),
      nodeId: NODE_ID,
      scopeId: SCOPE_ID,
      logger: mockLogger,
    });

    await insertEvents({ events: [], producerVersion: "0.3.0" });

    expect(store.insertActivityEvents).not.toHaveBeenCalled();
  });

  it("maps events and uses producerVersion from input", async () => {
    const store = makeMockStore();
    const { insertEvents } = createLedgerActivities({
      ledgerStore: store,
      sourceAdapters: new Map(),
      nodeId: NODE_ID,
      scopeId: SCOPE_ID,
      logger: mockLogger,
    });

    await insertEvents({ events: [makeEvent()], producerVersion: "0.3.0" });

    expect(store.insertActivityEvents).toHaveBeenCalledOnce();
    const args = vi.mocked(store.insertActivityEvents).mock.calls[0][0];
    expect(args[0].nodeId).toBe(NODE_ID);
    expect(args[0].scopeId).toBe(SCOPE_ID);
    expect(args[0].source).toBe("github");
    expect(args[0].producerVersion).toBe("0.3.0");
  });
});

// ── saveCursor ──────────────────────────────────────────────────

describe("saveCursor", () => {
  it("saves cursor when no existing cursor", async () => {
    const store = makeMockStore();
    const { saveCursor } = createLedgerActivities({
      ledgerStore: store,
      sourceAdapters: new Map(),
      nodeId: NODE_ID,
      scopeId: SCOPE_ID,
      logger: mockLogger,
    });

    await saveCursor({
      source: "github",
      stream: "pull_requests",
      sourceRef: "test/repo",
      cursorValue: "2026-02-20T00:00:00Z",
    });

    expect(store.upsertCursor).toHaveBeenCalledWith(
      NODE_ID,
      SCOPE_ID,
      "github",
      "pull_requests",
      "test/repo",
      "2026-02-20T00:00:00Z"
    );
  });

  it("enforces monotonic cursor — keeps later value", async () => {
    const existingCursor: LedgerSourceCursor = {
      nodeId: NODE_ID,
      scopeId: SCOPE_ID,
      source: "github",
      stream: "pull_requests",
      sourceRef: "test/repo",
      cursorValue: "2026-02-21T00:00:00Z",
      retrievedAt: new Date(),
    };
    const store = makeMockStore({
      getCursor: vi.fn().mockResolvedValue(existingCursor),
    });

    const { saveCursor } = createLedgerActivities({
      ledgerStore: store,
      sourceAdapters: new Map(),
      nodeId: NODE_ID,
      scopeId: SCOPE_ID,
      logger: mockLogger,
    });

    // Try to save an earlier cursor — should keep the existing later one
    await saveCursor({
      source: "github",
      stream: "pull_requests",
      sourceRef: "test/repo",
      cursorValue: "2026-02-19T00:00:00Z",
    });

    expect(store.upsertCursor).toHaveBeenCalledWith(
      NODE_ID,
      SCOPE_ID,
      "github",
      "pull_requests",
      "test/repo",
      "2026-02-21T00:00:00Z" // kept existing, later value
    );
  });

  it("advances cursor when new value is later", async () => {
    const existingCursor: LedgerSourceCursor = {
      nodeId: NODE_ID,
      scopeId: SCOPE_ID,
      source: "github",
      stream: "pull_requests",
      sourceRef: "test/repo",
      cursorValue: "2026-02-19T00:00:00Z",
      retrievedAt: new Date(),
    };
    const store = makeMockStore({
      getCursor: vi.fn().mockResolvedValue(existingCursor),
    });

    const { saveCursor } = createLedgerActivities({
      ledgerStore: store,
      sourceAdapters: new Map(),
      nodeId: NODE_ID,
      scopeId: SCOPE_ID,
      logger: mockLogger,
    });

    await saveCursor({
      source: "github",
      stream: "pull_requests",
      sourceRef: "test/repo",
      cursorValue: "2026-02-21T00:00:00Z",
    });

    expect(store.upsertCursor).toHaveBeenCalledWith(
      NODE_ID,
      SCOPE_ID,
      "github",
      "pull_requests",
      "test/repo",
      "2026-02-21T00:00:00Z" // advanced to new, later value
    );
  });
});

// ── curateAndResolve ────────────────────────────────────────────

describe("curateAndResolve", () => {
  const epoch = makeEpoch({ id: 1n });

  function makeDeps(storeOverrides: Partial<ActivityLedgerStore> = {}) {
    const store = makeMockStore({
      getEpoch: vi.fn().mockResolvedValue(epoch),
      ...storeOverrides,
    });
    const { curateAndResolve } = createLedgerActivities({
      ledgerStore: store,
      sourceAdapters: new Map(),
      nodeId: NODE_ID,
      scopeId: SCOPE_ID,
      logger: mockLogger,
    });
    return { store, curateAndResolve };
  }

  it("returns zero counts when no uncurated events", async () => {
    const { curateAndResolve } = makeDeps({
      getUncuratedEvents: vi.fn().mockResolvedValue([]),
    });

    const result = await curateAndResolve({ epochId: "1" });

    expect(result).toEqual({
      totalEvents: 0,
      newCurations: 0,
      resolved: 0,
      unresolved: 0,
    });
  });

  it("throws when epoch not found", async () => {
    const { curateAndResolve } = makeDeps({
      getEpoch: vi.fn().mockResolvedValue(null),
    });

    await expect(curateAndResolve({ epochId: "999" })).rejects.toThrow(
      "epoch 999 not found"
    );
  });

  it("creates new curation rows with resolved userId", async () => {
    const uncurated = [
      makeUncuratedEvent({ id: "ev1", platformUserId: "111" }),
      makeUncuratedEvent({ id: "ev2", platformUserId: "222" }),
    ];
    const identityMap = new Map([["111", "user-aaa"]]);
    const { store, curateAndResolve } = makeDeps({
      getUncuratedEvents: vi.fn().mockResolvedValue(uncurated),
      resolveIdentities: vi.fn().mockResolvedValue(identityMap),
    });

    const result = await curateAndResolve({ epochId: "1" });

    expect(result.totalEvents).toBe(2);
    expect(result.newCurations).toBe(2);
    expect(result.resolved).toBe(1);
    expect(result.unresolved).toBe(1);

    // Should have called upsertCuration for each new event
    expect(store.insertCurationDoNothing).toHaveBeenCalledTimes(2);

    // First call: resolved
    expect(vi.mocked(store.insertCurationDoNothing).mock.calls[0][0]).toEqual([
      expect.objectContaining({
        nodeId: NODE_ID,
        epochId: 1n,
        eventId: "ev1",
        userId: "user-aaa",
        included: true,
      }),
    ]);

    // Second call: unresolved (userId null)
    expect(vi.mocked(store.insertCurationDoNothing).mock.calls[1][0]).toEqual([
      expect.objectContaining({
        eventId: "ev2",
        userId: null,
        included: true,
      }),
    ]);

    // No updateCurationUserId calls (all new events)
    expect(store.updateCurationUserId).not.toHaveBeenCalled();
  });

  it("updates userId on existing unresolved curation rows", async () => {
    const uncurated = [
      makeUncuratedEvent({
        id: "ev1",
        platformUserId: "111",
        hasExistingCuration: true,
      }),
    ];
    const identityMap = new Map([["111", "user-aaa"]]);
    const { store, curateAndResolve } = makeDeps({
      getUncuratedEvents: vi.fn().mockResolvedValue(uncurated),
      resolveIdentities: vi.fn().mockResolvedValue(identityMap),
    });

    const result = await curateAndResolve({ epochId: "1" });

    expect(result.totalEvents).toBe(1);
    expect(result.newCurations).toBe(0);
    expect(result.resolved).toBe(1);

    // Should update, not insert
    expect(store.insertCurationDoNothing).not.toHaveBeenCalled();
    expect(store.updateCurationUserId).toHaveBeenCalledWith(
      1n,
      "ev1",
      "user-aaa"
    );
  });

  it("skips existing unresolved rows when identity still not found", async () => {
    const uncurated = [
      makeUncuratedEvent({
        id: "ev1",
        platformUserId: "111",
        hasExistingCuration: true,
      }),
    ];
    const { store, curateAndResolve } = makeDeps({
      getUncuratedEvents: vi.fn().mockResolvedValue(uncurated),
      resolveIdentities: vi.fn().mockResolvedValue(new Map()),
    });

    const result = await curateAndResolve({ epochId: "1" });

    expect(result.totalEvents).toBe(1);
    expect(result.newCurations).toBe(0);
    expect(result.resolved).toBe(0);
    expect(result.unresolved).toBe(1);

    // Neither insert nor update — existing row stays as-is
    expect(store.insertCurationDoNothing).not.toHaveBeenCalled();
    expect(store.updateCurationUserId).not.toHaveBeenCalled();
  });

  it("does NOT overwrite admin-set fields on re-run", async () => {
    // Simulate: event has existing curation (hasExistingCuration=true) with userId already set
    // getUncuratedEvents wouldn't return it (it filters by userId IS NULL).
    // This test verifies the contract: updateCurationUserId is conditional.
    // The activity only calls updateCurationUserId, which has WHERE user_id IS NULL.
    // So an admin who manually set userId to something else is never overwritten.

    // Scenario: event has existing unresolved curation, gets resolved
    const uncurated = [
      makeUncuratedEvent({
        id: "ev1",
        platformUserId: "111",
        hasExistingCuration: true,
      }),
    ];
    const identityMap = new Map([["111", "user-aaa"]]);
    const { store, curateAndResolve } = makeDeps({
      getUncuratedEvents: vi.fn().mockResolvedValue(uncurated),
      resolveIdentities: vi.fn().mockResolvedValue(identityMap),
    });

    await curateAndResolve({ epochId: "1" });

    // updateCurationUserId called — but the adapter's WHERE clause
    // ensures it only updates when user_id IS NULL
    expect(store.updateCurationUserId).toHaveBeenCalledWith(
      1n,
      "ev1",
      "user-aaa"
    );
    // upsertCuration (which overwrites all fields) is NOT called for existing rows
    expect(store.insertCurationDoNothing).not.toHaveBeenCalled();
  });

  it("handles mixed new and existing unresolved events", async () => {
    const uncurated = [
      makeUncuratedEvent({
        id: "ev-new",
        platformUserId: "111",
        hasExistingCuration: false,
      }),
      makeUncuratedEvent({
        id: "ev-existing",
        platformUserId: "222",
        hasExistingCuration: true,
      }),
    ];
    const identityMap = new Map([
      ["111", "user-aaa"],
      ["222", "user-bbb"],
    ]);
    const { store, curateAndResolve } = makeDeps({
      getUncuratedEvents: vi.fn().mockResolvedValue(uncurated),
      resolveIdentities: vi.fn().mockResolvedValue(identityMap),
    });

    const result = await curateAndResolve({ epochId: "1" });

    expect(result.totalEvents).toBe(2);
    expect(result.newCurations).toBe(1);
    expect(result.resolved).toBe(2);
    expect(result.unresolved).toBe(0);

    // New event → upsertCuration
    expect(store.insertCurationDoNothing).toHaveBeenCalledTimes(1);
    // Existing unresolved → updateCurationUserId
    expect(store.updateCurationUserId).toHaveBeenCalledWith(
      1n,
      "ev-existing",
      "user-bbb"
    );
  });
});
