// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `nodes/poly/drizzle.config`
 * Purpose: Per-node drizzle-kit config for poly — generates/migrates against cogni_poly using core schema + poly-local copy-trade tables.
 * Scope: Poly-node drizzle-kit CLI boundary. Does not handle runtime DB I/O.
 * Invariants: Schema array includes @cogni/db-schema core AND nodes/poly/app/src/shared/db/copy-trade.ts. Migrations dir is poly-owned. DATABASE_URL must be provided by caller (pnpm db:migrate:poly sets it from DATABASE_URL_POLY).
 * Side-effects: IO (drizzle-kit writes to ./nodes/poly/app/src/adapters/server/db/migrations).
 * Notes: No relative imports — drizzle-kit compiles configs to a temp dir, breaking `./app/...`-style paths. All paths are repo-root-relative (drizzle-kit runs with CWD=repo root).
 * Links: work/items/task.0324.per-node-db-schema-independence.md
 * @internal
 */

import { defineConfig } from "drizzle-kit";

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error(
      "DATABASE_URL is required for drizzle-kit (nodes/poly/drizzle.config.ts). " +
        "Invoke via pnpm db:migrate:poly / db:migrate:poly:container which set it from .env.local / container env.",
    );
  }
  return url;
}

export default defineConfig({
  schema: [
    "./packages/db-schema/src/**/*.ts",
    "./nodes/poly/packages/db-schema/src/**/*.ts",
  ],
  out: "./nodes/poly/app/src/adapters/server/db/migrations",
  dialect: "postgresql",
  dbCredentials: { url: requireDatabaseUrl() },
  verbose: true,
  strict: true,
});
