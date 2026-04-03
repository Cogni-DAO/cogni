// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/knowledge-store/vitest.config`
 * Purpose: Vitest configuration for knowledge-store package tests.
 * Scope: Package-local tests only. Does not import from app src/.
 * Invariants: Tests only import from this package or relative ./src.
 * Side-effects: none
 * Links: vitest.workspace.ts
 * @internal
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineProject } from "vitest/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// biome-ignore lint/style/noDefaultExport: required by vitest
export default defineProject({
  plugins: [
    tsconfigPaths({
      projects: [path.resolve(__dirname, "../../tsconfig.json")],
    }),
  ],
  test: {
    name: "knowledge-store",
    globals: true,
    environment: "node",
    include: ["tests/**/*.{test,spec}.{ts,tsx}"],
    exclude: [
      "node_modules",
      "dist",
      "tests/**/*.stack.*",
      "tests/**/*.integration.*",
    ],
    testTimeout: 15000,
  },
});
