// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/poly-doltgres-schema/tsup.config`
 * Purpose: Build configuration for @cogni/poly-doltgres-schema — poly's node-local Drizzle schema for the Doltgres knowledge plane.
 * Scope: Build tooling only; does not contain runtime code.
 * Invariants: Output is ESM. Mirrors @cogni/poly-db-schema shape — per-slice entry points so downstream importers can tree-shake via subpath imports.
 * Side-effects: IO
 * Links: docs/spec/packages-architecture.md, work/items/task.0311.poly-knowledge-syntropy-seed.md
 * @internal
 */

import { defineConfig } from "tsup";

export const tsupConfig = defineConfig({
  entry: ["src/index.ts", "src/knowledge.ts"],
  format: ["esm"],
  dts: false,
  clean: false,
  sourcemap: true,
  platform: "node",
  external: ["drizzle-orm", "@cogni/node-template-knowledge"],
});

// biome-ignore lint/style/noDefaultExport: required by tsup
export default tsupConfig;
