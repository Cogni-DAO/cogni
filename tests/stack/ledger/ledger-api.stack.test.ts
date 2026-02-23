// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/stack/ledger/ledger-api.stack`
 * Purpose: Stack-level validation of public ledger API routes against a seeded closed epoch.
 * Scope: Tests 3 public read routes via HTTP fetch. Does not test auth-gated or write routes.
 * Invariants: PUBLIC_READS_CLOSED_ONLY, ALL_MATH_BIGINT, VALIDATE_IO, NODE_SCOPED.
 * Side-effects: IO (HTTP requests, database writes for seeding)
 * Notes: Seeds data using real node_id/scope_id from repo-spec since routes use getNodeId().
 * Links: src/app/api/v1/public/ledger/, src/contracts/ledger.*.v1.contract.ts
 * @public
 */

import { DrizzleLedgerAdapter } from "@cogni/db-client";
import { getSeedDb } from "@tests/_fixtures/db/seed-client";
import { fetchStackTest } from "@tests/_fixtures/http/rate-limit-helpers";
import type { SeededClosedEpoch } from "@tests/_fixtures/ledger/seed-ledger";
import { seedClosedEpoch } from "@tests/_fixtures/ledger/seed-ledger";
import { beforeAll, describe, expect, it } from "vitest";
import { EpochAllocationsOutputSchema } from "@/contracts/ledger.epoch-allocations.v1.contract";
import { EpochStatementOutputSchema } from "@/contracts/ledger.epoch-statement.v1.contract";
import { ListEpochsOutputSchema } from "@/contracts/ledger.list-epochs.v1.contract";
import { users } from "@/shared/db/schema";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Real node_id from .cogni/repo-spec.yaml — routes use getNodeId() */
const REPO_NODE_ID = "4ff8eac1-4eba-4ed0-931b-b1fe4f64713d";
const REPO_SCOPE_ID = "a28a8b1e-1f9d-5cd5-9329-569e4819feda";

