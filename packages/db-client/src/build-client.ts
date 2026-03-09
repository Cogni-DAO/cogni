// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/db-client/build-client`
 * Purpose: Shared Drizzle client constructor used by both app and service factories.
 * Scope: Internal — not exported from any package entrypoint. Does not handle env resolution.
 * Invariants:
 *   - Connection string injected, never from process.env
 *   - Database type preserves drizzle's `$client` accessor for pool control (e.g. `reserve()`)
 * Side-effects: IO (database connections)
 * Links: docs/spec/database-rls.md
 * @internal
 */

import * as fullSchema from "@cogni/db-schema";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

export function buildClient(connectionString: string, applicationName: string) {
  const client = postgres(connectionString, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
    connection: {
      application_name: applicationName,
    },
  });

  return drizzle(client, { schema: fullSchema });
}

/** Drizzle client including the postgres.js `$client` accessor for pool control. */
export type Database = ReturnType<typeof buildClient>;
