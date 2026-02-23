// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/tests/external/ingestion/github-adapter.external.test`
 * Purpose: Validate GitHubSourceAdapter against real GitHub API using Cogni-DAO/test-repo.
 * Scope: Proves GraphQL queries parse, all 3 streams produce ActivityEvent[], deterministic IDs, ledger round-trip. Does not test webhook handling.
 * Invariants: Requires GITHUB_REVIEW_APP_ID + GITHUB_REVIEW_APP_PRIVATE_KEY_BASE64 in env. Skips gracefully if missing.
 * Side-effects: IO (GitHub GraphQL, testcontainers PostgreSQL)
 * Links: services/scheduler-worker/src/adapters/ingestion/github.ts, docs/spec/epoch-ledger.md
 * @internal
 */

import { DrizzleLedgerAdapter } from "@cogni/db-client";
import type { ActivityEvent } from "@cogni/ingestion-core";
import type { InsertActivityEventParams } from "@cogni/ledger-core";
import { getSeedDb } from "@tests/_fixtures/db/seed-client";
import {
  TEST_NODE_ID,
  TEST_SCOPE_ID,
  TEST_WEIGHT_CONFIG,
} from "@tests/_fixtures/ledger/seed-ledger";
import { seedTestActor } from "@tests/_fixtures/stack/seed";
import { beforeAll, describe, expect, it } from "vitest";
import { GitHubSourceAdapter } from "../../../services/scheduler-worker/src/adapters/ingestion/github";
import { GitHubAppTokenProvider } from "../../../services/scheduler-worker/src/adapters/ingestion/github-auth";

// ---------------------------------------------------------------------------
// Auth resolution — skip entire suite if no GitHub App credentials available
// ---------------------------------------------------------------------------

const GITHUB_REVIEW_APP_ID = process.env.GITHUB_REVIEW_APP_ID ?? "";
const GITHUB_REVIEW_APP_PRIVATE_KEY_BASE64 =
  process.env.GITHUB_REVIEW_APP_PRIVATE_KEY_BASE64 ?? "";
const GITHUB_REVIEW_INSTALLATION_ID = process.env.GITHUB_REVIEW_INSTALLATION_ID
  ? Number(process.env.GITHUB_REVIEW_INSTALLATION_ID)
  : undefined;

const hasAppCreds =
  GITHUB_REVIEW_APP_ID && GITHUB_REVIEW_APP_PRIVATE_KEY_BASE64;
const describeWithAuth = hasAppCreds ? describe : describe.skip;

// ---------------------------------------------------------------------------
// Test-repo known data (Cogni-DAO/test-repo)
// ---------------------------------------------------------------------------

const TEST_REPO = "Cogni-DAO/test-repo";

// PR #52: merged 2026-02-21, review from Cogni-1729 (APPROVED) at 2026-02-21T17:57:54Z
// Issue #51: closed 2026-02-21T17:53:25Z
// 6 original merged PRs from 2025-09-30 to 2025-11-01

/** Window capturing the test fixtures we created (issue #51, PR #52 + review) */
const FIXTURE_WINDOW = {
  since: new Date("2026-02-20T00:00:00Z"),
  until: new Date("2026-02-23T00:00:00Z"),
};

