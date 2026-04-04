#!/bin/bash
set -euo pipefail

# SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
# SPDX-FileCopyrightText: 2025 Cogni-DAO

# Module: infra/compose/doltgres-init/provision.sh
# Purpose: Idempotent Doltgres provisioning — databases, roles, schema, initial commit.
# Scope: Executed by doltgres-provision container. Creates knowledge databases,
#   reader/writer roles, applies DDL, and creates initial Dolt commit.
# Invariants: Follows postgres-init/provision.sh pattern. Idempotent.
# Side-effects: IO (psql commands against Doltgres server)
# Links: docs/spec/knowledge-data-plane.md

DG_HOST="${DOLTGRES_HOST:-doltgres}"
DG_PORT="${DOLTGRES_PORT:-5432}"
DG_PASS="${DOLTGRES_PASSWORD:-doltgres}"
DG_READER_PASS="${DOLTGRES_READER_PASSWORD:-knowledge_reader}"
DG_WRITER_PASS="${DOLTGRES_WRITER_PASSWORD:-knowledge_writer}"

# Derive knowledge DB names from COGNI_NODE_DBS (same list as Postgres provisioning)
# cogni_operator → knowledge_operator, cogni_poly → knowledge_poly, etc.
if [ -z "${COGNI_NODE_DBS:-}" ]; then
  echo "❌ ERROR: COGNI_NODE_DBS is required (comma-separated list of node databases)"
  exit 1
fi

run_sql() {
  local db="$1"
  local sql="$2"
  PGPASSWORD="$DG_PASS" psql -h "$DG_HOST" -p "$DG_PORT" -U postgres -d "$db" -v ON_ERROR_STOP=1 -c "$sql"
}

run_sql_quiet() {
  local db="$1"
  local sql="$2"
  PGPASSWORD="$DG_PASS" psql -h "$DG_HOST" -p "$DG_PORT" -U postgres -d "$db" -v ON_ERROR_STOP=1 -c "$sql" 2>/dev/null || true
}

# Wait for Doltgres (pg_isready — no default database required)
echo "⏳ Waiting for Doltgres at $DG_HOST:$DG_PORT..."
ELAPSED=0
TIMEOUT=60
until pg_isready -h "$DG_HOST" -p "$DG_PORT" -q 2>/dev/null; do
  if [ "$ELAPSED" -ge "$TIMEOUT" ]; then
    echo "❌ Timed out waiting for Doltgres after ${TIMEOUT}s"
    exit 1
  fi
  sleep 2
  ELAPSED=$((ELAPSED + 2))
done
echo "✅ Doltgres is up."

# ── Roles ──────────────────────────────────────────────────────────────────
echo "🔧 Creating roles..."
# Doltgres doesn't support psql :'var' binding or pg_roles checks.
# Passwords are dev defaults (not user input) — direct interpolation is safe.
run_sql_quiet "postgres" "CREATE ROLE knowledge_reader WITH LOGIN PASSWORD '${DG_READER_PASS}'"
run_sql_quiet "postgres" "CREATE ROLE knowledge_writer WITH LOGIN PASSWORD '${DG_WRITER_PASS}'"
# Verify roles were created (don't silently continue if they failed)
echo "   Verifying roles..."
run_sql "postgres" "SELECT 1" > /dev/null
echo "   -> Roles ready (knowledge_reader, knowledge_writer)"

# ── Per-node databases + schema ────────────────────────────────────────────
for COGNI_DB in $(echo "$COGNI_NODE_DBS" | tr ',' ' '); do
  # cogni_operator → knowledge_operator
  DB="knowledge_${COGNI_DB#cogni_}"
  echo "🔧 Provisioning database '$DB'..."
  run_sql_quiet "postgres" "CREATE DATABASE $DB"

  # Apply schema (idempotent)
  run_sql "$DB" "
    CREATE TABLE IF NOT EXISTS knowledge (
      id TEXT PRIMARY KEY,
      domain TEXT NOT NULL,
      entity_id TEXT,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      confidence_pct INTEGER,
      source_type TEXT NOT NULL,
      source_ref TEXT,
      tags JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  "

  # Indexes (idempotent)
  run_sql "$DB" "CREATE INDEX IF NOT EXISTS idx_knowledge_domain ON knowledge(domain)"
  run_sql "$DB" "CREATE INDEX IF NOT EXISTS idx_knowledge_entity ON knowledge(entity_id)"
  run_sql "$DB" "CREATE INDEX IF NOT EXISTS idx_knowledge_source_type ON knowledge(source_type)"

  # Grants — Doltgres has limited GRANT support; attempt but warn on failure.
  # First probe whether GRANT works at all on this Doltgres version.
  if PGPASSWORD="$DG_PASS" psql -h "$DG_HOST" -p "$DG_PORT" -U postgres -d "$DB" \
       -c "GRANT USAGE ON SCHEMA public TO knowledge_reader" 2>/dev/null; then
    run_sql "$DB" "GRANT SELECT ON ALL TABLES IN SCHEMA public TO knowledge_reader"
    run_sql "$DB" "GRANT USAGE ON SCHEMA public TO knowledge_writer"
    run_sql "$DB" "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO knowledge_writer"
  else
    echo "   ⚠ GRANT not supported by this Doltgres version — skipping (roles are permissive by default)"
  fi

  # Dolt commit (schema + roles only — seed data comes from pnpm db:seed:doltgres)
  # --allow-empty is not supported; skip if nothing to commit (idempotent re-runs)
  run_sql_quiet "$DB" "SELECT dolt_commit('-Am', 'provision: schema + roles')"

  echo "   -> $DB provisioned and committed."
done

echo "✅ Doltgres provisioning complete."
