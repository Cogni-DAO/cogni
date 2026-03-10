// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/attribution-pipeline-plugins/tests/plugins/promotion-selection/descriptor`
 * Purpose: Unit tests for promotion-selection policy — bot exclusion, factory defaults, and cross-epoch matching.
 * Scope: Pure unit tests against the selection policy descriptor. Does not test I/O or store writes.
 * Invariants: SELECTION_POLICY_PURE, PRODUCTION_PROMOTION
 * Side-effects: none
 * Links: packages/attribution-pipeline-plugins/src/plugins/promotion-selection/descriptor.ts
 * @internal
 */

import type { IngestionReceipt } from "@cogni/attribution-ledger";
import { describe, expect, it } from "vitest";
import {
  createPromotionSelectionPolicy,
  PROMOTION_SELECTION_POLICY,
  PROMOTION_SELECTION_POLICY_REF,
} from "../../../src/plugins/promotion-selection/descriptor";

/** Helper: build a minimal IngestionReceipt for test fixtures. */
function makeReceipt(
  overrides: Partial<IngestionReceipt> & { receiptId: string }
): IngestionReceipt {
  return {
    nodeId: "node-1",
    source: "github",
    eventType: "pr_merged",
    platformUserId: "12345",
    platformLogin: null,
    artifactUrl: null,
    metadata: null,
    payloadHash: "abc",
    producer: "github",
    producerVersion: "1.0.0",
    eventTime: new Date("2026-03-05"),
    retrievedAt: new Date("2026-03-05"),
    ingestedAt: new Date("2026-03-05"),
    ...overrides,
  };
}

describe("createPromotionSelectionPolicy", () => {
  it("excluded login returns included=false even when PR is promoted", () => {
    const policy = createPromotionSelectionPolicy({
      excludedLogins: ["Cogni-1729"],
    });

    // Release PR (baseBranch=main) that promotes sha-abc
    const releasePr = makeReceipt({
      receiptId: "github:pr:release:1",
      platformLogin: "derekg1729",
      metadata: {
        baseBranch: "main",
        commitShas: ["sha-abc"],
      },
    });

    // Bot's staging PR that was promoted (mergeCommitSha matches)
    const botPr = makeReceipt({
      receiptId: "github:pr:staging:2",
      platformLogin: "Cogni-1729",
      metadata: {
        baseBranch: "staging",
        mergeCommitSha: "sha-abc",
        repo: "Cogni-DAO/node-template",
      },
    });

    const decisions = policy.select({
      receiptsToSelect: [botPr],
      allReceipts: [releasePr, botPr],
    });

    expect(decisions).toHaveLength(1);
    expect(decisions[0].receiptId).toBe("github:pr:staging:2");
    expect(decisions[0].included).toBe(false);
  });

  it("non-excluded login with promoted PR returns included=true", () => {
    const policy = createPromotionSelectionPolicy({
      excludedLogins: ["Cogni-1729"],
    });

    const releasePr = makeReceipt({
      receiptId: "github:pr:release:1",
      metadata: {
        baseBranch: "main",
        commitShas: ["sha-human"],
      },
    });

    const humanPr = makeReceipt({
      receiptId: "github:pr:staging:3",
      platformLogin: "derekg1729",
      metadata: {
        baseBranch: "staging",
        mergeCommitSha: "sha-human",
        repo: "Cogni-DAO/node-template",
      },
    });

    const decisions = policy.select({
      receiptsToSelect: [humanPr],
      allReceipts: [releasePr, humanPr],
    });

    expect(decisions[0].included).toBe(true);
  });

  it("factory default (no config) behaves identically to PROMOTION_SELECTION_POLICY constant", () => {
    const defaultPolicy = createPromotionSelectionPolicy();

    const releasePr = makeReceipt({
      receiptId: "github:pr:release:1",
      metadata: {
        baseBranch: "main",
        commitShas: ["sha-x"],
      },
    });

    const stagingPr = makeReceipt({
      receiptId: "github:pr:staging:2",
      platformLogin: "Cogni-1729",
      metadata: {
        baseBranch: "staging",
        mergeCommitSha: "sha-x",
        repo: "Cogni-DAO/node-template",
      },
    });

    const context = {
      receiptsToSelect: [stagingPr],
      allReceipts: [releasePr, stagingPr],
    };

    const fromFactory = defaultPolicy.select(context);
    const fromConstant = PROMOTION_SELECTION_POLICY.select(context);

    expect(fromFactory).toEqual(fromConstant);
    expect(defaultPolicy.policyRef).toBe(PROMOTION_SELECTION_POLICY_REF);
  });

  it("cross-epoch promotion: staging PR from epoch N-1 matched against release PR from epoch N", () => {
    const policy = createPromotionSelectionPolicy();

    // Release PR merged in epoch N (March 9–16) referencing staging sha from epoch N-1
    const releasePr = makeReceipt({
      receiptId: "github:pr:release:10",
      eventTime: new Date("2026-03-10"),
      metadata: {
        baseBranch: "main",
        commitShas: ["sha-old-staging"],
      },
    });

    // Staging PR merged in epoch N-1 (March 2–9)
    const stagingPr = makeReceipt({
      receiptId: "github:pr:staging:5",
      eventTime: new Date("2026-03-04"),
      platformLogin: "derekg1729",
      metadata: {
        baseBranch: "staging",
        mergeCommitSha: "sha-old-staging",
        repo: "Cogni-DAO/node-template",
      },
    });

    // Both are in allReceipts (full history), but only stagingPr is being selected
    const decisions = policy.select({
      receiptsToSelect: [stagingPr],
      allReceipts: [releasePr, stagingPr],
    });

    expect(decisions[0].included).toBe(true);
  });

  it("excluded login on review_submitted also returns included=false", () => {
    const policy = createPromotionSelectionPolicy({
      excludedLogins: ["Cogni-1729"],
    });

    const releasePr = makeReceipt({
      receiptId: "github:pr:release:1",
      metadata: {
        baseBranch: "main",
        commitShas: ["sha-rev"],
      },
    });

    const stagingPr = makeReceipt({
      receiptId: "github:pr:staging:2",
      platformLogin: "derekg1729",
      metadata: {
        baseBranch: "staging",
        mergeCommitSha: "sha-rev",
        repo: "Cogni-DAO/node-template",
      },
    });

    const botReview = makeReceipt({
      receiptId: "github:review:3",
      eventType: "review_submitted",
      platformLogin: "Cogni-1729",
      metadata: {
        repo: "Cogni-DAO/node-template",
        prNumber: 2,
      },
    });

    const decisions = policy.select({
      receiptsToSelect: [botReview],
      allReceipts: [releasePr, stagingPr, botReview],
    });

    expect(decisions[0].included).toBe(false);
  });

  it("receipt with null platformLogin is not affected by exclusion list", () => {
    const policy = createPromotionSelectionPolicy({
      excludedLogins: ["Cogni-1729"],
    });

    const releasePr = makeReceipt({
      receiptId: "github:pr:release:1",
      metadata: {
        baseBranch: "main",
        commitShas: ["sha-null"],
      },
    });

    const prWithNullLogin = makeReceipt({
      receiptId: "github:pr:staging:4",
      platformLogin: null,
      metadata: {
        baseBranch: "staging",
        mergeCommitSha: "sha-null",
        repo: "Cogni-DAO/node-template",
      },
    });

    const decisions = policy.select({
      receiptsToSelect: [prWithNullLogin],
      allReceipts: [releasePr, prWithNullLogin],
    });

    // null login should NOT be excluded, so normal promotion logic applies
    expect(decisions[0].included).toBe(true);
  });
});
