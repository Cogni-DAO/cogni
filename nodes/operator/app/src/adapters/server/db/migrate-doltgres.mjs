// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO
//
// Operator Doltgres migrator: drizzle-orm/postgres-js/migrator against
// `knowledge_operator`, plus a Doltgres-specific recovery path for the
// parameterized-INSERT gap on `drizzle.__drizzle_migrations` and the
// trailing dolt_commit so DDL lands in dolt_log (Dolt DDL doesn't
// auto-commit per dolt#4843).
//
// Why the recovery path: against `knowledge_operator` on Doltgres 0.56,
// drizzle-kit's `INSERT INTO drizzle.__drizzle_migrations VALUES ($1, $2)`
// raises XX000 ("table with name work_items already exists" surfaces on the
// next restart) — the parameterized INSERT is rejected even though plain
// CREATE TABLE succeeds. Empirical: poly's tracking row exists from an
// earlier Doltgres point release, so the gap is real today.
//
// Recovery: catch "already exists", then INSERT the journal-derived hash via
// sql.unsafe (simple protocol, bypasses the gap) so future runs see the
// migration as applied and skip cleanly. Hash uses sha256 of raw .sql text
// to match the same algorithm drizzle-orm uses for migration tracking.
//
// 1% delta from scripts/db/migrate.mjs by intent: postgres path needs no
// recovery shim; doltgres does. Removable when Doltgres closes the gap or
// when we adopt a doltgres-native migrator.
//
// biome-ignore-all lint/suspicious/noConsole: standalone Node script invoked as initContainer CMD; stdout is the only log surface
// biome-ignore-all lint/style/noProcessEnv: container entry point reads DATABASE_URL directly; no env wrapper to hide behind

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

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
  // "already exists" — DDL collision when a schema migration replays.
  // "duplicate key value" — DML collision when a data-only migration replays
  //   (e.g. INSERT INTO domains with PK conflict on second run after the
  //   first run's drizzle-tracking INSERT was rejected by Doltgres's
  //   extended-protocol gap). Same signal: migration body already applied;
  //   reconcile tracking via sql.unsafe.
  return (
    /already exists/i.test(combined) || /duplicate key value/i.test(combined)
  );
}

// Base domains seeded as reference data (DOMAIN_REGISTRY_EXTENDS_VIA_UI per
// docs/spec/knowledge-domain-registry.md). Cannot ride a drizzle-kit migration
// SQL file: drizzle-orm wraps migrations in a transaction and the parameterized
// INSERT into drizzle.__drizzle_migrations rolls back the whole tx on Doltgres
// 0.56, taking the seed rows with it (CREATE TABLE auto-commits past rollback,
// data DML doesn't). Sidestep via sql.unsafe with idempotent SELECT-then-INSERT,
// same pattern the reconcileTracking shim uses.
const BASE_DOMAIN_SEEDS = [
  { id: "meta", name: "Meta", description: "Knowledge about the knowledge system itself." },
  { id: "prediction-market", name: "Prediction Markets", description: "Polymarket and adjacent prediction-market knowledge — base rates, market structure, calibration." },
  { id: "infrastructure", name: "Infrastructure", description: "Runtime, deploy, observability, and capacity knowledge for Cogni nodes." },
  { id: "governance", name: "Governance", description: "DAO formation, attribution, voting, and operator/node contracts." },
  { id: "reservations", name: "Reservations", description: "Restaurant / venue reservation knowledge for the resy node domain." },
  { id: "validate_candidate", name: "Validate Candidate", description: "Reserved for /validate-candidate smoke writes. Test surface, not real content." },
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
      `⚠️  ${NODE} drizzle-migrate hit "already exists" — schema in place; reconciling __drizzle_migrations via sql.unsafe`
    );
  }
  const stampedRows = await withConnection((sql) =>
    reconcileTracking(sql, migrationsFolder)
  );
  const seededDomains = await withConnection((sql) => seedBaseDomains(sql));
  await withConnection(
    (sql) => sql`SELECT dolt_commit('-Am', 'migration: drizzle-orm batch + base domain seeds')`
  );
  console.log(
    `✅ ${NODE} migrations ${migrateThrewAlreadyApplied ? "already-applied" : "applied"} + ${stampedRows} tracking row(s) reconciled + ${seededDomains} base domain(s) seeded + dolt_commit stamped in ${Date.now() - t0}ms`
  );
} catch (err) {
  console.error(`FATAL(${NODE}): migrate failed:`, err);
  process.exitCode = 1;
}
