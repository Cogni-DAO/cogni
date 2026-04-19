// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@shared/db/schema`
 * Purpose: Poly's runtime schema barrel — re-exports shared core tables from @cogni/db-schema plus poly-local copy-trade tables.
 * Scope: Re-exports only. Core tables live in packages/db-schema; poly-local tables live in ./copy-trade.ts (task.0324).
 * Invariants: This file must not define any tables. Core re-exports stay pinned to @cogni/db-schema/<slice>. Poly-local tables are relative imports from sibling files under this directory.
 * Side-effects: none
 * Links: docs/spec/packages-architecture.md, docs/spec/databases.md §2, work/items/task.0324.per-node-db-schema-independence.md
 * @public
 */

// Core platform tables — shared via @cogni/db-schema subpath exports
export * from "@cogni/db-schema/ai";
export * from "@cogni/db-schema/ai-threads";
export * from "@cogni/db-schema/attribution";
export * from "@cogni/db-schema/auth";
export * from "@cogni/db-schema/billing";
export * from "@cogni/db-schema/identity";
export * from "@cogni/db-schema/profile";
export * from "@cogni/db-schema/refs";
export * from "@cogni/db-schema/scheduling";
// Poly-local tables — own workspace package so scheduler-worker / Temporal
// worker / other services can import without reaching into app internals.
export * from "@cogni/poly-db-schema";
