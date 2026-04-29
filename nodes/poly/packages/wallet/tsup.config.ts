// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/poly-wallet/tsup.config`
 * Purpose: Build configuration for poly-wallet package.
 * Scope: Build tooling configuration only. Does not contain runtime code or exports.
 * Invariants: ESM output with type declarations.
 * Side-effects: IO
 * Links: docs/spec/poly-trader-wallet-port.md
 * @internal
 */

import { defineConfig } from "tsup";

export const tsupConfig = defineConfig({
  entry: ["src/index.ts", "src/port/index.ts", "src/adapters/privy/index.ts"],
  format: ["esm"],
  dts: false,
  clean: false,
  sourcemap: true,
  platform: "neutral",
});

export default tsupConfig;
