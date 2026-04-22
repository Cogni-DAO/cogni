// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/poly-db-schema`
 * Purpose: Root barrel for poly's node-local Drizzle table definitions. Re-exports every slice under this package.
 * Scope: Re-exports only. Does not define any tables.
 * Invariants: Re-exports every schema slice so the resulting namespace matches nodes/poly/app/src/shared/db/schema.ts's expectation when it `export * from "@cogni/poly-db-schema"`.
 * Side-effects: none
 * Links: docs/spec/databases.md, docs/spec/packages-architecture.md, work/items/task.0324.per-node-db-schema-independence.md
 * @public
 */

export * from "./copy-trade";
export * from "./wallet-connections";
export * from "./wallet-grants";
