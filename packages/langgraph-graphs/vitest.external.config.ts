// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/langgraph-graphs/vitest.external.config`
 * Purpose: Vitest configuration for external integration tests that hit real services / network.
 * Scope: Tests in tests/external/*.external.test.ts. NOT part of default CI (run via `pnpm test:external`).
 * Invariants: Tests may require network access (npm registry, real MCP servers, etc.).
 * Side-effects: IO (spawns subprocesses via npx; network calls during test runs)
 * Links: vitest.config.ts (unit), tests/external/
 * @internal
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    tsconfigPaths({
      projects: [path.resolve(__dirname, "../../tsconfig.json")],
    }),
  ],
  test: {
    name: "langgraph-graphs:external",
    globals: true,
    environment: "node",
    include: ["tests/external/**/*.external.test.ts"],
    exclude: ["node_modules", "dist"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
