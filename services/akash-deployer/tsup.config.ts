// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/akash-deployer-service/tsup.config`
 * Purpose: tsup build configuration for the akash-deployer service.
 * Scope: Build configuration only. Does NOT contain runtime code.
 * Invariants: none
 * Side-effects: none
 * Links: docs/spec/akash-deploy-service.md
 * @internal
 */

import { defineConfig } from "tsup";

export const tsupConfig = defineConfig({
  entry: ["src/main.ts"],
  format: ["esm"],
  dts: false,
  clean: false,
  sourcemap: true,
  platform: "node",
  target: "node22",
});

// biome-ignore lint/style/noDefaultExport: tsup requires default export
export default tsupConfig;
