// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/poly-doltgres-schema`
 * Purpose: Root barrel for poly's node-local Drizzle schema targeting the Doltgres knowledge plane. Re-exports every slice under this package.
 * Scope: Re-exports only. Does not define any tables.
 * Invariants: Re-exports every schema slice so cross-process consumers (scheduler-worker, Temporal worker, @cogni/poly-graphs) can import from one place without reaching into app/src/.
 * Side-effects: none
 * Links: docs/spec/knowledge-data-plane.md, docs/spec/packages-architecture.md, work/items/task.0311.poly-knowledge-syntropy-seed.md
 * @public
 */

export * from "./knowledge";
