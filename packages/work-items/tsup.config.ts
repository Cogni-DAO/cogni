// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/work-items/tsup.config`
 * Purpose: Build configuration for work-items package.
 * Scope: Build tooling only. Does not contain runtime code.
 * Invariants: Root entry is platform-neutral (pure types). Adapter entry is platform-node.
 * Side-effects: IO
 * Links: docs/spec/packages-architecture.md
 * @internal
 */

import { defineConfig } from "tsup";

export const tsupConfig = defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["esm"],
    dts: false,
    clean: false,
    sourcemap: true,
    platform: "neutral",
  },
  {
    entry: ["src/adapters/markdown/index.ts"],
    outDir: "dist/adapters/markdown",
    format: ["esm"],
    dts: false,
    clean: false,
    sourcemap: true,
    platform: "node",
  },
]);

export default tsupConfig;
