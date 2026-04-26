// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/poly-graphs/vitest.config`
 * Purpose: Vitest configuration for poly-graphs package tests (task.0386).
 * Scope: Package-local tests only; does not import app src/.
 * Invariants:
 *   - No LLM invocation in unit tests
 *   - No network I/O
 * Side-effects: none
 * Links: tests/
 * @internal
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineProject } from "vitest/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineProject({
  plugins: [
    tsconfigPaths({
      projects: [path.resolve(__dirname, "../../../tsconfig.json")],
    }),
  ],
  test: {
    name: "poly-graphs",
    globals: true,
    environment: "node",
    include: ["tests/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["node_modules", "dist"],
    testTimeout: 10_000,
  },
});
