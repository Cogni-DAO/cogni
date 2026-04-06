// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/node-streams/vitest.config`
 * Purpose: Vitest configuration for node-streams package tests.
 * Scope: Package-local tests only; does not import from app src/.
 * Invariants:
 *   - Tests only import from this package (@cogni/node-streams or relative ./src)
 * Side-effects: none
 * Links: vitest.workspace.ts, tests/
 * @internal
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineProject } from "vitest/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// biome-ignore lint/style/noDefaultExport: vitest requires default export
export default defineProject({
  plugins: [
    tsconfigPaths({
      projects: [path.resolve(__dirname, "../../tsconfig.json")],
    }),
  ],
  test: {
    name: "node-streams",
    globals: true,
    environment: "node",
    include: ["tests/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["node_modules", "dist"],
  },
});