/** Wide window capturing all historical merged PRs */
const WIDE_WINDOW = {
  since: new Date("2025-09-01T00:00:00Z"),
  until: new Date("2026-12-31T00:00:00Z"),
};

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describeWithAuth("GitHubSourceAdapter (external)", () => {
  const tokenProvider = new GitHubAppTokenProvider({
    appId: GITHUB_REVIEW_APP_ID,
    privateKey: Buffer.from(
      GITHUB_REVIEW_APP_PRIVATE_KEY_BASE64,
      "base64"
    ).toString("utf-8"),
    installationId: GITHUB_REVIEW_INSTALLATION_ID,
  });

  const adapter = new GitHubSourceAdapter({
    tokenProvider,
    repos: [TEST_REPO],
  });

  // ── Stream definitions ──────────────────────────────────────────

  it("streams() returns 3 stream definitions", () => {
    const streams = adapter.streams();
    expect(streams).toHaveLength(3);
    const ids = streams.map((s) => s.id);
    expect(ids).toContain("pull_requests");
    expect(ids).toContain("reviews");
    expect(ids).toContain("issues");
  });

  // ── Merged PRs ──────────────────────────────────────────────────

  it("collects merged PRs from known time window", async () => {
    const result = await adapter.collect({
      streams: ["pull_requests"],
      cursor: null,
      window: WIDE_WINDOW,
    });

    // test-repo has 7 merged PRs, all by real User authors — repo-scoped query returns all
    expect(result.events.length).toBeGreaterThanOrEqual(7);
    expect(result.nextCursor).toBeDefined();
    expect(result.nextCursor.value).toBeTruthy();

    for (const event of result.events) {
      expect(event.source).toBe("github");
      expect(event.eventType).toBe("pr_merged");
      expect(event.id).toMatch(/^github:pr:Cogni-DAO\/test-repo:\d+$/);
      expect(event.platformUserId).toBeTruthy();
      expect(event.payloadHash).toMatch(/^[a-f0-9]{64}$/);
      expect(event.eventTime).toBeInstanceOf(Date);
      expect(event.artifactUrl).toContain("github.com");
    }

    // Known PR #38 should be present
    const pr38 = result.events.find(
      (e) => e.id === "github:pr:Cogni-DAO/test-repo:38"
    );
    expect(pr38).toBeDefined();
    expect(pr38?.platformLogin).toBe("derekg1729");
    expect(pr38?.platformUserId).toBe("58641509");
  });

  // ── Closed issues ───────────────────────────────────────────────

  it("collects closed issues from known time window", async () => {
    const result = await adapter.collect({
      streams: ["issues"],
      cursor: null,
      window: FIXTURE_WINDOW,
    });

    expect(result.events.length).toBeGreaterThanOrEqual(1);

    const issue51 = result.events.find(
      (e) => e.id === "github:issue:Cogni-DAO/test-repo:51"
    );
    expect(issue51).toBeDefined();
    expect(issue51?.eventType).toBe("issue_closed");
    expect(issue51?.source).toBe("github");
    expect(issue51?.platformUserId).toBeTruthy();
    expect(issue51?.payloadHash).toMatch(/^[a-f0-9]{64}$/);
  });

  // ── Reviews ─────────────────────────────────────────────────────

  it("collects reviews from known time window", async () => {
    const result = await adapter.collect({
      streams: ["reviews"],
      cursor: null,
      window: FIXTURE_WINDOW,
    });

    expect(result.events.length).toBeGreaterThanOrEqual(1);

    // Review on PR #52 from Cogni-1729
    const review = result.events.find((e) =>
      e.id.startsWith("github:review:Cogni-DAO/test-repo:52:")
    );
    expect(review).toBeDefined();
    expect(review?.eventType).toBe("review_submitted");
    expect(review?.source).toBe("github");
    expect(review?.platformLogin).toBeTruthy();
    expect(review?.payloadHash).toMatch(/^[a-f0-9]{64}$/);
    expect(review?.artifactUrl).toContain("/pull/52#pullrequestreview-");
  });

  // ── Determinism ─────────────────────────────────────────────────

  it("deterministic: same window twice yields identical IDs and hashes", async () => {
    const params = {
      streams: ["pull_requests"] as string[],
      cursor: null,
      window: FIXTURE_WINDOW,
    };

    const [run1, run2] = await Promise.all([
      adapter.collect(params),
      adapter.collect(params),
    ]);

    expect(run1.events.length).toBe(run2.events.length);

    const ids1 = run1.events.map((e) => e.id).sort();
    const ids2 = run2.events.map((e) => e.id).sort();
    expect(ids1).toEqual(ids2);

    const hashes1 = run1.events.map((e) => e.payloadHash).sort();
    const hashes2 = run2.events.map((e) => e.payloadHash).sort();
    expect(hashes1).toEqual(hashes2);
  });

  // ── Ledger round-trip ───────────────────────────────────────────

  describe("ledger round-trip", () => {
    const db = getSeedDb();
    const ledger = new DrizzleLedgerAdapter(db, TEST_SCOPE_ID);
    beforeAll(async () => {
      await seedTestActor(db);
      await ledger.createEpoch({
        nodeId: TEST_NODE_ID,
        scopeId: TEST_SCOPE_ID,
        periodStart: FIXTURE_WINDOW.since,
        periodEnd: FIXTURE_WINDOW.until,
        weightConfig: TEST_WEIGHT_CONFIG,
      });
    });

    it("adapter events insert into ledger and survive re-insert (idempotent)", async () => {
      // Collect real events
      const result = await adapter.collect({
        streams: ["pull_requests"],
        cursor: null,
        window: WIDE_WINDOW,
      });
      expect(result.events.length).toBeGreaterThan(0);

      // Map ActivityEvent → InsertActivityEventParams
      const params: InsertActivityEventParams[] = result.events.map(
        (e: ActivityEvent) => ({
          id: e.id,
          nodeId: TEST_NODE_ID,
          scopeId: TEST_SCOPE_ID,
          source: e.source,
          eventType: e.eventType,
          platformUserId: e.platformUserId,
          platformLogin: e.platformLogin,
          artifactUrl: e.artifactUrl,
          metadata: e.metadata,
          payloadHash: e.payloadHash,
          producer: adapter.source,
          producerVersion: adapter.version,
          eventTime: e.eventTime,
          retrievedAt: new Date(),
        })
      );

      // First insert
      await ledger.insertActivityEvents(params);

      // Verify data persisted
      const stored = await ledger.getActivityForWindow(
        TEST_NODE_ID,
        WIDE_WINDOW.since,
        WIDE_WINDOW.until
      );
      expect(stored.length).toBeGreaterThanOrEqual(result.events.length);

      // Re-insert same events — idempotent, no error
      await expect(
        ledger.insertActivityEvents(params)
      ).resolves.toBeUndefined();
    });
  });
});
