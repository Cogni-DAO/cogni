// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/graph-execution-host/tests/_helpers/usage-fact-builders`
 * Purpose: Test data factories for UsageFact.
 * Scope: Builds test fixtures for decorator unit tests. Does not test production code.
 * Invariants: none
 * Side-effects: none
 * Links: tests/
 * @internal
 */

import type { UsageFact } from "@cogni/ai-core";

export function buildInprocUsageFact(
  overrides?: Partial<UsageFact>
): UsageFact {
  return {
    runId: "run-123",
    attempt: 0,
    usageUnitId: "unit-123",
    source: "litellm",
    executorType: "inproc",
    billingAccountId: "billing-123",
    virtualKeyId: "vk-123",
    graphId: "langgraph:test",
    model: "gpt-4o",
    inputTokens: 100,
    outputTokens: 50,
    costUsd: 0.01,
    ...overrides,
  };
}

export function buildByoUsageFact(overrides?: Partial<UsageFact>): UsageFact {
  return buildInprocUsageFact({
    source: "codex",
    executorType: "inproc",
    usageUnitId: "run-123/0/byo",
    costUsd: 0,
    ...overrides,
  });
}
