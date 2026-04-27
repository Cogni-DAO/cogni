// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/poly-db-schema/tsup.config`
 * Purpose: Build configuration for @cogni/poly-db-schema — separate entry points per table slice (mirrors @cogni/db-schema shape).
 * Scope: Build tooling only; does not contain runtime code.
 * Invariants: Output is ESM. Each slice in src/ has its own entry point so downstream importers can tree-shake via subpath imports.
 * Side-effects: IO
 * Links: docs/spec/packages-architecture.md, work/items/task.0324.per-node-db-schema-independence.md
 * @internal
 */

import { defineConfig } from "tsup";

export const tsupConfig = defineConfig({
  entry: [
    "src/index.ts",
    "src/copy-trade.ts",
    "src/poly-redeem-jobs.ts",
    "src/wallet-connections.ts",
    "src/wallet-grants.ts",
  ],
  format: ["esm"],
  dts: false, // tsc -b emits per-file declarations; tsup handles JS only
  clean: false,
  sourcemap: true,
  platform: "node",
  external: ["drizzle-orm"],
});

// biome-ignore lint/style/noDefaultExport: required by tsup
export default tsupConfig;
