#!/usr/bin/env tsx

// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@scripts/db/seed`
 * Purpose: Dev seed script for governance epoch UI — populates ledger with realistic multi-state epoch data.
 * Scope: Seeds users, epochs, ingestion receipts, selections, allocations, pool components, and epoch statements for local dev. Does not modify production databases or run in CI.
 * Invariants: ONE_OPEN_EPOCH (only 1 open epoch per node/scope); epoch windows aligned via computeEpochWindowV1 (same grid as scheduler); idempotent via onConflictDoNothing on ingestion receipts and users.
 * Side-effects: IO (database writes, console output)
 * Links: work/items/task.0106.ledger-dev-seed.md, tests/_fixtures/ledger/seed-ledger.ts
 * @public
 */

import { createHash } from "node:crypto";
import { DrizzleLedgerAdapter } from "@cogni/db-client";
import { createServiceDbClient } from "@cogni/db-client/service";
import { users } from "@cogni/db-schema/refs";
import { computeEpochWindowV1 } from "@cogni/ledger-core";

// ── Configuration ───────────────────────────────────────────────
// From .cogni/repo-spec.yaml
const NODE_ID = "4ff8eac1-4eba-4ed0-931b-b1fe4f64713d";
const SCOPE_ID = "a28a8b1e-1f9d-5cd5-9329-569e4819feda";
const WEIGHT_CONFIG: Record<string, number> = {
  "github:pr_merged": 8000,
  "github:review_submitted": 2000,
  "discord:message_sent": 500,
};
const POOL_CREDITS = 10000n;
const PRODUCER = "dev-seed";
const PRODUCER_VERSION = "0.0.0-seed";

// Real contributors from Cogni-DAO/node-template
// userId = stable UUID derived deterministically from GitHub databaseId
const DEREK = {
  platformUserId: "58641509",
  login: "derekg1729",
  userId: "d0000000-0000-4000-a000-000058641509",
  name: "Derek G",
};
const COGNI = {
  platformUserId: "207977700",
  login: "Cogni-1729",
  userId: "d0000000-0000-4000-a000-000207977700",
  name: "Cogni (AI Agent)",
};

const CONTRIBUTORS = [DEREK, COGNI];

// ── Helpers ─────────────────────────────────────────────────────

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function payloadHash(data: Record<string, unknown>): string {
  const canonical = JSON.stringify(data, Object.keys(data).sort());
  return sha256(canonical);
}

/** Compute the Monday-aligned epoch window N weeks ago (0 = current week). */
function epochWindowWeeksAgo(weeksAgo: number): {
  periodStart: Date;
  periodEnd: Date;
} {
  const asOf = new Date(Date.now() - weeksAgo * 7 * 86_400_000);
  const { periodStartIso, periodEndIso } = computeEpochWindowV1({
    asOfIso: asOf.toISOString(),
    epochLengthDays: 7,
    timezone: "UTC",
    weekStart: "monday",
  });
  return {
    periodStart: new Date(periodStartIso),
    periodEnd: new Date(periodEndIso),
  };
}

/** Return a Date `days` before a reference date, at the same time-of-day. */
function daysBefore(ref: Date, days: number): Date {
  return new Date(ref.getTime() - days * 86_400_000);
}

// ── Seed Data ───────────────────────────────────────────────────

const WINDOW_1 = epochWindowWeeksAgo(3); // 3 weeks ago — heavy dev sprint
const WINDOW_2 = epochWindowWeeksAgo(2); // 2 weeks ago — ledger infrastructure
const WINDOW_3 = epochWindowWeeksAgo(0); // current week — ongoing work

