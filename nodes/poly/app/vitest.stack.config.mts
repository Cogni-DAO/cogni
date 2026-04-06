// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `vitest.stack.config.mts`
 * Purpose: Vitest configuration for stack tests (HTTP API) requiring running Docker Compose infrastructure.
 * Scope: Configures stack test environment for tests that need full app+postgres+litellm stack. Does not handle unit or pure adapter tests.
 * Invariants: Uses tsconfigPaths plugin for clean `@/core` resolution; expects env vars loaded externally; expects running HTTP server.
 * Side-effects: HTTP requests to running server, database connections
 * Notes: Environment variables loaded by package.json dotenv commands or CI; runs reset-db.ts globalSetup; sequential test execution.
 * Links: tsconfig.base.json paths, stack test files, tests/setup.ts
 * @public
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { createNodeVitestConfig } from "@cogni/node-test-utils/vitest-configs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default createNodeVitestConfig({ dirname: __dirname, kind: "stack" });
