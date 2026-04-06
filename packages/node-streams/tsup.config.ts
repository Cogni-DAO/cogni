// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/node-streams/tsup.config`
 * Purpose: Build configuration for the node-streams package.
 * Scope: ESM output with ioredis externalized. Does not produce declarations (tsc handles those).
 * Invariants:
 *   - IOREDIS_EXTERNAL: ioredis is never bundled — provided by consuming app
 * Side-effects: none
 * Links: package.json, tsconfig.json
 * @internal
 */

import { defineConfig } from "tsup";

export const tsupConfig = defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: false,
  clean: false,
  sourcemap: true,
  platform: "node",
  external: ["ioredis"],
});

// biome-ignore lint/style/noDefaultExport: tsup requires default export
export default tsupConfig;
