// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `vitest.component.config.mts`
 * Purpose: Vitest configuration for component tests using isolated docker testcontainers.
 * Scope: Configures component test environment for tests that use testcontainers. Does not handle unit tests.
 * Invariants:
 *   - Uses tsconfigPaths plugin for clean `@/core` resolution; loads .env.test for DB connection; anchored at repo root.
 *   - `pool: forks` + `singleFork: true` + `fileParallelism: false`: ALL component tests share a
 *     single testcontainer Postgres (started by `testcontainers-postgres.global.ts`) and run
 *     strictly serially. `singleFork` alone doesn't stop file-level concurrent scheduling — without
 *     `fileParallelism: false`, vitest interleaves files as async tasks in the same fork, leaking
 *     one file's seed rows into another file's global enumeration queries
 *     (task.5012 CP4/CP7 + task.5016 CP3 cross-pollution; FK violations from concurrent wallet
 *     deletes mid-tick).
 * Side-effects: process.env (.env.test injection), database connections
 * Notes: Plugin-only approach eliminates manual alias conflicts; explicit tsconfig.base.json reference ensures path accuracy.
 * Links: tsconfig.base.json paths, component test files
 * @public
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { expand } from "dotenv-expand";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env.test for component tests with variable expansion
const env = config({ path: ".env.test" });
expand(env);

// Repo access: tests/setup.ts provides fallback for COGNI_REPO_PATH

export default defineConfig({
  root: __dirname,
  plugins: [tsconfigPaths({ projects: ["./tsconfig.test.json"] })],
  test: {
    include: ["tests/component/**/*.int.test.ts"],
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    globalSetup: ["./tests/component/setup/testcontainers-postgres.global.ts"],
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    fileParallelism: false,
    sequence: { concurrent: false },
  },
  resolve: {
    alias: {
      "@tests": path.resolve(__dirname, "./tests"),
    },
  },
});
