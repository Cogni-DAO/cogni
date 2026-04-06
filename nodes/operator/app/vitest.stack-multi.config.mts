// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `vitest.stack-multi.config.mts`
 * Purpose: Vitest configuration for multi-node stack tests requiring dev:stack:full.
 * Scope: Runs multi-node billing isolation tests against 3 live nodes (operator, poly, resy).
 *   No mock-llm or openclaw preflights — tests POST directly to billing ingest endpoints.
 * Invariants: Requires dev:stack:full running; expects per-node DATABASE_SERVICE_URL env vars.
 * Side-effects: HTTP requests to running nodes, database connections to per-node DBs
 * Notes: Separate from vitest.stack.config.mts (single-node tests). No DB reset — tests
 *   seed and clean up their own data.
 * Links: task.0258, docs/spec/multi-node-tenancy.md
 * @public
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { createNodeVitestConfig } from "@cogni/node-test-utils/vitest-configs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default createNodeVitestConfig({
  dirname: __dirname,
  kind: "stack-multi",
});
