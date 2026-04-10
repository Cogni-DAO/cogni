// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `vitest.config.mts`
 * Purpose: Vitest configuration for auth hub unit tests.
 * Scope: Tests under nodes/auth/app/tests that validate auth hub wiring and helpers.
 * Invariants: Node environment only; no browser setup; paths resolved from auth app root.
 * Side-effects: none
 * @public
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: __dirname,
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["node_modules", "dist", ".next"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
