// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `drizzle.config`
 * Purpose: Root drizzle-kit config. Aliases operator's per-node config so legacy scripts
 *          (`pnpm db:generate`, `pnpm db:migrate:dev`) keep working without --config flags.
 * Scope: CLI boundary. Does not handle runtime DB I/O.
 * Invariants: This file must remain a re-export of drizzle.operator.config.ts. Per-node
 *             work uses drizzle.<node>.config.ts explicitly.
 * Side-effects: IO (filesystem via drizzle-kit)
 * Notes: task.0322 split the root config into per-node configs (operator/poly/resy). This
 *        alias exists for backward compatibility with scripts and tooling (check-root-layout,
 *        biome ignore lists, knip ignore lists). Callers that want explicit per-node behavior
 *        should invoke drizzle-kit with `--config=drizzle.<node>.config.ts`.
 * Links: work/items/task.0322.per-node-db-schema-independence.md
 * @public
 */

export { default } from "./drizzle.operator.config";
