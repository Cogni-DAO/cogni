// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/poly-knowledge/seeds/poly`
 * Purpose: Poly-specific knowledge seeds. Intentionally empty — nodes boot
 *   clean, and the brain accumulates knowledge itself via its research +
 *   observation + promotion loop. The only "starter state" a node ships with
 *   is the schema created by the drizzle-kit migration (the `knowledge` table
 *   exists, but has zero rows).
 * Scope: Seed data definitions only. No I/O — scripts/db/seed-doltgres.mts
 *   applies these when a contributor explicitly invokes `pnpm db:seed:doltgres:poly`
 *   locally (e.g., for manual dev exploration). No deploy-time seeding.
 * Side-effects: none
 * @public
 */

import type { NewKnowledge } from "@cogni/knowledge-store";

/** Base seeds inherited from node-template (owned by that package, not this one). */
export { BASE_KNOWLEDGE_SEEDS } from "@cogni/node-template-knowledge";

/**
 * Poly-specific seeds — intentionally empty (clean-slate by design).
 *
 * Why no seeds:
 * - A knowledge store seeded with AI-authored strategy prose pollutes retrieval
 *   (every search returns plausible-sounding noise the brain cites as
 *   authoritative). The brain must accumulate knowledge itself.
 * - Protocol facts considered earlier (CLOB mechanics, Kelly formula reference)
 *   are reference data that the brain can fetch on-demand via tools; baking
 *   them into the store as rows just creates a stale-cache problem.
 * - "Node boots clean" matches the Postgres-side pattern: fresh nodes get the
 *   schema and the system-tenant migration, not curated content.
 *
 * When to add rows here: only if there's a concrete runtime need (e.g., the
 * brain cannot function without a specific curated row and on-demand fetch is
 * not viable). Such additions should be reviewed against the pollution risk.
 */
export const POLY_KNOWLEDGE_SEEDS: NewKnowledge[] = [];
