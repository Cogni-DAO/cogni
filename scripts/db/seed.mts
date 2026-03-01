#!/usr/bin/env tsx

// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@scripts/db/seed`
 * Purpose: Dev seed script for governance and profile UI — populates attribution
 * ledger data with claimant-aware, linked/unlinked GitHub contributors.
 * Scope: Seeds linked users + GitHub bindings, epochs (2 finalized, 1 review,
 * 1 open), ingestion receipts, selections, allocations, claimant evaluations,
 * pool components, and finalized claimant-aware statements for local dev.
 * Does not modify production databases or run in CI.
 * Invariants:
 * - ONE_OPEN_EPOCH: only one open epoch per node/scope
 * - LINKED_USERS_HAVE_BINDINGS: linked humans are seeded in users +
 *   user_bindings, not just via resolved selections
 * - FINALIZED_EPOCHS_HAVE_LOCKED_CLAIMANT_EVALUATIONS: finalized seed data uses
 *   the claimant-share pipeline shape, not legacy user-only statements
 * - UNCLAIMED_IDENTITIES_VISIBLE: some GitHub contributors stay unresolved and
 *   never get a local user row
 * Side-effects: IO (database writes, console output)
 * Links: work/items/task.0106.ledger-dev-seed.md
 * @public
 */

import { createHash } from "node:crypto";
import {
  type AttributionClaimant,
  type AttributionStatementItem,
  buildClaimantAllocations,
  buildDefaultReceiptClaimantSharesPayload,
  CLAIMANT_SHARES_ALGO_REF,
  CLAIMANT_SHARES_EVALUATION_REF,
  claimantKey,
  computeArtifactsHash,
  computeClaimantAllocationSetHash,
  computeClaimantCreditLineItems,
  computeEpochWindowV1,
  computeWeightConfigHash,
  deriveAllocationAlgoRef,
  type SelectedReceiptForAttribution,
  sha256OfCanonicalJson,
  type UpsertEvaluationParams,
} from "@cogni/attribution-ledger";
import { DrizzleAttributionAdapter } from "@cogni/db-client";
import { createServiceDbClient } from "@cogni/db-client/service";
import { identityEvents, userBindings } from "@cogni/db-schema/identity";
import { users } from "@cogni/db-schema/refs";

// ── Configuration ───────────────────────────────────────────────

const REPO_REF = "Cogni-DAO/node-template";
const NODE_ID = "4ff8eac1-4eba-4ed0-931b-b1fe4f64713d";
const SCOPE_ID = "a28a8b1e-1f9d-5cd5-9329-569e4819feda";
const WEIGHT_CONFIG: Record<string, number> = {
  "github:pr_merged": 8000,
  "github:review_submitted": 2000,
  "discord:message_sent": 500,
};
const ALLOCATION_ALGO_REF = deriveAllocationAlgoRef("cogni-v0.0");
const PRODUCER = "dev-seed";
const PRODUCER_VERSION = "0.1.0-seed";

// ── Contributors ────────────────────────────────────────────────

interface SeedContributor {
  platformUserId: string;
  login: string;
  userId: string | null;
  name: string;
}

function seedUserIdFromGitHubId(platformUserId: string): string {
  return `d0000000-0000-4000-a000-${platformUserId.padStart(12, "0")}`;
}

function linkedContributor(params: {
  platformUserId: string;
  login: string;
  name: string;
}): SeedContributor {
  return {
    ...params,
    userId: seedUserIdFromGitHubId(params.platformUserId),
  };
}

function unlinkedContributor(params: {
  platformUserId: string;
  login: string;
  name: string;
}): SeedContributor {
  return {
    ...params,
    userId: null,
  };
}

const DEREK = unlinkedContributor({
  platformUserId: "58641509",
  login: "derekg1729",
  name: "Derek G",
});

const ALICE = linkedContributor({
  platformUserId: "90000101",
  login: "alice-vector",
  name: "Alice Vector",
});

const BEN = linkedContributor({
  platformUserId: "90000102",
  login: "ben-rivera",
  name: "Ben Rivera",
});

const MIRA = unlinkedContributor({
  platformUserId: "90000103",
  login: "mira-stone",
  name: "Mira Stone",
});

const COGNI = unlinkedContributor({
  platformUserId: "207977700",
  login: "Cogni-1729",
  name: "Cogni (AI Agent)",
});

const LINKED_CONTRIBUTORS = [ALICE, BEN] as const;

