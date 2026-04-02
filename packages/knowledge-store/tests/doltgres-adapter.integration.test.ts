// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/knowledge-store/tests/doltgres-adapter`
 * Purpose: Verifies DoltgresKnowledgeStoreAdapter CRUD, versioning, and auth against live Doltgres.
 * Scope: Covers insert/select/update/delete, commit/log/diff, reader role restrictions. Does not cover branching or remotes.
 * Invariants: Skips when Doltgres unavailable (port 5435). Creates + drops ephemeral test database.
 * Side-effects: IO (database operations against localhost:5435)
 * Links: packages/knowledge-store/src/adapters/doltgres/index.ts, docs/spec/knowledge-data-plane.md
 * @public
 */

import { createConnection } from "node:net";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildDoltgresClient } from "../src/adapters/doltgres/build-client.js";
import { DoltgresKnowledgeStoreAdapter } from "../src/adapters/doltgres/index.js";
import { NewKnowledgeSchema } from "../src/domain/schemas.js";

const ROOT_DSN = "postgresql://postgres:doltgres@localhost:5435/postgres";
const TEST_DB = "knowledge_integration_test";
const TEST_DSN = `postgresql://postgres:doltgres@localhost:5435/${TEST_DB}`;

// Check if Doltgres is reachable before running tests
async function isDoltgresAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = createConnection(5435, "127.0.0.1");
    sock.setTimeout(1000);
    sock.on("connect", () => {
      sock.destroy();
      resolve(true);
    });
    sock.on("timeout", () => {
      sock.destroy();
      resolve(false);
    });
    sock.on("error", () => {
      sock.destroy();
      resolve(false);
    });
  });
}

const doltgresUp = await isDoltgresAvailable();

