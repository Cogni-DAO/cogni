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
  return /already exists/i.test(`${msg} ${cause}`);
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
  await withConnection(
    (sql) => sql`SELECT dolt_commit('-Am', 'migration: drizzle-orm batch')`
  );
  console.log(
    `✅ ${NODE} migrations ${migrateThrewAlreadyApplied ? "already-applied" : "applied"} + ${stampedRows} tracking row(s) reconciled + dolt_commit stamped in ${Date.now() - t0}ms`
  );
} catch (err) {
  console.error(`FATAL(${NODE}): migrate failed:`, err);
  process.exitCode = 1;
}
