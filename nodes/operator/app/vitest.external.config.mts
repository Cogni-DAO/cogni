// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `vitest.external.config.mts`
 * Purpose: Vitest configuration for external integration tests that hit real 3rd-party APIs.
 * Scope: Tests in tests/external/ — require internet + real API keys. NOT part of default CI.
 * Invariants: Uses testcontainers for ledger round-trip; skips gracefully if tokens missing.
 * Side-effects: process.env (.env.test injection), database connections, real HTTP to GitHub/etc.
 * Links: tests/external/AGENTS.md, vitest.component.config.mts (similar pattern)
 * @public
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { createNodeVitestConfig } from "@cogni/node-test-utils/vitest-configs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default createNodeVitestConfig({ dirname: __dirname, kind: "external" });