// ── Helpers ─────────────────────────────────────────────────────

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function payloadHash(data: Record<string, unknown>): string {
  const canonical = JSON.stringify(data, Object.keys(data).sort());
  return sha256(canonical);
}

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

function daysBefore(ref: Date, days: number): Date {
  return new Date(ref.getTime() - days * 86_400_000);
}

// ── Seed Data ───────────────────────────────────────────────────

interface EventDef {
  id: string;
  source: "github";
  eventType: "pr_merged" | "review_submitted";
  contributor: SeedContributor;
  artifactUrl: string;
  title: string;
  eventTime: Date;
  metadata: Record<string, unknown>;
}

interface SeedEpochDef {
  periodStart: Date;
  periodEnd: Date;
  poolCredits: bigint;
  events: readonly EventDef[];
}

function prEvent(params: {
  number: number;
  title: string;
  contributor: SeedContributor;
  eventTime: Date;
  reassignedFrom?: string;
}): EventDef {
  return {
    id: `github:pr:${REPO_REF}:${params.number}`,
    source: "github",
    eventType: "pr_merged",
    contributor: params.contributor,
    artifactUrl: `https://github.com/${REPO_REF}/pull/${params.number}`,
    title: params.title,
    eventTime: params.eventTime,
    metadata: {
      repo: REPO_REF,
      ...(params.reassignedFrom
        ? { seedReassignedFrom: params.reassignedFrom }
        : {}),
    },
  };
}

function reviewEvent(params: {
  prNumber: number;
  reviewDatabaseId: number;
  title: string;
  contributor: SeedContributor;
  eventTime: Date;
  state?: string;
}): EventDef {
  const state = params.state ?? "APPROVED";
  return {
    id: `github:review:${REPO_REF}:${params.prNumber}:${params.reviewDatabaseId}`,
    source: "github",
    eventType: "review_submitted",
    contributor: params.contributor,
    artifactUrl: `https://github.com/${REPO_REF}/pull/${params.prNumber}#pullrequestreview-${params.reviewDatabaseId}`,
    title: params.title,
    eventTime: params.eventTime,
    metadata: {
      repo: REPO_REF,
      prNumber: params.prNumber,
      state,
    },
  };
}

const WINDOW_1 = epochWindowWeeksAgo(4);
const WINDOW_2 = epochWindowWeeksAgo(3);
const WINDOW_3 = epochWindowWeeksAgo(1);
const WINDOW_4 = epochWindowWeeksAgo(0);

const EPOCH_1: SeedEpochDef = {
  periodStart: WINDOW_1.periodStart,
  periodEnd: WINDOW_1.periodEnd,
  poolCredits: 12000n,
  events: [
    prEvent({
      number: 451,
      title: "fix(gov): less frequent heartbeat, generated _index.md",
      contributor: COGNI,
      eventTime: daysBefore(WINDOW_1.periodEnd, 6),
    }),
    reviewEvent({
      prNumber: 451,
      reviewDatabaseId: 3826727409,
      title: "Review: approve PR #451",
      contributor: DEREK,
      eventTime: daysBefore(WINDOW_1.periodEnd, 6),
    }),
    prEvent({
      number: 447,
      title: "feat(openclaw): Discord channel agents with lifecycle dispatch",
      contributor: COGNI,
      eventTime: daysBefore(WINDOW_1.periodEnd, 5),
    }),
    reviewEvent({
      prNumber: 447,
      reviewDatabaseId: 3823960987,
      title: "Review: approve PR #447",
      contributor: DEREK,
      eventTime: daysBefore(WINDOW_1.periodEnd, 5),
    }),
    prEvent({
      number: 480,
      title:
        "feat(auth): backend supports multi-provider OAuth login + account linking (task.0107)",
      contributor: ALICE,
      eventTime: daysBefore(WINDOW_1.periodEnd, 4),
      reassignedFrom: "derekg1729",
    }),
    prEvent({
      number: 482,
      title:
        "feat(ui): add sidebar layout, mobile polish, OC-inspired table primitives",
      contributor: BEN,
      eventTime: daysBefore(WINDOW_1.periodEnd, 3),
      reassignedFrom: "derekg1729",
    }),
    prEvent({
      number: 479,
      title: "fix(db): remove duplicate epochs migration, fix snapshot drift",
      contributor: MIRA,
      eventTime: daysBefore(WINDOW_1.periodEnd, 2),
      reassignedFrom: "derekg1729",
    }),
    prEvent({
      number: 483,
      title:
        "feat(profile): user profile scaffolding, identity DB hardening, RLS policies",
      contributor: DEREK,
      eventTime: daysBefore(WINDOW_1.periodEnd, 1),
    }),
  ],
};

