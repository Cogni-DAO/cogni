// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/_fixtures/ledger/seed-ledger`
 * Purpose: Reusable ledger test fixtures for seeding epochs, activity events, and related data.
 * Scope: Factory functions for ledger test data + composite seeders for common test scenarios. Does not contain test logic or assertions.
 * Invariants: All generated IDs are deterministic from inputs where possible.
 * Side-effects: none (pure data factories); composite seeders perform IO via store
 * Links: packages/ledger-core/src/store.ts, tests/component/db/drizzle-ledger.adapter.int.test.ts
 * @internal
 */

import type {
  ActivityLedgerStore,
  InsertActivityEventParams,
  InsertAllocationParams,
  InsertCurationAutoParams,
  InsertPayoutStatementParams,
  InsertPoolComponentParams,
  LedgerEpoch,
  LedgerPayoutStatement,
  LedgerPoolComponent,
  UpsertCurationParams,
} from "@cogni/ledger-core";

/** Stable test node ID for ledger integration tests */
export const TEST_NODE_ID = "00000000-0000-4000-8000-000000000001";

/** Stable test scope ID for ledger integration tests */
export const TEST_SCOPE_ID = "00000000-0000-4000-8000-000000000002";

/** Epoch window helpers */
export function weekWindow(weekOffset = 0): {
  periodStart: Date;
  periodEnd: Date;
} {
  const base = new Date("2026-01-05T00:00:00Z"); // Monday
  const start = new Date(base);
  start.setDate(start.getDate() + weekOffset * 7);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return { periodStart: start, periodEnd: end };
}

/** Default weight config for tests */
export const TEST_WEIGHT_CONFIG: Record<string, number> = {
  "github:pr_merged": 8000,
  "github:review_submitted": 2000,
  "discord:message_sent": 500,
};

/** Build an activity event insert param with sensible defaults */
export function makeActivityEvent(
  overrides: Partial<InsertActivityEventParams> & { id: string }
): InsertActivityEventParams {
  return {
    nodeId: TEST_NODE_ID,
    scopeId: TEST_SCOPE_ID,
    source: "github",
    eventType: "pr_merged",
    platformUserId: "12345",
    payloadHash: "test-hash-placeholder",
    producer: "test-adapter",
    producerVersion: "0.0.0-test",
    eventTime: new Date("2026-01-06T12:00:00Z"),
    retrievedAt: new Date("2026-01-06T12:00:01Z"),
    ...overrides,
  };
}

/** Build a curation upsert param with sensible defaults */
export function makeCuration(
  overrides: Partial<UpsertCurationParams> & {
    epochId: bigint;
    eventId: string;
  }
): UpsertCurationParams {
  return {
    nodeId: TEST_NODE_ID,
    included: true,
    ...overrides,
  };
}

/** Build a curation auto-populate param (narrowed insert) */
export function makeCurationAuto(
  overrides: Partial<InsertCurationAutoParams> & {
    epochId: bigint;
    eventId: string;
  }
): InsertCurationAutoParams {
  return {
    nodeId: TEST_NODE_ID,
    userId: null,
    included: true,
    ...overrides,
  };
}

/** Build an allocation insert param with sensible defaults */
export function makeAllocation(
  overrides: Partial<InsertAllocationParams> & {
    epochId: bigint;
    userId: string;
  }
): InsertAllocationParams {
  return {
    nodeId: TEST_NODE_ID,
    proposedUnits: 1000n,
    activityCount: 1,
    ...overrides,
  };
}

/** Build a pool component insert param with sensible defaults */
export function makePoolComponent(
  overrides: Partial<InsertPoolComponentParams> & { epochId: bigint }
): InsertPoolComponentParams {
  return {
    nodeId: TEST_NODE_ID,
    componentId: "base_issuance",
    algorithmVersion: "v1.0.0",
    inputsJson: { base_amount: 10000 },
    amountCredits: 10000n,
    ...overrides,
  };
}

