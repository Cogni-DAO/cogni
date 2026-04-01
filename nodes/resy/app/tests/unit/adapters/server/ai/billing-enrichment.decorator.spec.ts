// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

import { buildExternalUsageFact, buildInprocUsageFact } from "@tests/_fakes";
import { describe, expect, it } from "vitest";

import { BillingEnrichmentGraphExecutorDecorator } from "@/adapters/server/ai/billing-enrichment.decorator";
import type {
  GraphExecutorPort,
  GraphRunRequest,
  GraphRunResult,
} from "@/ports";
import type { AiEvent, UsageReportEvent } from "@/types/ai-events";

function createFakeInnerExecutor(events: AiEvent[]): GraphExecutorPort {
  return {
    runGraph(_req: GraphRunRequest): GraphRunResult {
      async function* stream(): AsyncIterable<AiEvent> {
        for (const event of events) {
          yield event;
        }
      }

      return {
        stream: stream(),
        final: Promise.resolve({
          ok: true as const,
          runId: "run-123",
          requestId: "req-123",
        }),
      };
    },
  };
}

async function collectStream(
  stream: AsyncIterable<AiEvent>
): Promise<AiEvent[]> {
  const events: AiEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}

const fakeRequest: GraphRunRequest = {
  runId: "run-123",
  messages: [{ role: "user", content: "test" }],
  modelRef: { providerKey: "platform", modelId: "test-model" },
  graphId: "langgraph:poet",
};

describe("BillingEnrichmentGraphExecutorDecorator", () => {
  it("adds billing identity to neutral usage facts", async () => {
    const {
      billingAccountId: _,
      virtualKeyId: __,
      ...neutralFact
    } = buildInprocUsageFact();
    const innerEvents: AiEvent[] = [
      { type: "usage_report", fact: neutralFact } satisfies UsageReportEvent,
    ];

    const decorator = new BillingEnrichmentGraphExecutorDecorator(
      createFakeInnerExecutor(innerEvents),
      {
        billingAccountId: "billing-123",
        virtualKeyId: "vk-123",
      }
    );

    const collected = await collectStream(
      decorator.runGraph(fakeRequest).stream
    );
    expect(collected).toEqual([
      {
        type: "usage_report",
        fact: {
          ...neutralFact,
          billingAccountId: "billing-123",
          virtualKeyId: "vk-123",
        },
      },
    ]);
  });

  it("overwrites stale billing identity with canonical per-run billing", async () => {
    const innerEvents: AiEvent[] = [
      {
        type: "usage_report",
        fact: buildExternalUsageFact({
          billingAccountId: "wrong-account",
          virtualKeyId: "wrong-key",
        }),
      } satisfies UsageReportEvent,
    ];

    const decorator = new BillingEnrichmentGraphExecutorDecorator(
      createFakeInnerExecutor(innerEvents),
      {
        billingAccountId: "billing-123",
        virtualKeyId: "vk-123",
      }
    );

    const [event] = await collectStream(decorator.runGraph(fakeRequest).stream);
    expect(event).toMatchObject({
      type: "usage_report",
      fact: {
        billingAccountId: "billing-123",
        virtualKeyId: "vk-123",
      },
    });
  });
});
