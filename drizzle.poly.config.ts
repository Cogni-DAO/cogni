// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `drizzle.poly.config`
 * Purpose: Per-node drizzle-kit config for poly — generates/migrates against cogni_poly using core schema + poly-local copy-trade tables.
 * Scope: Poly-node drizzle-kit CLI boundary. Does not handle runtime DB I/O.
 * Invariants: Schema array includes @cogni/db-schema core TS files AND nodes/poly/app/src/shared/db/copy-trade.ts. Migrations dir is poly-owned.
 * Side-effects: IO (filesystem reads; drizzle-kit writes to ./nodes/poly/app/src/adapters/server/db/migrations)
 * Notes: Created by task.0322 — per-node DB schema independence. DATABASE_URL is pinned by the calling script (db:migrate:poly sets it from DATABASE_URL_POLY in .env.local).
 * Links: work/items/task.0322.per-node-db-schema-independence.md
 * @internal
 */

import { defineConfig } from "drizzle-kit";

import {
  buildDatabaseUrl,
  type DbEnvInput,
} from "./nodes/poly/app/src/shared/db/db-url";

function getDatabaseUrl(): string {
  const direct = process.env.DATABASE_URL?.trim();
  if (direct) {
    try {
      new URL(direct);
      return direct;
    } catch {
      // fall back
    }
  }
  return buildDatabaseUrl(process.env as DbEnvInput);
}

export default defineConfig({
  schema: [
    "./packages/db-schema/src/**/*.ts",
    "./nodes/poly/app/src/shared/db/copy-trade.ts",
  ],
  out: "./nodes/poly/app/src/adapters/server/db/migrations",
  dialect: "postgresql",
  dbCredentials: { url: getDatabaseUrl() },
  verbose: true,
  strict: true,
});
