// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO
//
// biome-ignore-all lint/suspicious/noConsole: standalone Node script invoked as Job CMD; stdout is the only log surface
// biome-ignore-all lint/style/noProcessEnv: container entry point reads DATABASE_URL directly; no env wrapper to hide behind

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const NODE = "resy";

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

// Postgres advisory lock — single-writer guard so concurrent initContainers
// (replicas > 1, HPA scale-out, rolling-update overlap) don't race the same
// migration. Blocking acquire: peer waits, then drizzle's journal makes the
// inner migrate() a no-op when the schema is already current. Lock auto-
// releases on session end; explicit unlock in finally for clarity.
const LOCK_KEY = 0x436f676e6901n;

let sql;
try {
  sql = postgres(url, { max: 1, onnotice: (n) => console.log(n.message) });
  const t0 = Date.now();
  await sql`SELECT pg_advisory_lock(${LOCK_KEY})`;
  try {
    await migrate(drizzle(sql), { migrationsFolder });
    console.log(`✅ ${NODE} migrations applied in ${Date.now() - t0}ms`);
  } finally {
    await sql`SELECT pg_advisory_unlock(${LOCK_KEY})`;
  }
} catch (err) {
  console.error(`FATAL(${NODE}): migrate failed:`, err);
  process.exitCode = 1;
} finally {
  if (sql) await sql.end({ timeout: 5 });
}