const EPOCH_2: SeedEpochDef = {
  periodStart: WINDOW_2.periodStart,
  periodEnd: WINDOW_2.periodEnd,
  poolCredits: 16000n,
  events: [
    prEvent({
      number: 470,
      title:
        "feat(ledger): allocation computation, epoch auto-close, and FinalizeEpochWorkflow (task.0102)",
      contributor: DEREK,
      eventTime: daysBefore(WINDOW_2.periodEnd, 6),
    }),
    prEvent({
      number: 468,
      title:
        "feat(ledger): epoch 3-phase state machine + approvers + canonical signing (task.0100)",
      contributor: ALICE,
      eventTime: daysBefore(WINDOW_2.periodEnd, 5),
      reassignedFrom: "derekg1729",
    }),
    prEvent({
      number: 464,
      title:
        "feat(ledger): Zod contracts + API routes for epoch ledger (task.0096)",
      contributor: BEN,
      eventTime: daysBefore(WINDOW_2.periodEnd, 4),
      reassignedFrom: "derekg1729",
    }),
    prEvent({
      number: 472,
      title:
        "feat(governance): v0 epoch UI, dev data seed script, and dev:setup workflow",
      contributor: DEREK,
      eventTime: daysBefore(WINDOW_2.periodEnd, 3),
    }),
    prEvent({
      number: 475,
      title: "fix(gov): surface unresolved contributors in epoch UI (bug.0092)",
      contributor: MIRA,
      eventTime: daysBefore(WINDOW_2.periodEnd, 2),
      reassignedFrom: "derekg1729",
    }),
    prEvent({
      number: 445,
      title: "docs(dev): development lifecycle status updates, agent fixes",
      contributor: COGNI,
      eventTime: daysBefore(WINDOW_2.periodEnd, 2),
    }),
    reviewEvent({
      prNumber: 445,
      reviewDatabaseId: 3817607627,
      title: "Review: approve PR #445",
      contributor: DEREK,
      eventTime: daysBefore(WINDOW_2.periodEnd, 2),
    }),
    prEvent({
      number: 473,
      title:
        "feat(scheduler-worker): add observability modules, metrics, and event registry",
      contributor: DEREK,
      eventTime: daysBefore(WINDOW_2.periodEnd, 1),
    }),
  ],
};

const EPOCH_3: SeedEpochDef = {
  periodStart: WINDOW_3.periodStart,
  periodEnd: WINDOW_3.periodEnd,
  poolCredits: 15000n,
  events: [
    prEvent({
      number: 496,
      title: "feat(auth): oauth Signin UI and profile oauth linking v0",
      contributor: DEREK,
      eventTime: daysBefore(WINDOW_3.periodEnd, 6),
    }),
    prEvent({
      number: 494,
      title: "refactor(attribution): rename Epoch Ledger -> Attribution Ledger",
      contributor: ALICE,
      eventTime: daysBefore(WINDOW_3.periodEnd, 5),
      reassignedFrom: "derekg1729",
    }),
    prEvent({
      number: 492,
      title: "refactor(ledger): rename pipeline stages across all layers",
      contributor: BEN,
      eventTime: daysBefore(WINDOW_3.periodEnd, 4),
      reassignedFrom: "derekg1729",
    }),
    prEvent({
      number: 490,
      title:
        "feat(ledger): epoch artifact pipeline + echo enricher (task.0113)",
      contributor: DEREK,
      eventTime: daysBefore(WINDOW_3.periodEnd, 3),
    }),
    prEvent({
      number: 488,
      title:
        "feat(work): governance ideas batch - operator plane, DAO gateway, MDI partnership",
      contributor: MIRA,
      eventTime: daysBefore(WINDOW_3.periodEnd, 2),
      reassignedFrom: "derekg1729",
    }),
    prEvent({
      number: 485,
      title:
        "feat(heartbeat): replace read-only drift monitor with active branch sync",
      contributor: DEREK,
      eventTime: daysBefore(WINDOW_3.periodEnd, 2),
    }),
    prEvent({
      number: 435,
      title:
        "feat(activity): stacked bar charts, and openclaw agent raw thinking streaming",
      contributor: COGNI,
      eventTime: daysBefore(WINDOW_3.periodEnd, 1),
    }),
    reviewEvent({
      prNumber: 435,
      reviewDatabaseId: 3811406373,
      title: "Review: approve PR #435",
      contributor: DEREK,
      eventTime: daysBefore(WINDOW_3.periodEnd, 1),
    }),
  ],
};

