// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@tests/stack/setup/wait-for-probes-multi`
 * Purpose: Global setup for multi-node stack tests — ensures /livez and /readyz pass
 *   on all 3 nodes (operator, poly, resy) before running tests.
 * Scope: Polls probes on each node sequentially. Fails fast if any node is not reachable.
 * Invariants: All 3 nodes must be healthy before multi-node tests execute.
 * Side-effects: IO (HTTP probe requests)
 * Notes: Reuses the same polling logic as wait-for-probes.ts but for 3 endpoints.
 * Links: vitest.stack-multi.config.mts, wait-for-probes.ts
 * @internal
 */

const LIVEZ_BUDGET_MS = 30_000;
const LIVEZ_INTERVAL_MS = 2_000;
const LIVEZ_TIMEOUT_MS = 2_000;
const READYZ_BUDGET_MS = 120_000;
const READYZ_INTERVAL_MS = 5_000;
const READYZ_TIMEOUT_MS = 5_000;

interface NodeTarget {
  name: string;
  baseUrl: string;
}

const NODES: NodeTarget[] = [
  {
    name: "operator",
    baseUrl: process.env.TEST_BASE_URL_OPERATOR ?? "http://localhost:3000",
  },
  {
    name: "poly",
    baseUrl: process.env.TEST_BASE_URL_POLY ?? "http://localhost:3100",
  },
  {
    name: "resy",
    baseUrl: process.env.TEST_BASE_URL_RESY ?? "http://localhost:3300",
  },
];

async function pollUntilOk(
  url: string,
  label: string,
  budgetMs: number,
  intervalMs: number,
  timeoutMs: number
): Promise<void> {
  const deadline = Date.now() + budgetMs;
  let lastError = "";

  while (Date.now() < deadline) {
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(tid);

      if (res.ok) {
        console.log(`  ✅ ${label} — HTTP ${res.status}`);
        return;
      }
      lastError = `HTTP ${res.status}`;
    } catch (e) {
      lastError = e instanceof Error ? e.message : "fetch failed";
    }

    await new Promise((r) => setTimeout(r, intervalMs));
  }

  throw new Error(`❌ ${label} failed after ${budgetMs}ms. Last: ${lastError}`);
}

// biome-ignore lint/style/noDefaultExport: Vitest globalSetup requires default export
export default async function waitForProbesMulti() {
  console.log("\n🔍 Multi-node probe validation:");

  for (const node of NODES) {
    console.log(`\n  ${node.name} (${node.baseUrl}):`);

    await pollUntilOk(
      `${node.baseUrl}/livez`,
      `${node.name} /livez`,
      LIVEZ_BUDGET_MS,
      LIVEZ_INTERVAL_MS,
      LIVEZ_TIMEOUT_MS
    );

    await pollUntilOk(
      `${node.baseUrl}/readyz`,
      `${node.name} /readyz`,
      READYZ_BUDGET_MS,
      READYZ_INTERVAL_MS,
      READYZ_TIMEOUT_MS
    );
  }

  console.log("\n✅ All 3 nodes healthy — proceeding with multi-node tests\n");
}