function baseUrl(path: string): string {
  const root = process.env.TEST_BASE_URL ?? "http://localhost:3000";
  return new URL(path.replace(/^\//, ""), root).toString();
}

// ---------------------------------------------------------------------------
// Setup: seed a closed epoch with the real node_id
// ---------------------------------------------------------------------------

let seeded: SeededClosedEpoch;

beforeAll(async () => {
  const db = getSeedDb();

  // Seed users required by activity_curation + allocations FK constraints
  await db
    .insert(users)
    .values([
      {
        id: "user-1",
        walletAddress: `0x${"a1".repeat(20)}`,
        name: "Test User 1",
      },
      {
        id: "user-2",
        walletAddress: `0x${"b2".repeat(20)}`,
        name: "Test User 2",
      },
    ])
    .onConflictDoNothing();

  const store = new DrizzleLedgerAdapter(db, REPO_SCOPE_ID);
  seeded = await seedClosedEpoch(store, {
    nodeId: REPO_NODE_ID,
    scopeId: REPO_SCOPE_ID,
    weekOffset: -10, // far in the past to avoid collisions
  });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Public ledger API routes", () => {
  describe("GET /api/v1/public/ledger/epochs", () => {
    it("returns closed epochs matching ListEpochsOutputSchema", async () => {
      const response = await fetchStackTest(
        baseUrl("/api/v1/public/ledger/epochs?limit=100&offset=0")
      );
      expect(response.status).toBe(200);

      const body = await response.json();
      const parsed = ListEpochsOutputSchema.safeParse(body);
      if (!parsed.success) {
        throw new Error(
          `Response does not match ListEpochsOutputSchema: ${parsed.error.message}`
        );
      }
      expect(parsed.success).toBe(true);

      // Seeded epoch should appear in the list
      expect(parsed.data.total).toBeGreaterThanOrEqual(1);
      const found = parsed.data.epochs.find(
        (e) => e.id === String(seeded.epoch.id)
      );
      if (!found) {
        throw new Error(
          `Seeded epoch ${seeded.epoch.id} not found in response. Got IDs: ${parsed.data.epochs.map((e) => e.id).join(", ")}`
        );
      }
      expect(found.status).toBe("closed");
      expect(found.poolTotalCredits).toBe("10000");
    });

    it("only returns closed epochs (not open)", async () => {
      const response = await fetchStackTest(
        baseUrl("/api/v1/public/ledger/epochs?limit=200&offset=0")
      );
      expect(response.status).toBe(200);

      const body = await response.json();
      const parsed = ListEpochsOutputSchema.parse(body);

      // Every epoch in the public response must be closed
      for (const epoch of parsed.epochs) {
        expect(epoch.status).toBe("closed");
      }
    });

    it("respects pagination parameters", async () => {
      const response = await fetchStackTest(
        baseUrl("/api/v1/public/ledger/epochs?limit=1&offset=0")
      );
      expect(response.status).toBe(200);

      const body = await response.json();
      const parsed = ListEpochsOutputSchema.parse(body);
      expect(parsed.epochs.length).toBeLessThanOrEqual(1);
    });
  });

  describe("GET /api/v1/public/ledger/epochs/{id}/allocations", () => {
    it("returns allocations for a closed epoch", async () => {
      const epochId = String(seeded.epoch.id);
      const response = await fetchStackTest(
        baseUrl(`/api/v1/public/ledger/epochs/${epochId}/allocations`)
      );
      expect(response.status).toBe(200);

      const body = await response.json();
      const parsed = EpochAllocationsOutputSchema.safeParse(body);
      if (!parsed.success) {
        throw new Error(
          `Response does not match EpochAllocationsOutputSchema: ${parsed.error.message}`
        );
      }
      expect(parsed.success).toBe(true);

      expect(parsed.data.epochId).toBe(epochId);
      expect(parsed.data.allocations.length).toBe(2);

      // Verify BigInt serialization (ALL_MATH_BIGINT)
      for (const alloc of parsed.data.allocations) {
        expect(typeof alloc.proposedUnits).toBe("string");
        expect(typeof alloc.id).toBe("string");
      }
    });

    it("returns 404 for non-existent epoch", async () => {
      const response = await fetchStackTest(
        baseUrl("/api/v1/public/ledger/epochs/999999/allocations")
      );
      expect(response.status).toBe(404);
    });

    it("returns 400 for invalid epoch ID", async () => {
      const response = await fetchStackTest(
        baseUrl("/api/v1/public/ledger/epochs/not-a-number/allocations")
      );
      expect(response.status).toBe(400);
    });
  });

  describe("GET /api/v1/public/ledger/epochs/{id}/statement", () => {
    it("returns payout statement for a closed epoch", async () => {
      const epochId = String(seeded.epoch.id);
      const response = await fetchStackTest(
        baseUrl(`/api/v1/public/ledger/epochs/${epochId}/statement`)
      );
      expect(response.status).toBe(200);

      const body = await response.json();
      const parsed = EpochStatementOutputSchema.safeParse(body);
      if (!parsed.success) {
        throw new Error(
          `Response does not match EpochStatementOutputSchema: ${parsed.error.message}`
        );
      }
      expect(parsed.success).toBe(true);

      // Statement should be non-null for seeded epoch
      if (!parsed.data.statement) {
        throw new Error("Expected statement to be non-null for seeded epoch");
      }
      expect(parsed.data.statement.epochId).toBe(epochId);
      expect(parsed.data.statement.poolTotalCredits).toBe("10000");
      expect(parsed.data.statement.payouts).toHaveLength(2);

      // Verify payout line structure
      const payout = parsed.data.statement.payouts[0];
      expect(payout).toHaveProperty("user_id");
      expect(payout).toHaveProperty("total_units");
      expect(payout).toHaveProperty("share");
      expect(payout).toHaveProperty("amount_credits");
    });

    it("returns 404 for non-existent epoch", async () => {
      const response = await fetchStackTest(
        baseUrl("/api/v1/public/ledger/epochs/999999/statement")
      );
      expect(response.status).toBe(404);
    });

    it("returns 400 for invalid epoch ID", async () => {
      const response = await fetchStackTest(
        baseUrl("/api/v1/public/ledger/epochs/not-a-number/statement")
      );
      expect(response.status).toBe(400);
    });
  });
});