const EPOCH_4: SeedEpochDef = {
  periodStart: WINDOW_4.periodStart,
  periodEnd: WINDOW_4.periodEnd,
  poolCredits: 14000n,
  events: [
    prEvent({
      number: 500,
      title:
        "feat(attribution): migrate signature verification from EIP-191 to EIP-712",
      contributor: DEREK,
      eventTime: daysBefore(WINDOW_4.periodEnd, 5),
    }),
    prEvent({
      number: 498,
      title: "feat(attribution): add GET /epochs/[id]/sign-data endpoint",
      contributor: ALICE,
      eventTime: daysBefore(WINDOW_4.periodEnd, 4),
      reassignedFrom: "derekg1729",
    }),
    prEvent({
      number: 497,
      title: "docs(work): add task.0119 — epoch approver UI",
      contributor: COGNI,
      eventTime: daysBefore(WINDOW_4.periodEnd, 3),
    }),
    reviewEvent({
      prNumber: 497,
      reviewDatabaseId: 3830201455,
      title: "Review: approve PR #497",
      contributor: DEREK,
      eventTime: daysBefore(WINDOW_4.periodEnd, 3),
    }),
    prEvent({
      number: 495,
      title:
        "fix(governance): epoch history pagination and empty state handling",
      contributor: BEN,
      eventTime: daysBefore(WINDOW_4.periodEnd, 2),
      reassignedFrom: "derekg1729",
    }),
    prEvent({
      number: 493,
      title:
        "feat(profile): wallet connection status indicator and balance display",
      contributor: MIRA,
      eventTime: daysBefore(WINDOW_4.periodEnd, 2),
      reassignedFrom: "derekg1729",
    }),
    prEvent({
      number: 491,
      title: "docs(spec): update attribution ledger spec with EIP-712 signing",
      contributor: DEREK,
      eventTime: daysBefore(WINDOW_4.periodEnd, 1),
    }),
    reviewEvent({
      prNumber: 491,
      reviewDatabaseId: 3832405617,
      title: "Review: approve PR #491",
      contributor: ALICE,
      eventTime: daysBefore(WINDOW_4.periodEnd, 1),
    }),
  ],
};

// ── Receipt + evaluation helpers ────────────────────────────────

function eventPayloadHash(event: EventDef): string {
  const authorId = event.contributor.platformUserId;
  switch (event.eventType) {
    case "pr_merged":
      return payloadHash({
        authorId,
        id: event.id,
        mergedAt: event.eventTime.toISOString(),
      });
    case "review_submitted":
      return payloadHash({
        authorId,
        id: event.id,
        state: event.metadata.state ?? "APPROVED",
        submittedAt: event.eventTime.toISOString(),
      });
  }
}

function buildAttributionReceipts(
  events: readonly EventDef[]
): SelectedReceiptForAttribution[] {
  return events.map((event) => ({
    receiptId: event.id,
    userId: event.contributor.userId,
    source: event.source,
    eventType: event.eventType,
    included: true,
    weightOverrideMilli: null,
    platformUserId: event.contributor.platformUserId,
    platformLogin: event.contributor.login,
    artifactUrl: event.artifactUrl,
    eventTime: event.eventTime,
    payloadHash: eventPayloadHash(event),
  }));
}

function computeResolvedAllocations(
  receipts: readonly SelectedReceiptForAttribution[],
  weightConfig: Record<string, number>
): { userId: string; proposedUnits: bigint; activityCount: number }[] {
  const byUser = new Map<string, { units: bigint; count: number }>();

  for (const receipt of receipts) {
    if (!receipt.userId || !receipt.included) continue;

    const key = `${receipt.source}:${receipt.eventType}`;
    const weight =
      receipt.weightOverrideMilli ?? BigInt(weightConfig[key] ?? 0);

    const entry = byUser.get(receipt.userId) ?? { units: 0n, count: 0 };
    entry.units += weight;
    entry.count += 1;
    byUser.set(receipt.userId, entry);
  }

  return [...byUser.entries()]
    .map(([userId, { units, count }]) => ({
      userId,
      proposedUnits: units,
      activityCount: count,
    }))
    .sort((a, b) => a.userId.localeCompare(b.userId));
}

