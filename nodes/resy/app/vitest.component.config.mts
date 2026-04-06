// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `vitest.component.config.mts`
 * Purpose: Vitest configuration for component tests using isolated docker testcontainers.
 * Scope: Configures component test environment for tests that use testcontainers. Does not handle unit tests.
 * Invariants: Uses tsconfigPaths plugin for clean `@/core` resolution; loads .env.test for DB connection; anchored at repo root.
 * Side-effects: process.env (.env.test injection), database connections
 * Notes: Plugin-only approach eliminates manual alias conflicts; explicit tsconfig.base.json reference ensures path accuracy.
 * Links: tsconfig.base.json paths, component test files
 * @public
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { createNodeVitestConfig } from "@cogni/node-test-utils/vitest-configs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default createNodeVitestConfig({ dirname: __dirname, kind: "component" });
