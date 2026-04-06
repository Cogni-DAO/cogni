// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/market-provider/tsup.config`
 * Purpose: tsup build configuration — defines entry points, output format, and sourcemap settings.
 * Scope: Build tooling only; does not contain runtime code.
 * Invariants: Output must be ESM with type declarations.
 * Side-effects: IO
 * Links: work/items/task.0230.market-data-package.md
 * @internal
 */

import { defineConfig } from "tsup";

export const tsupConfig = defineConfig({
  entry: [
    "src/index.ts",
    "src/adapters/polymarket/index.ts",
    "src/adapters/kalshi/index.ts",
  ],
  format: ["esm"],
  dts: false, // tsc -b emits per-file declarations; tsup handles JS only
  clean: false, // preserve .d.ts files from tsc -b (incremental builds)
  sourcemap: true,
  platform: "neutral",
});

// biome-ignore lint/style/noDefaultExport: required by tsup
export default tsupConfig;
