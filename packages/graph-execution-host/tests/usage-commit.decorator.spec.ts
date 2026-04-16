// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/graph-execution-host/tests/usage-commit.decorator.spec`
 * Purpose: Unit tests for UsageCommitDecorator billing validation and receipt writing.
 * Scope: Tests usage_report consumption, BYO commit, and platform deferral. Does not test actual database writes.
 * Invariants: Tests use in-memory mock executors and commit functions only.
 * Side-effects: none
 * Links: src/decorators/usage-commit.decorator.ts
 * @internal
 */

import type { AiEvent, UsageReportEvent } from "@cogni/ai-core";
import type {
  GraphExecutorPort,
  GraphRunRequest,
} from "@cogni/graph-execution-core";
import { describe, expect, it, vi } from "vitest";
import { UsageCommitDecorator } from "../src/decorators/usage-commit.decorator";
import type { CommitUsageFactFn } from "../src/ports/commit-usage-fact";
import { createMockLogger } from "./_helpers/mock-logger";
import {
  buildByoUsageFact,
  buildInprocUsageFact,
} from "./_helpers/usage-fact-builders";

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

describe("UsageCommitDecorator", () => {
  it("consumes usage_report events (not yielded to consumer)", async () => {
    const fact = buildInprocUsageFact();
    const inner = makeInnerExecutor([
      { type: "text_delta", delta: "hi" },
      { type: "usage_report", fact } satisfies UsageReportEvent,
      { type: "done" },
    ]);

    const commitByo: CommitUsageFactFn = vi.fn().mockResolvedValue(undefined);
    const log = createMockLogger();
    const decorator = new UsageCommitDecorator(inner, log, commitByo);
    const result = decorator.runGraph(makeRequest());

    const events: AiEvent[] = [];
    for await (const e of result.stream) events.push(e);

    // usage_report consumed — not in output
    expect(events.map((e) => e.type)).toEqual(["text_delta", "done"]);
  });

  it("commits BYO usage receipts directly", async () => {
    const fact = buildByoUsageFact();
    const inner = makeInnerExecutor([
      { type: "usage_report", fact } satisfies UsageReportEvent,
      { type: "done" },
    ]);

    const commitByo: CommitUsageFactFn = vi.fn().mockResolvedValue(undefined);
    const log = createMockLogger();
    const decorator = new UsageCommitDecorator(inner, log, commitByo);
    const result = decorator.runGraph(makeRequest());

    for await (const _ of result.stream) {
      /* drain */
    }

    expect(commitByo).toHaveBeenCalledWith(fact, log);
  });

  it("does NOT commit platform (litellm) usage — defers to callback", async () => {
    const fact = buildInprocUsageFact({ source: "litellm" });
    const inner = makeInnerExecutor([
      { type: "usage_report", fact } satisfies UsageReportEvent,
      { type: "done" },
    ]);

    const commitByo: CommitUsageFactFn = vi.fn().mockResolvedValue(undefined);
    const log = createMockLogger();
    const decorator = new UsageCommitDecorator(inner, log, commitByo);
    const result = decorator.runGraph(makeRequest());

    for await (const _ of result.stream) {
      /* drain */
    }

    expect(commitByo).not.toHaveBeenCalled();
  });
});