// Epoch 1 (finalized): ~3 weeks ago — heavy dev sprint
const EPOCH_1 = {
  periodStart: WINDOW_1.periodStart,
  periodEnd: WINDOW_1.periodEnd,
  events: [
    {
      id: "github:pr_merged:Cogni-DAO/node-template:458",
      source: "github",
      eventType: "pr_merged",
      contributor: DEREK,
      artifactUrl: "https://github.com/Cogni-DAO/node-template/pull/458",
      title:
        "feat(ingestion): add ingestion-core package, GitHub adapter, and App auth",
      eventTime: daysBefore(WINDOW_1.periodEnd, 3),
    },
    {
      id: "github:pr_merged:Cogni-DAO/node-template:460",
      source: "github",
      eventType: "pr_merged",
      contributor: DEREK,
      artifactUrl: "https://github.com/Cogni-DAO/node-template/pull/460",
      title:
        "feat(ledger): add epoch collection pipeline via Temporal workflows",
      eventTime: daysBefore(WINDOW_1.periodEnd, 2),
    },
    {
      id: "github:pr_merged:Cogni-DAO/node-template:447",
      source: "github",
      eventType: "pr_merged",
      contributor: COGNI,
      artifactUrl: "https://github.com/Cogni-DAO/node-template/pull/447",
      title: "feat(openclaw): Discord channel agents with lifecycle dispatch",
      eventTime: daysBefore(WINDOW_1.periodEnd, 5),
    },
    {
      id: "github:review_submitted:Cogni-DAO/node-template:447:3823960987",
      source: "github",
      eventType: "review_submitted",
      contributor: DEREK,
      artifactUrl:
        "https://github.com/Cogni-DAO/node-template/pull/447#pullrequestreview-3823960987",
      title: "Review: approve PR #447",
      eventTime: daysBefore(WINDOW_1.periodEnd, 5),
    },
    {
      id: "github:pr_merged:Cogni-DAO/node-template:445",
      source: "github",
      eventType: "pr_merged",
      contributor: COGNI,
      artifactUrl: "https://github.com/Cogni-DAO/node-template/pull/445",
      title: "docs(dev): development lifecycle status updates, agent fixes",
      eventTime: daysBefore(WINDOW_1.periodEnd, 6),
    },
    {
      id: "github:review_submitted:Cogni-DAO/node-template:445:3817607627",
      source: "github",
      eventType: "review_submitted",
      contributor: DEREK,
      artifactUrl:
        "https://github.com/Cogni-DAO/node-template/pull/445#pullrequestreview-3817607627",
      title: "Review: approve PR #445",
      eventTime: daysBefore(WINDOW_1.periodEnd, 6),
    },
  ],
};

// Epoch 2 (finalized): ~2 weeks ago — ledger infrastructure
const EPOCH_2 = {
  periodStart: WINDOW_2.periodStart,
  periodEnd: WINDOW_2.periodEnd,
  events: [
    {
      id: "github:pr_merged:Cogni-DAO/node-template:464",
      source: "github",
      eventType: "pr_merged",
      contributor: DEREK,
      artifactUrl: "https://github.com/Cogni-DAO/node-template/pull/464",
      title:
        "feat(ledger): Zod contracts + API routes for epoch ledger (task.0096)",
      eventTime: daysBefore(WINDOW_2.periodEnd, 3),
    },
    {
      id: "github:pr_merged:Cogni-DAO/node-template:468",
      source: "github",
      eventType: "pr_merged",
      contributor: DEREK,
      artifactUrl: "https://github.com/Cogni-DAO/node-template/pull/468",
      title:
        "feat(ledger): epoch 3-phase state machine + approvers + canonical signing (task.0100)",
      eventTime: daysBefore(WINDOW_2.periodEnd, 2),
    },
    {
      id: "github:pr_merged:Cogni-DAO/node-template:470",
      source: "github",
      eventType: "pr_merged",
      contributor: DEREK,
      artifactUrl: "https://github.com/Cogni-DAO/node-template/pull/470",
      title:
        "feat(ledger): allocation computation, epoch auto-close, and FinalizeEpochWorkflow (task.0102)",
      eventTime: daysBefore(WINDOW_2.periodEnd, 1),
    },
    {
      id: "github:pr_merged:Cogni-DAO/node-template:451",
      source: "github",
      eventType: "pr_merged",
      contributor: COGNI,
      artifactUrl: "https://github.com/Cogni-DAO/node-template/pull/451",
      title: "fix(gov): less frequent heartbeat, generated _index.md",
      eventTime: daysBefore(WINDOW_2.periodEnd, 5),
    },
    {
      id: "github:review_submitted:Cogni-DAO/node-template:451:3826727409",
      source: "github",
      eventType: "review_submitted",
      contributor: DEREK,
      artifactUrl:
        "https://github.com/Cogni-DAO/node-template/pull/451#pullrequestreview-3826727409",
      title: "Review: approve PR #451",
      eventTime: daysBefore(WINDOW_2.periodEnd, 5),
    },
  ],
};

