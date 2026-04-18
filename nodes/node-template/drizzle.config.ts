// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `nodes/node-template/drizzle.config`
 * Purpose: Per-node drizzle-kit config for the node-template scaffold — core schema only.
 * Scope: Drizzle-kit CLI boundary. Forks duplicate this config when copying nodes/node-template to nodes/<fork>.
 * Invariants: Core schema only — node-local tables are added post-fork via a schema array extension.
 * Side-effects: IO (drizzle-kit writes to ./app/src/adapters/server/db/migrations relative to this file).
 * Notes: node-template is not deployed; this file exists so the fork workflow has a working template.
 * Links: work/items/task.0324.per-node-db-schema-independence.md
 * @internal
 */

import { defineConfig } from "drizzle-kit";

import { buildDatabaseUrl, type DbEnvInput } from "./app/src/shared/db/db-url";

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
  schema: "./packages/db-schema/src/**/*.ts",
  out: "./nodes/node-template/app/src/adapters/server/db/migrations",
  dialect: "postgresql",
  dbCredentials: { url: getDatabaseUrl() },
  verbose: true,
  strict: true,
});
