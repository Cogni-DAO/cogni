// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/langgraph-graphs/tests/inproc/mcp-extra-tools`
 * Purpose: Verify that extraTools (MCP spike) are merged into the graph alongside contract tools.
 * Scope: Tests the runner's tool merging behavior. Does NOT test MCP client connectivity.
 * Invariants: none (unit tests)
 * Side-effects: none (all mocked)
 * Links: {@link ../../src/inproc/runner.ts createInProcGraphRunner}
 * @internal
 */

import type { AiEvent } from "@cogni/ai-core";
import { AIMessage } from "@langchain/core/messages";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createInProcGraphRunner } from "../../src/inproc/runner";
import type {
  CompletionFn,
  CompletionResult,
  CreateGraphFn,
  InProcGraphRequest,
  ToolExecFn,
} from "../../src/inproc/types";

async function collectEvents(
  stream: AsyncIterable<AiEvent>
): Promise<AiEvent[]> {
  const events: AiEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}

function createFakeCompletionFn(): CompletionFn {
  return () => {
    const stream = (async function* (): AsyncIterable<AiEvent> {
      yield { type: "text_delta", delta: "test" };
    })();
    const final: Promise<CompletionResult> = Promise.resolve({
      ok: true,
      content: "test",
    });
    return { stream, final };
  };
}

describe("extraTools merge (MCP spike)", () => {
  it("passes extra tools to graph factory alongside contract tools", async () => {
    // Track which tools the graph factory receives
    const receivedToolNames: string[] = [];

    const fakeGraphFactory: CreateGraphFn = (opts) => {
      for (const tool of opts.tools) {
        receivedToolNames.push(tool.name);
      }
      return {
        invoke: async () => ({
          messages: [new AIMessage({ content: "done" })],
        }),
      };
    };

    // Create a fake MCP tool (mimicking what @langchain/mcp-adapters returns)
    const fakeMcpTool = new DynamicStructuredTool({
      name: "grafana__get_dashboard",
      description: "Get a Grafana dashboard by UID",
      schema: z.object({ uid: z.string() }),
      func: async () => JSON.stringify({ title: "Test Dashboard" }),
    });

    const request: InProcGraphRequest = {
      runId: "test-run-id",
      messages: [{ role: "user", content: "Hello" }],
      configurable: { model: "test-model" },
    };

    const { stream, final } = createInProcGraphRunner({
      createGraph: fakeGraphFactory,
      completionFn: createFakeCompletionFn(),
      createToolExecFn: (): ToolExecFn => async () => ({ ok: true, value: {} }),
      toolContracts: [],
      request,
      extraTools: [fakeMcpTool],
    });

    await collectEvents(stream);
    const result = await final;

    expect(result.ok).toBe(true);
    expect(receivedToolNames).toContain("grafana__get_dashboard");
  });

  it("works without extraTools (backward compatible)", async () => {
    const receivedToolNames: string[] = [];

    const fakeGraphFactory: CreateGraphFn = (opts) => {
      for (const tool of opts.tools) {
        receivedToolNames.push(tool.name);
      }
      return {
        invoke: async () => ({
          messages: [new AIMessage({ content: "done" })],
        }),
      };
    };

    const request: InProcGraphRequest = {
      runId: "test-run-id",
      messages: [{ role: "user", content: "Hello" }],
      configurable: { model: "test-model" },
    };

    const { stream, final } = createInProcGraphRunner({
      createGraph: fakeGraphFactory,
      completionFn: createFakeCompletionFn(),
      createToolExecFn: (): ToolExecFn => async () => ({ ok: true, value: {} }),
      toolContracts: [],
      request,
      // no extraTools — backward compatible
    });

    await collectEvents(stream);
    const result = await final;

    expect(result.ok).toBe(true);
    expect(receivedToolNames).toHaveLength(0);
  });

  it("merges extra tools with contract-derived tools", async () => {
    const receivedToolNames: string[] = [];

    const fakeGraphFactory: CreateGraphFn = (opts) => {
      for (const tool of opts.tools) {
        receivedToolNames.push(tool.name);
      }
      return {
        invoke: async () => ({
          messages: [new AIMessage({ content: "done" })],
        }),
      };
    };

    const fakeMcpTool = new DynamicStructuredTool({
      name: "mcp__fetch",
      description: "Fetch a URL",
      schema: z.object({ url: z.string() }),
      func: async () => "fetched",
    });

    // Create a minimal tool contract
    const fakeContract = {
      name: "core__get-current-time",
      description: "Get current time",
      inputSchema: z.object({}),
      effect: "read_only" as const,
    };

    const request: InProcGraphRequest = {
      runId: "test-run-id",
      messages: [{ role: "user", content: "Hello" }],
      configurable: {
        model: "test-model",
        toolIds: ["core__get-current-time"],
      },
    };

    const { stream, final } = createInProcGraphRunner({
      createGraph: fakeGraphFactory,
      completionFn: createFakeCompletionFn(),
      createToolExecFn: (): ToolExecFn => async () => ({ ok: true, value: {} }),
      toolContracts: [fakeContract],
      request,
      extraTools: [fakeMcpTool],
    });

    await collectEvents(stream);
    const result = await final;

    expect(result.ok).toBe(true);
    expect(receivedToolNames).toContain("core__get-current-time");
    expect(receivedToolNames).toContain("mcp__fetch");
    expect(receivedToolNames).toHaveLength(2);
  });
});