// Epoch 3 (open): current week — ongoing work
const EPOCH_3 = {
  periodStart: WINDOW_3.periodStart,
  periodEnd: WINDOW_3.periodEnd,
  events: [
    {
      id: "github:pr_merged:Cogni-DAO/node-template:435",
      source: "github",
      eventType: "pr_merged",
      contributor: COGNI,
      artifactUrl: "https://github.com/Cogni-DAO/node-template/pull/435",
      title:
        "feat(activity): stacked bar charts, and openclaw agent raw thinking streaming",
      eventTime: daysBefore(WINDOW_3.periodEnd, 5),
    },
    {
      id: "github:review_submitted:Cogni-DAO/node-template:435:3811406373",
      source: "github",
      eventType: "review_submitted",
      contributor: DEREK,
      artifactUrl:
        "https://github.com/Cogni-DAO/node-template/pull/435#pullrequestreview-3811406373",
      title: "Review: approve PR #435",
      eventTime: daysBefore(WINDOW_3.periodEnd, 5),
    },
    {
      id: "github:pr_merged:Cogni-DAO/node-template:434",
      source: "github",
      eventType: "pr_merged",
      contributor: COGNI,
      artifactUrl: "https://github.com/Cogni-DAO/node-template/pull/434",
      title:
        "feat(streaming): OpenClaw agent status events in chat UI (task.0074)",
      eventTime: daysBefore(WINDOW_3.periodEnd, 4),
    },
  ],
};

// ── Allocation computation ──────────────────────────────────────

interface EventDef {
  id: string;
  source: string;
  eventType: string;
  contributor: typeof DEREK;
  artifactUrl: string;
  title: string;
  eventTime: Date;
}

function computeAllocations(
  events: EventDef[],
  weightConfig: Record<string, number>
): { userId: string; proposedUnits: bigint; activityCount: number }[] {
  const byUser = new Map<string, { units: bigint; count: number }>();
  for (const ev of events) {
    const key = `${ev.source}:${ev.eventType}`;
    const weight = BigInt(weightConfig[key] ?? 0);
    const uid = ev.contributor.userId;
    const entry = byUser.get(uid) ?? { units: 0n, count: 0 };
    entry.units += weight;
    entry.count += 1;
    byUser.set(uid, entry);
  }
  return Array.from(byUser.entries()).map(([userId, { units, count }]) => ({
    userId,
    proposedUnits: units,
    activityCount: count,
  }));
}

function computePayouts(
  allocations: {
    userId: string;
    proposedUnits: bigint;
    activityCount: number;
  }[],
  poolTotal: bigint
): Array<{
  user_id: string;
  total_units: string;
  share: string;
  amount_credits: string;
}> {
  const totalUnits = allocations.reduce((s, a) => s + a.proposedUnits, 0n);
  if (totalUnits === 0n) return [];
  return allocations.map((a) => {
    const share = Number(a.proposedUnits) / Number(totalUnits);
    const credits = Math.round(share * Number(poolTotal));
    return {
      user_id: a.userId,
      total_units: a.proposedUnits.toString(),
      share: share.toFixed(6),
      amount_credits: credits.toString(),
    };
  });
}

// ── Main ────────────────────────────────────────────────────────