async function buildClaimantSharesEvaluation(params: {
  epochId: bigint;
  status: "draft" | "locked";
  receipts: readonly SelectedReceiptForAttribution[];
  weightConfig: Record<string, number>;
}): Promise<{
  evaluation: UpsertEvaluationParams;
  payload: ReturnType<typeof buildDefaultReceiptClaimantSharesPayload>;
}> {
  const payload = buildDefaultReceiptClaimantSharesPayload({
    receipts: params.receipts,
    weightConfig: params.weightConfig,
  });
  const payloadHashValue = await sha256OfCanonicalJson(payload);
  const inputsHash = await sha256OfCanonicalJson({
    epochId: params.epochId.toString(),
    weightConfig: params.weightConfig,
    receipts: params.receipts.map((receipt) => ({
      receiptId: receipt.receiptId,
      userId: receipt.userId,
      source: receipt.source,
      eventType: receipt.eventType,
      included: receipt.included,
      weightOverrideMilli: receipt.weightOverrideMilli?.toString() ?? null,
      platformUserId: receipt.platformUserId,
      payloadHash: receipt.payloadHash,
    })),
  });

  return {
    evaluation: {
      nodeId: NODE_ID,
      epochId: params.epochId,
      evaluationRef: CLAIMANT_SHARES_EVALUATION_REF,
      status: params.status,
      algoRef: CLAIMANT_SHARES_ALGO_REF,
      inputsHash,
      payloadHash: payloadHashValue,
      payloadJson: payload,
    },
    payload,
  };
}

function statementUserId(claimant: AttributionClaimant): string {
  return claimant.kind === "user" ? claimant.userId : claimantKey(claimant);
}

async function buildClaimantAwareStatement(params: {
  payload: ReturnType<typeof buildDefaultReceiptClaimantSharesPayload>;
  poolCredits: bigint;
}): Promise<{
  allocationSetHash: string;
  statementItems: AttributionStatementItem[];
}> {
  const claimantAllocations = buildClaimantAllocations(params.payload.subjects);
  const allocationSetHash =
    await computeClaimantAllocationSetHash(claimantAllocations);
  const lineItems = computeClaimantCreditLineItems(
    claimantAllocations,
    params.poolCredits
  );

  return {
    allocationSetHash,
    statementItems: lineItems.map((lineItem) => ({
      user_id: statementUserId(lineItem.claimant),
      total_units: lineItem.totalUnits.toString(),
      share: lineItem.share,
      amount_credits: lineItem.amountCredits.toString(),
      claimant_key: claimantKey(lineItem.claimant),
      claimant: lineItem.claimant,
      receipt_ids: [...lineItem.receiptIds],
    })),
  };
}

async function seedLinkedUsersAndBindings(
  db: ReturnType<typeof createServiceDbClient>
): Promise<void> {
  await db
    .insert(users)
    .values(
      LINKED_CONTRIBUTORS.map((contributor) => ({
        id: contributor.userId as string,
        name: contributor.name,
      }))
    )
    .onConflictDoNothing();

  for (const contributor of LINKED_CONTRIBUTORS) {
    await db.transaction(async (tx) => {
      const [binding] = await tx
        .insert(userBindings)
        .values({
          id: `seed:github-binding:${contributor.platformUserId}`,
          userId: contributor.userId as string,
          provider: "github",
          externalId: contributor.platformUserId,
          providerLogin: contributor.login,
        })
        .onConflictDoNothing({
          target: [userBindings.provider, userBindings.externalId],
        })
        .returning({ id: userBindings.id });

      if (!binding) return;

      await tx.insert(identityEvents).values({
        id: `seed:identity-event:github:${contributor.platformUserId}`,
        userId: contributor.userId as string,
        eventType: "bind",
        payload: {
          method: "dev-seed",
          provider: "github",
          external_id: contributor.platformUserId,
          provider_login: contributor.login,
          repo: REPO_REF,
        },
      });
    });
  }
}

// ── Main ────────────────────────────────────────────────────────

