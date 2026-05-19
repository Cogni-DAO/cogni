// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO
//
// Operator Doltgres migrator: drizzle-orm/postgres-js/migrator against
// `knowledge_operator`. Three surgical deltas from scripts/db/migrate.mjs,
// each driven by an upstream Doltgres 0.56 gap that has no Postgres analogue:
//
//   1. Recovery shim for the parameterized-INSERT gap on
//      `drizzle.__drizzle_migrations`. Drizzle's tracking-row INSERT uses
//      extended protocol; Doltgres 0.56 rejects it with XX000. We catch
//      "already exists" / "duplicate key" and reconcile via sql.unsafe
//      (simple protocol) — but ONLY after schema verification proves the
//      expected end-state is actually present.
//
//   2. Post-migrate schema verification against the latest snapshot. drizzle-
//      orm's runtime migrator decides "applied?" by `lastDbMigration.created_at
//      < migration.folderMillis` — it NEVER checks file hash. So a migration
//      modified after deploy silently no-ops. Verification closes that gap:
//      if the live shape doesn't match the snapshot, we throw before anything
//      stamps as applied. Paired with scripts/db/check-migrations-immutable.mjs
//      (CI guard) to make the failure mode unreachable, not just diagnosable.
//
//   3. Trailing `dolt_commit` so DDL lands in `dolt_log` — Dolt DDL doesn't
//      auto-commit per dolt#4843. Postgres has no equivalent step.
//
// BASE_DOMAIN_SEEDS run via sql.unsafe (idempotent SELECT-then-INSERT) rather
// than riding a drizzle-kit migration: drizzle-orm wraps migrations in a
// transaction, and the parameterized INSERT into __drizzle_migrations rolls
// back the whole tx on Doltgres 0.56 — taking seed rows with it (CREATE TABLE
// auto-commits past rollback, DML doesn't).
//
// biome-ignore-all lint/suspicious/noConsole: standalone Node script invoked as initContainer CMD; stdout is the only log surface
// biome-ignore-all lint/style/noProcessEnv: container entry point reads DATABASE_URL directly; no env wrapper to hide behind

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { verifyDoltgresSchema } from "./verify-doltgres-schema.mjs";

const NODE = "operator-doltgres";

const url = process.env.DATABASE_URL?.trim();
if (!url) {
  console.error(`FATAL(${NODE}): DATABASE_URL is required`);
  process.exit(2);
}

const migrationsFolder = process.argv[2];
if (!migrationsFolder) {
  console.error(`FATAL(${NODE}): argv[2] migrations dir is required`);
  process.exit(2);
}

function hashOfMigration(sqlText) {
  return createHash("sha256").update(sqlText).digest("hex");
}

function isAlreadyAppliedError(err) {
  const msg = err instanceof Error ? err.message : String(err);
  const cause = err?.cause instanceof Error ? err.cause.message : "";
  const combined = `${msg} ${cause}`;
  return (
    /already exists/i.test(combined) || /duplicate key value/i.test(combined)
  );
}

// Operator-scoped base domains. Per-node concerns (prediction-market,
// reservations) live in the respective node's own Doltgres DB. `validate_candidate`
// was dropped: validation writes should target `meta` instead of carving out
// a test-only domain.
const BASE_DOMAIN_SEEDS = [
  {
    id: "meta",
    name: "Meta",
    description: "Knowledge about the knowledge system itself.",
  },
  {
    id: "nodes",
    name: "Nodes",
    description:
      "Registry / lifecycle facts about other nodes in the Cogni network — formation, contracts, status.",
  },
  {
    id: "infrastructure",
    name: "Infrastructure",
    description:
      "Runtime, deploy, observability, and capacity knowledge for Cogni nodes.",
  },
  {
    id: "governance",
    name: "Governance",
    description:
      "DAO formation, attribution, voting, and operator/node contracts.",
  },
];

async function seedBaseDomains(sql) {
  const sqlEscape = (v) => `'${String(v).replace(/'/g, "''")}'`;
  const existing = await sql.unsafe(`SELECT id FROM domains`);
  const have = new Set(existing.map((r) => r.id));
  let inserted = 0;
  for (const s of BASE_DOMAIN_SEEDS) {
    if (have.has(s.id)) continue;
    await sql.unsafe(
      `INSERT INTO domains (id, name, description) VALUES (${sqlEscape(s.id)}, ${sqlEscape(s.name)}, ${sqlEscape(s.description)})`
    );
    inserted += 1;
  }
  return inserted;
}

async function reconcileTracking(sql, folder) {
  const journal = JSON.parse(
    await readFile(path.join(folder, "meta", "_journal.json"), "utf8")
  );
  const sqlEscape = (v) => `'${String(v).replace(/'/g, "''")}'`;

  await sql.unsafe(`CREATE SCHEMA IF NOT EXISTS drizzle`);
  await sql.unsafe(
    `CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)`
  );

  let stamped = 0;
  for (const entry of journal.entries ?? []) {
    const sqlPath = path.join(folder, `${entry.tag}.sql`);
    const sqlText = await readFile(sqlPath, "utf8");
    const hash = hashOfMigration(sqlText);
    const existing = await sql.unsafe(
      `SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = ${sqlEscape(hash)} LIMIT 1`
    );
    if (existing.length === 0) {
      await sql.unsafe(
        `INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES (${sqlEscape(hash)}, ${Number(entry.when)})`
      );
      stamped += 1;
    }
  }
  return stamped;
}

async function withConnection(fn) {
  const sql = postgres(url, {
    max: 1,
    onnotice: (n) => console.log(n.message),
  });
  try {
    return await fn(sql);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

try {
  const t0 = Date.now();
  let migrateThrewAlreadyApplied = false;
  try {
    await withConnection((sql) => migrate(drizzle(sql), { migrationsFolder }));
  } catch (err) {
    if (!isAlreadyAppliedError(err)) throw err;
    migrateThrewAlreadyApplied = true;
    console.warn(
      `⚠️  ${NODE} drizzle-migrate hit "already exists" — schema in place; will verify before reconciling`
    );
  }

  // VERIFICATION GATE — must pass before any tracking-row stamping or seed write.
  // If the live shape doesn't match the latest snapshot, throw; do NOT pretend
  // the schema is applied just because the SQL files happen to live on disk.
  const verifyResult = await withConnection((sql) =>
    verifyDoltgresSchema(sql, migrationsFolder)
  );
  console.log(
    `✓ ${NODE} schema verified against snapshot ${verifyResult.latestTag} (${verifyResult.tablesChecked} table(s))`
  );

  const stampedRows = await withConnection((sql) =>
    reconcileTracking(sql, migrationsFolder)
  );
  const seededDomains = await withConnection((sql) => seedBaseDomains(sql));
  await withConnection(
    (sql) =>
      sql`SELECT dolt_commit('-Am', 'migration: drizzle-orm batch + base domain seeds')`
  );
  console.log(
    `✅ ${NODE} migrations ${migrateThrewAlreadyApplied ? "already-applied" : "applied"} + verified + ${stampedRows} tracking row(s) reconciled + ${seededDomains} base domain(s) seeded + dolt_commit stamped in ${Date.now() - t0}ms`
  );
} catch (err) {
  console.error(`FATAL(${NODE}): migrate failed:`, err);
  process.exitCode = 1;
}
