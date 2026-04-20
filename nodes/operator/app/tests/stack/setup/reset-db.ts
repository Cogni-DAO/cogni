// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/stack/setup/reset-db`
 * Purpose: Vitest global setup for stack tests to reset test database tables between runs.
 * Scope: Truncates all tables in stack test database, then re-seeds system tenant (required by verifySystemTenant healthcheck + revenue share). Does not handle migrations.
 * Invariants: Only operates on stack test database; preserves schema structure; system tenant re-seeded after truncation.
 * TODO: Consider also wiping Temporal schedules (temporal-postgres) for fully clean state.
 * Side-effects: IO (database truncation)
 * Notes: Assumes app has already run migrations; used by vitest.stack.config.mts as globalSetup.
 * Links: vitest stack config, database schema
 * @internal
 */

import postgres from "postgres";

const RESET_RETRYABLE_CODES = new Set(["40P01", "55P03"]);
const ACTIVE_APP_QUERY_BUDGET_MS = 10_000;
const ACTIVE_APP_QUERY_POLL_MS = 250;
const MAX_TRUNCATE_ATTEMPTS = 5;

type SqlClient = ReturnType<typeof postgres>;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableResetError(error: unknown): error is { code?: string } {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return false;
  }

  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && RESET_RETRYABLE_CODES.has(code);
}

async function waitForAppDatabaseActivityToDrain(sql: SqlClient) {
  const maxAttempts = Math.ceil(
    ACTIVE_APP_QUERY_BUDGET_MS / ACTIVE_APP_QUERY_POLL_MS
  );

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const activeSessions = await sql<
      {
        pid: number;
        application_name: string | null;
        state: string | null;
      }[]
    >`
      SELECT pid, application_name, state
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND pid <> pg_backend_pid()
        AND application_name = 'cogni_template_app'
        AND coalesce(state, 'idle') <> 'idle'
      ORDER BY query_start NULLS LAST
    `;

    if (activeSessions.length === 0) {
      return;
    }

    if (attempt === 1) {
      const sessionSummary = activeSessions
        .map(
          (session) =>
            `${session.application_name ?? "unknown"}:${session.state ?? "unknown"}`
        )
        .join(", ");
      console.log(
        `⏳ Waiting for in-flight app database activity to drain before reset (${sessionSummary})...`
      );
    }

    await sleep(ACTIVE_APP_QUERY_POLL_MS);
  }

  console.warn(
    "⚠️  App database activity did not fully drain before reset; attempting truncate anyway"
  );
}

async function truncateAllTables(sql: SqlClient, tableNames: string) {
  for (let attempt = 1; attempt <= MAX_TRUNCATE_ATTEMPTS; attempt++) {
    await waitForAppDatabaseActivityToDrain(sql);

    try {
      await sql.unsafe(`TRUNCATE TABLE ${tableNames} RESTART IDENTITY CASCADE`);
      return;
    } catch (error) {
      if (!isRetryableResetError(error) || attempt === MAX_TRUNCATE_ATTEMPTS) {
        throw error;
      }

      const backoffMs = attempt * ACTIVE_APP_QUERY_POLL_MS;
      console.warn(
        `⚠️  Retryable reset contention (${error.code}) on attempt ${attempt}/${MAX_TRUNCATE_ATTEMPTS}; retrying in ${backoffMs}ms`
      );
      await sleep(backoffMs);
    }
  }
}

export async function setup() {
  console.log("🧹 Resetting stack test database...");

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for stack test reset");
  }

  // Extract expected database name from URL for safety check
  const parsedUrl = new URL(databaseUrl);
  const expectedDb = parsedUrl.pathname.replace(/^\//, "");

  const sql = postgres(databaseUrl, {
    max: 1, // Use only one connection for setup
    connection: {
      application_name: "vitest_stack_reset",
    },
  });

  try {
    const [connectionInfo] = await sql<
      {
        current_database: string | null;
        server_port: number;
        server_addr: string | null;
      }[]
    >`
      SELECT current_database(), inet_server_port() AS server_port, inet_server_addr()::text AS server_addr
    `;

    if (!connectionInfo?.current_database) {
      throw new Error("Failed to determine connected database name");
    }

    // SAFETY: Never allow reset on dev/prod databases, even if env matches
    const UNSAFE_DBS = ["cogni_template_dev", "cogni_template_prod"];
    if (UNSAFE_DBS.includes(connectionInfo.current_database)) {
      throw new Error(
        `❌ SAFETY VIOLATION: Attempted to reset unsafe database "${connectionInfo.current_database}".\n` +
          `   This script is only for test databases (e.g. cogni_template_stack_test).`
      );
    }

    if (expectedDb && connectionInfo.current_database !== expectedDb) {
      throw new Error(
        `Connected to unexpected database: ${connectionInfo.current_database} (expected ${expectedDb})`
      );
    }

    // Port check removed: Docker port mapping (external 55432 vs internal 5432) causes false positives.
    // We rely on the database name check above for safety.

    console.log(
      `🔌 Connected to ${connectionInfo.current_database} @ ${connectionInfo.server_addr ?? "unknown"}:${connectionInfo.server_port}`
    );

    // Dynamically discover all user tables (exclude postgres system tables)
    const tables = await sql<{ tablename: string }[]>`
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = 'public'
    `;

    if (tables.length === 0) {
      console.log("⚠️  No tables found in public schema - skipping truncate");
      return () => Promise.resolve();
    }

    // Build TRUNCATE statement with all discovered tables
    // Quote each table name to handle mixed-case PostgreSQL identifiers (e.g., LiteLLM_AuditLog)
    const tableNames = tables.map((t) => `"${t.tablename}"`).join(", ");

    // TRUNCATE with CASCADE handles foreign key constraints automatically
    await truncateAllTables(sql, tableNames);

    // Re-seed system tenant data (wiped by truncation, required by verifySystemTenant healthcheck + revenue share).
    // Mirrors 0008_seed_system_tenant.sql. Wrapped in a transaction so set_config (transaction-local) persists
    // across all inserts — required because we connect as app_user (RLS enforced).
    await sql.begin(async (tx) => {
      await tx`SELECT set_config('app.current_user_id', '00000000-0000-4000-a000-000000000001', true)`;
      await tx`
        INSERT INTO "users" ("id", "wallet_address")
        VALUES ('00000000-0000-4000-a000-000000000001', NULL)
        ON CONFLICT ("id") DO NOTHING
      `;
      await tx`
        INSERT INTO "billing_accounts" ("id", "owner_user_id", "is_system_tenant", "slug", "balance_credits", "created_at")
        VALUES ('00000000-0000-4000-b000-000000000000', '00000000-0000-4000-a000-000000000001', true, 'cogni_system', 0, now())
        ON CONFLICT ("id") DO NOTHING
      `;
      await tx`
        INSERT INTO "virtual_keys" ("billing_account_id", "label", "is_default", "active")
        VALUES ('00000000-0000-4000-b000-000000000000', 'System Default', true, true)
        ON CONFLICT DO NOTHING
      `;
    });

    console.log(
      `✅ Stack test database reset complete (${tables.length} tables truncated, system tenant re-seeded)`
    );
  } catch (error) {
    console.error("❌ Failed to reset stack test database:", error);
    throw error;
  } finally {
    // Always close the connection to prevent leaks
    await sql.end();
  }

  // No teardown needed for stack tests
  return () => Promise.resolve();
}