async function seedFinalizedEpoch(
  store: DrizzleAttributionAdapter,
  epochDef: SeedEpochDef
): Promise<void> {
  const epoch = await store.createEpoch({
    nodeId: NODE_ID,
    scopeId: SCOPE_ID,
    periodStart: epochDef.periodStart,
    periodEnd: epochDef.periodEnd,
    weightConfig: WEIGHT_CONFIG,
  });
  console.log(
    `  Created epoch ${epoch.id} (${epochDef.periodStart.toISOString().slice(0, 10)} -> ${epochDef.periodEnd.toISOString().slice(0, 10)})`
  );

  const attributionReceipts = buildAttributionReceipts(epochDef.events);

  await store.insertIngestionReceipts(
    epochDef.events.map((event, index) => ({
      receiptId: event.id,
      nodeId: NODE_ID,
      source: event.source,
      eventType: event.eventType,
      platformUserId: event.contributor.platformUserId,
      platformLogin: event.contributor.login,
      artifactUrl: event.artifactUrl,
      metadata: {
        title: event.title,
        ...event.metadata,
      },
      payloadHash:
        attributionReceipts[index]?.payloadHash ?? eventPayloadHash(event),
      producer: PRODUCER,
      producerVersion: PRODUCER_VERSION,
      eventTime: event.eventTime,
      retrievedAt: event.eventTime,
    }))
  );
  console.log(`  Inserted ${epochDef.events.length} ingestion receipts`);

  await store.insertSelectionDoNothing(
    attributionReceipts.map((receipt) => ({
      nodeId: NODE_ID,
      epochId: epoch.id,
      receiptId: receipt.receiptId,
      userId: receipt.userId,
      included: true,
    }))
  );
  console.log(`  Inserted ${epochDef.events.length} selections`);

  const allocations = computeResolvedAllocations(
    attributionReceipts,
    WEIGHT_CONFIG
  );
  if (allocations.length > 0) {
    await store.insertAllocations(
      allocations.map((allocation) => ({
        nodeId: NODE_ID,
        epochId: epoch.id,
        userId: allocation.userId,
        proposedUnits: allocation.proposedUnits,
        activityCount: allocation.activityCount,
      }))
    );
  }
  console.log(`  Inserted ${allocations.length} resolved-user allocations`);

  await store.insertPoolComponent({
    nodeId: NODE_ID,
    epochId: epoch.id,
    componentId: "base_issuance",
    algorithmVersion: "v1.0.0",
    inputsJson: { base_amount: Number(epochDef.poolCredits) },
    amountCredits: epochDef.poolCredits,
  });
  console.log("  Inserted pool component");

  const { evaluation, payload } = await buildClaimantSharesEvaluation({
    epochId: epoch.id,
    status: "locked",
    receipts: attributionReceipts,
    weightConfig: WEIGHT_CONFIG,
  });
  const weightConfigHash = await computeWeightConfigHash(WEIGHT_CONFIG);
  const artifactsHash = await computeArtifactsHash([evaluation]);

  await store.closeIngestionWithEvaluations({
    epochId: epoch.id,
    approverSetHash: sha256("dev-seed-approver-set"),
    allocationAlgoRef: ALLOCATION_ALGO_REF,
    weightConfigHash,
    evaluations: [evaluation],
    artifactsHash,
  });
  console.log("  Inserted locked claimant evaluation and closed ingestion");

  await store.finalizeEpoch(epoch.id, epochDef.poolCredits);
  console.log("  Finalized epoch (review -> finalized)");

  const statement = await buildClaimantAwareStatement({
    payload,
    poolCredits: epochDef.poolCredits,
  });
  await store.insertEpochStatement({
    nodeId: NODE_ID,
    epochId: epoch.id,
    allocationSetHash: statement.allocationSetHash,
    poolTotalCredits: epochDef.poolCredits,
    statementItems: statement.statementItems,
  });
  console.log("  Inserted claimant-aware epoch statement");
}

