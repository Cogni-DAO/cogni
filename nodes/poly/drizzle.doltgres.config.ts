// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `nodes/poly/drizzle.doltgres`
 * Purpose: Per-node drizzle-kit config for poly's Doltgres knowledge plane. Schema lives in @cogni/poly-doltgres-schema (workspace package); migrations generated here and applied via drizzle-kit's native migrator inside the poly migrator Docker image.
 * Scope: CLI boundary for both `drizzle-kit generate` (authoring, local) and `drizzle-kit migrate` (application, inside poly-migrate image).
 * Invariants: Schema glob targets ONLY the per-node Doltgres package (nodes/poly/packages/doltgres-schema) — NOT globbed by the Postgres drizzle config, preserving dialect separation. Migrations dir is poly-owned and checked in. DATABASE_URL must be provided by the caller (pnpm db:generate:poly:doltgres / db:migrate:poly:doltgres[:container]).
 * Side-effects: IO (drizzle-kit writes to ./nodes/poly/app/src/adapters/server/db/doltgres-migrations when generating; writes to the Doltgres server when migrating).
 * Notes: No relative TS imports — drizzle-kit compiles configs to a temp dir, breaking `./app/...`-style paths. All paths are repo-root-relative. DATABASE_URL here points at a Doltgres DSN (knowledge_poly), not a Postgres DSN.
 * Links: nodes/poly/packages/doltgres-schema/AGENTS.md, docs/spec/knowledge-data-plane.md, work/items/task.0311.poly-knowledge-syntropy-seed.md
 * @internal
 */

import { defineConfig } from "drizzle-kit";

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error(
      "DATABASE_URL is required for drizzle-kit (nodes/poly/drizzle.doltgres.config.ts). " +
        "Invoke via pnpm db:generate:poly:doltgres / db:migrate:poly:doltgres which set it from .env.local DOLTGRES_URL_POLY.",
    );
  }
  return url;
}

export default defineConfig({
  schema: ["./nodes/poly/packages/doltgres-schema/src/**/*.ts"],
  out: "./nodes/poly/app/src/adapters/server/db/doltgres-migrations",
  dialect: "postgresql",
  dbCredentials: { url: requireDatabaseUrl() },
  verbose: true,
  strict: true,
});