async function seedFinalizedEpoch(
  store: DrizzleLedgerAdapter,
  epochDef: typeof EPOCH_1
): Promise<void> {
  // 1. Create epoch
  const epoch = await store.createEpoch({
    nodeId: NODE_ID,
    scopeId: SCOPE_ID,
    periodStart: epochDef.periodStart,
    periodEnd: epochDef.periodEnd,
    weightConfig: WEIGHT_CONFIG,
  });
  console.log(
    `  Created epoch ${epoch.id} (${epochDef.periodStart.toISOString().slice(0, 10)} → ${epochDef.periodEnd.toISOString().slice(0, 10)})`
  );

  // 2. Insert ingestion receipts
  await store.insertIngestionReceipts(
    epochDef.events.map((ev) => ({
      receiptId: ev.id,
      nodeId: NODE_ID,
      source: ev.source,
      eventType: ev.eventType,
      platformUserId: ev.contributor.platformUserId,
      platformLogin: ev.contributor.login,
      artifactUrl: ev.artifactUrl,
      metadata: { title: ev.title },
      payloadHash: payloadHash({
        authorId: ev.contributor.platformUserId,
        id: ev.id,
        eventTime: ev.eventTime.toISOString(),
      }),
      producer: PRODUCER,
      producerVersion: PRODUCER_VERSION,
      eventTime: ev.eventTime,
      retrievedAt: ev.eventTime,
    }))
  );
  console.log(`  Inserted ${epochDef.events.length} ingestion receipts`);

  // 3. Insert selections (link receipts to epoch with resolved userId)
  await store.insertSelectionDoNothing(
    epochDef.events.map((ev) => ({
      nodeId: NODE_ID,
      epochId: epoch.id,
      receiptId: ev.id,
      userId: ev.contributor.userId,
      included: true,
    }))
  );
  console.log(`  Inserted ${epochDef.events.length} selections`);

  // 4. Compute and insert allocations
  const allocs = computeAllocations(epochDef.events, WEIGHT_CONFIG);
  await store.insertAllocations(
    allocs.map((a) => ({
      nodeId: NODE_ID,
      epochId: epoch.id,
      userId: a.userId,
      proposedUnits: a.proposedUnits,
      activityCount: a.activityCount,
    }))
  );
  console.log(`  Inserted ${allocs.length} allocations`);

  // 5. Insert pool component (must happen before closeIngestion)
  await store.insertPoolComponent({
    nodeId: NODE_ID,
    epochId: epoch.id,
    componentId: "base_issuance",
    algorithmVersion: "v1.0.0",
    inputsJson: { base_amount: Number(POOL_CREDITS) },
    amountCredits: POOL_CREDITS,
  });
  console.log("  Inserted pool component");

  // 6. Close ingestion (open → review)
  await store.closeIngestion(
    epoch.id,
    sha256("dev-seed-approver-set"),
    "weight-sum-v0",
    sha256(JSON.stringify(WEIGHT_CONFIG))
  );
  console.log("  Closed ingestion (open → review)");

  // 7. Finalize epoch (review → finalized)
  await store.finalizeEpoch(epoch.id, POOL_CREDITS);
  console.log("  Finalized epoch (review → finalized)");

  // 8. Insert epoch statement
  const payouts = computePayouts(allocs, POOL_CREDITS);
  await store.insertEpochStatement({
    nodeId: NODE_ID,
    epochId: epoch.id,
    allocationSetHash: sha256(
      JSON.stringify(
        allocs.map((a) => ({
          userId: a.userId,
          units: a.proposedUnits.toString(),
        }))
      )
    ),
    poolTotalCredits: POOL_CREDITS,
    payoutsJson: payouts,
  });
  console.log("  Inserted epoch statement");
}

