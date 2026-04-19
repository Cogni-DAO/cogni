// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `nodes/resy/drizzle.config`
 * Purpose: Per-node drizzle-kit config for resy — generates/migrates against cogni_resy using core schema only (no resy-local tables yet).
 * Scope: Resy-node drizzle-kit CLI boundary. Does not handle runtime DB I/O.
 * Invariants: Schema glob covers only @cogni/db-schema core tables. Migrations dir is resy-owned. DATABASE_URL must be provided by caller (pnpm db:migrate:resy sets it from DATABASE_URL_RESY).
 * Side-effects: IO (drizzle-kit writes to ./nodes/resy/app/src/adapters/server/db/migrations).
 * Notes: No relative imports — drizzle-kit compiles configs to a temp dir, breaking `./app/...`-style paths. All paths are repo-root-relative (drizzle-kit runs with CWD=repo root).
 * Links: work/items/task.0324.per-node-db-schema-independence.md
 * @internal
 */

import { defineConfig } from "drizzle-kit";

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error(
      "DATABASE_URL is required for drizzle-kit (nodes/resy/drizzle.config.ts). " +
        "Invoke via pnpm db:migrate:resy / db:migrate:resy:container which set it from .env.local / container env.",
    );
  }
  return url;
}

export default defineConfig({
  schema: "./packages/db-schema/src/**/*.ts",
  out: "./nodes/resy/app/src/adapters/server/db/migrations",
  dialect: "postgresql",
  dbCredentials: { url: requireDatabaseUrl() },
  verbose: true,
  strict: true,
});
