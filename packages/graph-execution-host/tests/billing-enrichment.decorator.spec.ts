// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/graph-execution-host/tests/billing-enrichment.decorator.spec`
 * Purpose: Unit tests for BillingEnrichmentGraphExecutorDecorator.
 * Scope: Tests billing identity enrichment of usage_report events. Does not test actual billing or database writes.
 * Invariants: Tests use in-memory mock executors only.
 * Side-effects: none
 * Links: src/decorators/billing-enrichment.decorator.ts
 * @internal
 */

import type { AiEvent, UsageReportEvent } from "@cogni/ai-core";
import type {
  GraphExecutorPort,
  GraphRunRequest,
} from "@cogni/graph-execution-core";
import { describe, expect, it } from "vitest";

import { BillingEnrichmentGraphExecutorDecorator } from "../src/decorators/billing-enrichment.decorator";
import { buildInprocUsageFact } from "./_helpers/usage-fact-builders";

function makeRequest(overrides?: Partial<GraphRunRequest>): GraphRunRequest {
  return {
    runId: "run-1",
    graphId: "langgraph:test",
    messages: [],
    modelRef: { providerKey: "platform", modelId: "gpt-4o" },
    ...overrides,
  };
}

function makeInnerExecutor(events: AiEvent[]): GraphExecutorPort {
  return {
    runGraph: () => ({
      stream: (async function* () {
        for (const e of events) yield e;
      })(),
      final: Promise.resolve({ ok: true, runId: "run-1", requestId: "run-1" }),
    }),
  };
}

describe("BillingEnrichmentGraphExecutorDecorator", () => {
  const billing = { billingAccountId: "ba-1", virtualKeyId: "vk-1" };

  it("enriches usage_report events with billing identity", async () => {
    const fact = buildInprocUsageFact();
    const usageEvent: UsageReportEvent = { type: "usage_report", fact };
    const inner = makeInnerExecutor([
      { type: "text_delta", delta: "hi" },
      usageEvent,
      { type: "done" },
    ]);

    const decorator = new BillingEnrichmentGraphExecutorDecorator(
      inner,
      billing
    );
    const result = decorator.runGraph(makeRequest());

    const events: AiEvent[] = [];
    for await (const e of result.stream) events.push(e);

    const enriched = events.find(
      (e) => e.type === "usage_report"
    ) as UsageReportEvent;
    expect(enriched).toBeDefined();
    expect(enriched.fact.billingAccountId).toBe("ba-1");
    expect(enriched.fact.virtualKeyId).toBe("vk-1");
  });

  it("passes non-usage events through unmodified", async () => {
    const inner = makeInnerExecutor([
      { type: "text_delta", delta: "hello" },
      { type: "done" },
    ]);

    const decorator = new BillingEnrichmentGraphExecutorDecorator(
      inner,
      billing
    );
    const result = decorator.runGraph(makeRequest());

    const events: AiEvent[] = [];
    for await (const e of result.stream) events.push(e);

    expect(events).toHaveLength(2);
    expect(events[0]?.type).toBe("text_delta");
    expect(events[1]?.type).toBe("done");
  });
});
