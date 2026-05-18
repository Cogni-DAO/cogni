// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/knowledge-base/tsup.config`
 * Purpose: Build configuration for the shared base knowledge schema package.
 * Scope: Build tooling only; does not contain runtime code.
 * Invariants: Output is ESM. Mirrors `@cogni/knowledge-store` shape — single entry point, no declarations from tsup (tsc -b emits them).
 * Side-effects: IO
 * Links: docs/spec/knowledge-data-plane.md, docs/spec/knowledge-syntropy.md
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
  external: ["drizzle-orm", "@cogni/knowledge-store"],
});

// biome-ignore lint/style/noDefaultExport: required by tsup
export default tsupConfig;