async function seedReviewEpoch(
  store: DrizzleAttributionAdapter,
  epochDef: SeedEpochDef
): Promise<void> {
  const epoch = await store.createEpoch({
    nodeId: NODE_ID,
    scopeId: SCOPE_ID,
    periodStart: epochDef.periodStart,
    periodEnd: epochDef.periodEnd,
    weightConfig: WEIGHT_CONFIG,
  });
  console.log(
    `  Created epoch ${epoch.id} (${epochDef.periodStart.toISOString().slice(0, 10)} -> ${epochDef.periodEnd.toISOString().slice(0, 10)}) [REVIEW]`
  );

  const attributionReceipts = buildAttributionReceipts(epochDef.events);

  await store.insertIngestionReceipts(
    epochDef.events.map((event, index) => ({
      receiptId: event.id,
      nodeId: NODE_ID,
      source: event.source,
      eventType: event.eventType,
      platformUserId: event.contributor.platformUserId,
      platformLogin: event.contributor.login,
      artifactUrl: event.artifactUrl,
      metadata: {
        title: event.title,
        ...event.metadata,
      },
      payloadHash:
        attributionReceipts[index]?.payloadHash ?? eventPayloadHash(event),
      producer: PRODUCER,
      producerVersion: PRODUCER_VERSION,
      eventTime: event.eventTime,
      retrievedAt: event.eventTime,
    }))
  );
  console.log(`  Inserted ${epochDef.events.length} ingestion receipts`);

  await store.insertSelectionDoNothing(
    attributionReceipts.map((receipt) => ({
      nodeId: NODE_ID,
      epochId: epoch.id,
      receiptId: receipt.receiptId,
      userId: receipt.userId,
      included: true,
    }))
  );
  console.log(`  Inserted ${epochDef.events.length} selections`);

  const allocations = computeResolvedAllocations(
    attributionReceipts,
    WEIGHT_CONFIG
  );
  if (allocations.length > 0) {
    await store.insertAllocations(
      allocations.map((allocation) => ({
        nodeId: NODE_ID,
        epochId: epoch.id,
        userId: allocation.userId,
        proposedUnits: allocation.proposedUnits,
        activityCount: allocation.activityCount,
      }))
    );
  }
  console.log(`  Inserted ${allocations.length} resolved-user allocations`);

  await store.insertPoolComponent({
    nodeId: NODE_ID,
    epochId: epoch.id,
    componentId: "base_issuance",
    algorithmVersion: "v1.0.0",
    inputsJson: { base_amount: Number(epochDef.poolCredits) },
    amountCredits: epochDef.poolCredits,
  });
  console.log("  Inserted pool component");

  const { evaluation } = await buildClaimantSharesEvaluation({
    epochId: epoch.id,
    status: "locked",
    receipts: attributionReceipts,
    weightConfig: WEIGHT_CONFIG,
  });
  const weightConfigHash = await computeWeightConfigHash(WEIGHT_CONFIG);
  const artifactsHash = await computeArtifactsHash([evaluation]);

  await store.closeIngestionWithEvaluations({
    epochId: epoch.id,
    approverSetHash: sha256("dev-seed-approver-set"),
    allocationAlgoRef: ALLOCATION_ALGO_REF,
    weightConfigHash,
    evaluations: [evaluation],
    artifactsHash,
  });
  console.log("  Closed ingestion (open -> review)");
}

async function seedOpenEpoch(
  store: DrizzleAttributionAdapter,
  epochDef: SeedEpochDef
): Promise<void> {
  const epoch = await store.createEpoch({
    nodeId: NODE_ID,
    scopeId: SCOPE_ID,
    periodStart: epochDef.periodStart,
    periodEnd: epochDef.periodEnd,
    weightConfig: WEIGHT_CONFIG,
  });
  console.log(
    `  Created epoch ${epoch.id} (${epochDef.periodStart.toISOString().slice(0, 10)} -> ${epochDef.periodEnd.toISOString().slice(0, 10)}) [OPEN]`
  );

  const attributionReceipts = buildAttributionReceipts(epochDef.events);

  await store.insertIngestionReceipts(
    epochDef.events.map((event, index) => ({
      receiptId: event.id,
      nodeId: NODE_ID,
      source: event.source,
      eventType: event.eventType,
      platformUserId: event.contributor.platformUserId,
      platformLogin: event.contributor.login,
      artifactUrl: event.artifactUrl,
      metadata: {
        title: event.title,
        ...event.metadata,
      },
      payloadHash:
        attributionReceipts[index]?.payloadHash ?? eventPayloadHash(event),
      producer: PRODUCER,
      producerVersion: PRODUCER_VERSION,
      eventTime: event.eventTime,
      retrievedAt: event.eventTime,
    }))
  );
  console.log(`  Inserted ${epochDef.events.length} ingestion receipts`);

  await store.insertSelectionDoNothing(
    attributionReceipts.map((receipt) => ({
      nodeId: NODE_ID,
      epochId: epoch.id,
      receiptId: receipt.receiptId,
      userId: receipt.userId,
      included: true,
    }))
  );
  console.log(`  Inserted ${epochDef.events.length} selections`);

  const allocations = computeResolvedAllocations(
    attributionReceipts,
    WEIGHT_CONFIG
  );
  if (allocations.length > 0) {
    await store.insertAllocations(
      allocations.map((allocation) => ({
        nodeId: NODE_ID,
        epochId: epoch.id,
        userId: allocation.userId,
        proposedUnits: allocation.proposedUnits,
        activityCount: allocation.activityCount,
      }))
    );
  }
  console.log(`  Inserted ${allocations.length} resolved-user allocations`);

  await store.insertPoolComponent({
    nodeId: NODE_ID,
    epochId: epoch.id,
    componentId: "base_issuance",
    algorithmVersion: "v1.0.0",
    inputsJson: { base_amount: Number(epochDef.poolCredits) },
    amountCredits: epochDef.poolCredits,
  });
  console.log("  Inserted pool component");

  const { evaluation } = await buildClaimantSharesEvaluation({
    epochId: epoch.id,
    status: "draft",
    receipts: attributionReceipts,
    weightConfig: WEIGHT_CONFIG,
  });
  await store.upsertDraftEvaluation(evaluation);
  console.log("  Inserted draft claimant-share evaluation");
}