async function seedOpenEpoch(
  store: DrizzleLedgerAdapter,
  epochDef: typeof EPOCH_3
): Promise<void> {
  // 1. Create epoch (stays open)
  const epoch = await store.createEpoch({
    nodeId: NODE_ID,
    scopeId: SCOPE_ID,
    periodStart: epochDef.periodStart,
    periodEnd: epochDef.periodEnd,
    weightConfig: WEIGHT_CONFIG,
  });
  console.log(
    `  Created epoch ${epoch.id} (${epochDef.periodStart.toISOString().slice(0, 10)} → ${epochDef.periodEnd.toISOString().slice(0, 10)}) [OPEN]`
  );

  // 2. Insert ingestion receipts
  await store.insertIngestionReceipts(
    epochDef.events.map((ev) => ({
      receiptId: ev.id,
      nodeId: NODE_ID,
      source: ev.source,
      eventType: ev.eventType,
      platformUserId: ev.contributor.platformUserId,
      platformLogin: ev.contributor.login,
      artifactUrl: ev.artifactUrl,
      metadata: { title: ev.title },
      payloadHash: payloadHash({
        authorId: ev.contributor.platformUserId,
        id: ev.id,
        eventTime: ev.eventTime.toISOString(),
      }),
      producer: PRODUCER,
      producerVersion: PRODUCER_VERSION,
      eventTime: ev.eventTime,
      retrievedAt: ev.eventTime,
    }))
  );
  console.log(`  Inserted ${epochDef.events.length} ingestion receipts`);

  // 3. Insert selections (link receipts to epoch with resolved userId)
  await store.insertSelectionDoNothing(
    epochDef.events.map((ev) => ({
      nodeId: NODE_ID,
      epochId: epoch.id,
      receiptId: ev.id,
      userId: ev.contributor.userId,
      included: true,
    }))
  );
  console.log(`  Inserted ${epochDef.events.length} selections`);

  // 4. Compute and insert allocations (live, mutable)
  const allocs = computeAllocations(epochDef.events, WEIGHT_CONFIG);
  await store.insertAllocations(
    allocs.map((a) => ({
      nodeId: NODE_ID,
      epochId: epoch.id,
      userId: a.userId,
      proposedUnits: a.proposedUnits,
      activityCount: a.activityCount,
    }))
  );
  console.log(`  Inserted ${allocs.length} allocations`);

  // 5. Insert pool component
  await store.insertPoolComponent({
    nodeId: NODE_ID,
    epochId: epoch.id,
    componentId: "base_issuance",
    algorithmVersion: "v1.0.0",
    inputsJson: { base_amount: Number(POOL_CREDITS) },
    amountCredits: POOL_CREDITS,
  });
  console.log("  Inserted pool component");
  // Epoch stays open — no closeIngestion or finalize
}

async function main(): Promise<void> {
  const dbUrl = process.env.DATABASE_SERVICE_URL;
  if (!dbUrl) {
    throw new Error("DATABASE_SERVICE_URL not set in .env.local");
  }

  console.log("🌱 Dev Seed: Governance Epoch Ledger Data");
  console.log(`   Node: ${NODE_ID}`);
  console.log(`   Scope: ${SCOPE_ID}`);
  console.log(`   Database: ${dbUrl.replace(/\/\/[^@]+@/, "//***@")}`);
  console.log();

  const db = createServiceDbClient(dbUrl);
  const store = new DrizzleLedgerAdapter(db, SCOPE_ID);

  // Check for existing open epoch — avoid ONE_OPEN_EPOCH violation
  const existingOpen = await store.getOpenEpoch(NODE_ID, SCOPE_ID);
  if (existingOpen) {
    console.log(
      `⚠️  Existing open epoch found (id=${existingOpen.id}). Skipping seed to avoid ONE_OPEN_EPOCH violation.`
    );
    console.log(
      "   To re-seed, first finalize or delete the existing open epoch."
    );
    await db.$client.end();
    return;
  }

  try {
    // Seed user rows (FK target for epoch_selections.user_id and epoch_allocations.user_id)
    console.log("👤 Seeding contributor user rows...");
    await db
      .insert(users)
      .values(
        CONTRIBUTORS.map((c) => ({
          id: c.userId,
          name: c.name,
        }))
      )
      .onConflictDoNothing();
    console.log(
      `  Inserted ${CONTRIBUTORS.length} users (onConflictDoNothing)`
    );
    console.log();

    // Seed 2 finalized epochs
    console.log("📦 Epoch 1 (finalized):");
    await seedFinalizedEpoch(store, EPOCH_1);
    console.log();

    console.log("📦 Epoch 2 (finalized):");
    await seedFinalizedEpoch(store, EPOCH_2);
    console.log();

    // Seed 1 open epoch
    console.log("📦 Epoch 3 (open):");
    await seedOpenEpoch(store, EPOCH_3);
    console.log();

    console.log(
      "✅ Dev seed complete! Start the dev server with `pnpm dev` and visit:"
    );
    console.log("   /gov/epoch    — current open epoch with live allocations");
    console.log("   /gov/history  — 2 finalized epochs with payout statements");
    console.log(
      "   /gov/holdings — aggregated holdings across finalized epochs"
    );
  } finally {
    // Close DB connection
    await db.$client.end();
  }
}

main().catch((error: Error) => {
  console.error("\n💥 Seed failed:");
  console.error(error.message);
  if (error.stack) console.error(error.stack);
  process.exit(1);
});