describe.skipIf(!doltgresUp)("DoltgresKnowledgeStoreAdapter", () => {
  let rootSql: ReturnType<typeof postgres>;
  let testSql: ReturnType<typeof postgres>;
  let adapter: DoltgresKnowledgeStoreAdapter;

  beforeAll(async () => {
    rootSql = postgres(ROOT_DSN, {
      max: 1,
      idle_timeout: 5,
      fetch_types: false,
    });

    // Create test database (idempotent)
    try {
      await rootSql.unsafe(`CREATE DATABASE ${TEST_DB}`);
    } catch {
      // Already exists — fine
    }

    testSql = buildDoltgresClient({
      connectionString: TEST_DSN,
      applicationName: "test",
    });

    // Create schema
    await testSql.unsafe(`
      DROP TABLE IF EXISTS knowledge;
      CREATE TABLE knowledge (
        id TEXT PRIMARY KEY,
        domain TEXT NOT NULL,
        entity_id TEXT,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        confidence_pct INTEGER,
        source_type TEXT NOT NULL,
        source_ref TEXT,
        tags JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Initial commit (clean slate)
    await testSql.unsafe(
      "SELECT dolt_commit('-Am', 'test: create knowledge table')"
    );

    adapter = new DoltgresKnowledgeStoreAdapter({ sql: testSql });
  });

  afterAll(async () => {
    await testSql?.end();
    // Clean up test database
    try {
      await rootSql?.unsafe(`DROP DATABASE IF EXISTS ${TEST_DB}`);
    } catch {
      // Best effort
    }
    await rootSql?.end();
  });

  // --- CRUD ---

  it("addKnowledge inserts and returns the entry", async () => {
    const entry = NewKnowledgeSchema.parse({
      id: "test-add-001",
      domain: "prediction-market",
      title: "Fed rate cut base rate",
      content: "Historical frequency ~35%",
      sourceType: "external",
      confidencePct: 75,
      tags: ["macro", "fed"],
    });

    const result = await adapter.addKnowledge(entry);
    expect(result.id).toBe("test-add-001");
    expect(result.domain).toBe("prediction-market");
    expect(result.confidencePct).toBe(75);
    expect(result.tags).toEqual(["macro", "fed"]);
  });

  it("getKnowledge retrieves by ID", async () => {
    const result = await adapter.getKnowledge("test-add-001");
    expect(result).not.toBeNull();
    expect(result!.title).toBe("Fed rate cut base rate");
  });

  it("getKnowledge returns null for missing ID", async () => {
    const result = await adapter.getKnowledge("nonexistent");
    expect(result).toBeNull();
  });

  it("listKnowledge filters by domain", async () => {
    await adapter.addKnowledge({
      id: "test-list-001",
      domain: "prediction-market",
      title: "Liquidity signal",
      content: "High liquidity = better calibration",
      sourceType: "derived",
    });
    await adapter.addKnowledge({
      id: "test-list-002",
      domain: "infrastructure",
      title: "CPU anomaly threshold",
      content: "Alert at 95th percentile > 80%",
      sourceType: "human",
    });

    const pmResults = await adapter.listKnowledge("prediction-market");
    expect(pmResults.length).toBeGreaterThanOrEqual(2);
    expect(pmResults.every((r) => r.domain === "prediction-market")).toBe(true);

    const infraResults = await adapter.listKnowledge("infrastructure");
    expect(infraResults.length).toBe(1);
    expect(infraResults[0]!.title).toBe("CPU anomaly threshold");
  });

  it("listKnowledge filters by tags", async () => {
    const results = await adapter.listKnowledge("prediction-market", {
      tags: ["macro"],
    });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some((r) => r.id === "test-add-001")).toBe(true);
  });

  it("searchKnowledge matches title and content via ILIKE", async () => {
    const results = await adapter.searchKnowledge(
      "prediction-market",
      "calibration"
    );
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some((r) => r.id === "test-list-001")).toBe(true);
  });

  it("updateKnowledge modifies fields", async () => {
    const result = await adapter.updateKnowledge("test-add-001", {
      confidencePct: 80,
      title: "Fed rate cut base rate (updated)",
    });
    expect(result.confidencePct).toBe(80);
    expect(result.title).toBe("Fed rate cut base rate (updated)");
  });

  it("deleteKnowledge removes the entry", async () => {
    await adapter.addKnowledge({
      id: "test-del-001",
      domain: "test",
      title: "Delete me",
      content: "Temporary",
      sourceType: "human",
    });
    await adapter.deleteKnowledge("test-del-001");
    const result = await adapter.getKnowledge("test-del-001");
    expect(result).toBeNull();
  });

  // --- Versioning ---

  it("commit creates a Dolt commit and returns hash", async () => {
    const hash = await adapter.commit("test: CRUD operations complete");
    expect(hash).toBeTruthy();
    expect(typeof hash).toBe("string");
    expect(hash.length).toBeGreaterThan(10);
  });

  it("currentCommit returns HEAD hash", async () => {
    const hash = await adapter.currentCommit();
    expect(hash).toBeTruthy();
    expect(typeof hash).toBe("string");
  });

  it("log returns commit history", async () => {
    const commits = await adapter.log(5);
    expect(commits.length).toBeGreaterThanOrEqual(2);
    expect(commits[0]!.message).toBe("test: CRUD operations complete");
    expect(commits[0]!.commitHash).toBeTruthy();
    expect(commits[0]!.committer).toBeTruthy();
  });

  it("diff shows changes between commits", async () => {
    // Make another change + commit
    await adapter.addKnowledge({
      id: "test-diff-001",
      domain: "prediction-market",
      title: "Diff test entry",
      content: "Created for diff test",
      sourceType: "human",
    });
    await adapter.commit("test: add entry for diff");

    const diffs = await adapter.diff("HEAD~1", "HEAD");
    expect(diffs.length).toBeGreaterThanOrEqual(1);
    expect(
      diffs.some((d) => d.diffType === "added" && d.toId === "test-diff-001")
    ).toBe(true);
  });

  // --- Auth roles ---

  it("reader role can SELECT but not INSERT", async () => {
    // Create reader role
    try {
      await rootSql.unsafe("DROP ROLE IF EXISTS test_knowledge_reader");
    } catch {
      /* ignore */
    }
    await rootSql.unsafe(
      "CREATE ROLE test_knowledge_reader WITH LOGIN PASSWORD 'reader'"
    );

    // Grant
    await testSql.unsafe(
      "GRANT USAGE ON SCHEMA public TO test_knowledge_reader"
    );
    await testSql.unsafe(
      "GRANT SELECT ON ALL TABLES IN SCHEMA public TO test_knowledge_reader"
    );

    const readerSql = buildDoltgresClient({
      connectionString: `postgresql://test_knowledge_reader:reader@localhost:5435/${TEST_DB}`,
    });

    // Should read
    const readerAdapter = new DoltgresKnowledgeStoreAdapter({ sql: readerSql });
    const results = await readerAdapter.listKnowledge("prediction-market");
    expect(results.length).toBeGreaterThan(0);

    // Should fail to write
    await expect(
      readerAdapter.addKnowledge({
        id: "hack-001",
        domain: "x",
        title: "x",
        content: "x",
        sourceType: "human",
      })
    ).rejects.toThrow();

    await readerSql.end();

    // Cleanup
    await rootSql.unsafe("DROP ROLE IF EXISTS test_knowledge_reader");
  });
});
