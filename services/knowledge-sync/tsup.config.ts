// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/knowledge-sync-service/tsup.config`
 * Purpose: Build configuration for knowledge-sync service.
 * Scope: tsup transpile-only settings (Model B). Does not contain runtime code.
 * Invariants: ESM format only, bundle:false (node_modules copied to Docker image).
 * Side-effects: none
 * Links: services/knowledge-sync/Dockerfile, docs/guides/create-service.md
 * @internal
 */

import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/**/*.ts"], // Transpile all source files
  format: ["esm"],
  bundle: false, // Model B: transpile-only, node_modules copied to Docker image
  splitting: false,
  dts: false,
  clean: true,
  sourcemap: true,
  platform: "node",
  target: "node22",
});
