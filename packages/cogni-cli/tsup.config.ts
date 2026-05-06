// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/cli/tsup.config`
 * Purpose: Build configuration for the cogni CLI.
 * Scope: Build tooling only. Does not contain runtime code.
 * Invariants: cli.js must include a Node shebang so the bin entry is directly executable.
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
    platform: "node",
    target: "node22",
  },
  {
    entry: { cli: "src/cli.ts" },
    format: ["esm"],
    dts: false,
    clean: false,
    sourcemap: true,
    platform: "node",
    target: "node22",
    banner: { js: "#!/usr/bin/env node" },
  },
]);

export default tsupConfig;
