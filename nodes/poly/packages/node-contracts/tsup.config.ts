// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/poly-node-contracts/tsup.config`
 * Purpose: Build configuration for poly-node-contracts package.
 * Scope: Build tooling only; no runtime code.
 * Invariants: Output must be ESM with type declarations.
 * Side-effects: IO
 * Links: docs/spec/node-ci-cd-contract.md (node-owned packages)
 * @internal
 */

import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: false,
  clean: false,
  sourcemap: true,
  platform: "neutral",
});
