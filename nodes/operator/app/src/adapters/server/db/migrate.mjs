// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO
//
// biome-ignore-all lint/suspicious/noConsole: standalone Node script invoked as Job CMD; stdout is the only log surface
// biome-ignore-all lint/style/noProcessEnv: container entry point reads DATABASE_URL directly; no env wrapper to hide behind

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const NODE = "operator";

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

let sql;
try {
  sql = postgres(url, { max: 1, onnotice: (n) => console.log(n.message) });
  const t0 = Date.now();
  await migrate(drizzle(sql), { migrationsFolder });
  console.log(`✅ ${NODE} migrations applied in ${Date.now() - t0}ms`);
} catch (err) {
  console.error(`FATAL(${NODE}): migrate failed:`, err);
  process.exitCode = 1;
} finally {
  if (sql) await sql.end({ timeout: 5 });
}