/** Build a payout statement insert param with sensible defaults */
export function makePayoutStatement(
  overrides: Partial<InsertPayoutStatementParams> & { epochId: bigint }
): InsertPayoutStatementParams {
  return {
    nodeId: TEST_NODE_ID,
    allocationSetHash: "test-hash-abc123",
    poolTotalCredits: 10000n,
    payoutsJson: [
      {
        user_id: "user-1",
        total_units: "8000",
        share: "0.800000",
        amount_credits: "8000",
      },
      {
        user_id: "user-2",
        total_units: "2000",
        share: "0.200000",
        amount_credits: "2000",
      },
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Composite seeders — seed a full scenario in one call
// ---------------------------------------------------------------------------

/** Result of seeding a closed epoch with all related data */
export interface SeededClosedEpoch {
  epoch: LedgerEpoch;
  poolComponent: LedgerPoolComponent;
  statement: LedgerPayoutStatement;
}

/**
 * Seeds a complete closed epoch with activity, curations, allocations,
 * a pool component, and a payout statement. Suitable for testing read routes.
 *
 * @param store - The ActivityLedgerStore to seed into
 * @param opts.nodeId - Node ID (defaults to TEST_NODE_ID)
 * @param opts.scopeId - Scope ID (defaults to TEST_SCOPE_ID)
 * @param opts.weekOffset - Week offset for epoch window (defaults to 0)
 */
export async function seedClosedEpoch(
  store: ActivityLedgerStore,
  opts: {
    nodeId?: string;
    scopeId?: string;
    weekOffset?: number;
  } = {}
): Promise<SeededClosedEpoch> {
  const nodeId = opts.nodeId ?? TEST_NODE_ID;
  const scopeId = opts.scopeId ?? TEST_SCOPE_ID;
  const { periodStart, periodEnd } = weekWindow(opts.weekOffset ?? 0);

  // 1. Create epoch
  const epoch = await store.createEpoch({
    nodeId,
    scopeId,
    periodStart,
    periodEnd,
    weightConfig: TEST_WEIGHT_CONFIG,
  });

  // 2. Insert activity events within the epoch window
  const eventMidpoint = new Date(
    (periodStart.getTime() + periodEnd.getTime()) / 2
  );
  await store.insertActivityEvents([
    makeActivityEvent({
      id: `test-event-${epoch.id}-1`,
      nodeId,
      scopeId,
      platformUserId: "gh-user-101",
      platformLogin: "alice",
      artifactUrl: "https://github.com/test/repo/pull/1",
      eventTime: eventMidpoint,
      retrievedAt: eventMidpoint,
    }),
    makeActivityEvent({
      id: `test-event-${epoch.id}-2`,
      nodeId,
      scopeId,
      source: "github",
      eventType: "review_submitted",
      platformUserId: "gh-user-202",
      platformLogin: "bob",
      artifactUrl: "https://github.com/test/repo/pull/1#review",
      eventTime: eventMidpoint,
      retrievedAt: eventMidpoint,
    }),
  ]);

  // 3. Insert curations (auto-populate pattern)
  await store.insertCurationDoNothing([
    makeCurationAuto({
      nodeId,
      epochId: epoch.id,
      eventId: `test-event-${epoch.id}-1`,
      userId: "user-1",
      included: true,
    }),
    makeCurationAuto({
      nodeId,
      epochId: epoch.id,
      eventId: `test-event-${epoch.id}-2`,
      userId: "user-2",
      included: true,
    }),
  ]);

  // 4. Insert allocations
  await store.insertAllocations([
    makeAllocation({
      nodeId,
      epochId: epoch.id,
      userId: "user-1",
      proposedUnits: 8000n,
      activityCount: 1,
    }),
    makeAllocation({
      nodeId,
      epochId: epoch.id,
      userId: "user-2",
      proposedUnits: 2000n,
      activityCount: 1,
    }),
  ]);

  // 5. Insert pool component
  const poolComponent = await store.insertPoolComponent(
    makePoolComponent({
      nodeId,
      epochId: epoch.id,
    })
  );

  // 6. Transition epoch: open → review → finalized
  const poolTotal = 10000n;
  await store.closeIngestion(epoch.id, "test-approver-set-hash");
  const finalizedEpoch = await store.finalizeEpoch(epoch.id, poolTotal);

  // 7. Insert payout statement (after finalize)
  const statement = await store.insertPayoutStatement(
    makePayoutStatement({
      nodeId,
      epochId: epoch.id,
    })
  );

  return { epoch: finalizedEpoch, poolComponent, statement };
}