async function main(): Promise<void> {
  const dbUrl = process.env.DATABASE_SERVICE_URL;
  if (!dbUrl) {
    throw new Error("DATABASE_SERVICE_URL not set in .env.local");
  }

  console.log("🌱 Dev Seed: Claimant-Aware Attribution Data");
  console.log(`   Node: ${NODE_ID}`);
  console.log(`   Scope: ${SCOPE_ID}`);
  console.log(`   Repo: ${REPO_REF}`);
  console.log(`   Database: ${dbUrl.replace(/\/\/[^@]+@/, "//***@")}`);
  console.log();

  const db = createServiceDbClient(dbUrl);
  const store = new DrizzleAttributionAdapter(db, SCOPE_ID);

  const existingEpochs = await store.listEpochs(NODE_ID);
  if (existingEpochs.length > 0) {
    const openEpoch = existingEpochs.find((epoch) => epoch.status === "open");
    console.log(
      `⚠️  Existing attribution epochs found for node ${NODE_ID}. Skipping seed to avoid duplicate dev history.`
    );
    if (openEpoch) {
      console.log(
        `   Existing open epoch: ${openEpoch.id}. Finalize or delete it before reseeding.`
      );
    }
    console.log(
      "   To re-seed from scratch, reset the dev database and rerun `pnpm dev:setup`."
    );
    await db.$client.end();
    return;
  }

  try {
    console.log("👤 Seeding linked contributor accounts...");
    await seedLinkedUsersAndBindings(db);
    console.log(
      `  Inserted ${LINKED_CONTRIBUTORS.length} linked users with GitHub bindings`
    );
    console.log(
      `  Unlinked GitHub identities remain receipt-only: ${DEREK.login}, ${COGNI.login}, ${MIRA.login}`
    );
    console.log();

    console.log("📦 Epoch 1 (finalized):");
    await seedFinalizedEpoch(store, EPOCH_1);
    console.log();

    console.log("📦 Epoch 2 (finalized):");
    await seedFinalizedEpoch(store, EPOCH_2);
    console.log();

    console.log("📦 Epoch 3 (review):");
    await seedReviewEpoch(store, EPOCH_3);
    console.log();

    console.log("📦 Epoch 4 (open):");
    await seedOpenEpoch(store, EPOCH_4);
    console.log();

    console.log(
      "✅ Dev seed complete! Start the dev server with `pnpm dev` and visit:"
    );
    console.log(
      "   /gov/epoch    -> current open epoch with resolved contributors + unresolved GitHub identities"
    );
    console.log(
      "   /gov/history  -> finalized epochs with claimant-aware statements"
    );
    console.log(
      "   /gov/holdings -> cumulative holdings including unresolved claimant sets"
    );
    console.log(
      "   /gov/review   -> epoch in review status ready for sign & finalize workflow"
    );
    console.log(
      "   /profile      -> derekg1729 stays unlinked (link via OAuth); Alice + Ben are pre-linked; Cogni + Mira unclaimed"
    );
  } finally {
    await db.$client.end();
  }
}

main().catch((error: Error) => {
  console.error("\n💥 Seed failed:");
  console.error(error.message);
  if (error.stack) console.error(error.stack);
  process.exit(1);
});
