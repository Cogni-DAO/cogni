// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/contributor-cli/tsup.config`
 * Purpose: Build configuration for contributor CLI package.
 * Scope: Build tooling only; does not contain runtime code.
 * Invariants: Output must be ESM with shebang banner for CLI usage.
 * Side-effects: IO
 * Links: docs/spec/packages-architecture.md
 * @internal
 */

import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: false,
  clean: false,
  sourcemap: true,
  platform: "node",
  banner: { js: "#!/usr/bin/env node" },
});
