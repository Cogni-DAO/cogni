// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `vitest.external-money.config.mts`
 * Purpose: Vitest configuration for external money tests that spend real USDC on Base mainnet.
 * Scope: Tests in tests/external/money/ — require funded test wallet, OpenRouter API key,
 *   and a running dev:stack (Postgres + TigerBeetle). NOT part of CI.
 * Invariants: No testcontainers (expects dev:stack running). Separate config prevents accidental inclusion in other test suites.
 * Side-effects: process.env injection, real on-chain txs, real OpenRouter charges.
 * Links: tests/external/AGENTS.md, vitest.external.config.mts (similar pattern)
 * @public
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { createNodeVitestConfig } from "@cogni/node-test-utils/vitest-configs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default createNodeVitestConfig({ dirname: __dirname, kind: "external-money" });
