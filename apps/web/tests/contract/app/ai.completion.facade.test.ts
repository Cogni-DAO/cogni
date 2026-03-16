// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/_facades/ai/completion.server`
 * Purpose: Verifies DTO validation and dependency coordination of AI completion facade.
 * Scope: App-layer contract testing with mocks. Does NOT test feature logic or HTTP routing.
 * Invariants:
 *   - Contract compliance; error mapping; dependency injection; timestamp consistency.
 *   - UNIFIED_GRAPH_EXECUTOR: All execution flows through GraphExecutorPort.runGraph()
 *   - Returns OpenAI-compatible ChatCompletion format
 * Side-effects: none
 * Notes: Uses fake services for isolation; mocks GraphExecutor at bootstrap boundary.
 * Links: chatCompletionsContract, completion facade, GRAPH_EXECUTION.md
 * @public
 */

import {
  createMockAccountServiceWithDefaults,
  FakeAiTelemetryAdapter,
  FakeClock,
  TEST_SESSION_USER_1,
} from "@tests/_fakes";
import { TEST_MODEL_ID } from "@tests/_fakes/ai/fakes";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { chatCompletion } from "@/app/_facades/ai/completion.server";
import { chatCompletionsContract } from "@/contracts/ai.completions.v1.contract";
import type {
  GraphExecutorPort,
  GraphRunRequest,
  GraphRunResult,
} from "@/ports";
import type { RequestContext } from "@/shared/observability";
import { makeNoopLogger } from "@/shared/observability";
import type { AiEvent } from "@/types/ai-events";

// Mock the bootstrap container
vi.mock("@/bootstrap/container", () => ({
  resolveAiAdapterDeps: vi.fn(),
}));

// Mock the graph executor factory (stable boundary per UNIFIED_GRAPH_EXECUTOR)
vi.mock("@/bootstrap/graph-executor.factory", () => ({
  createGraphExecutor: vi.fn(),
}));

// Mock preflightCreditCheck to avoid serverEnv access in contract tests
// Preserves other exports from public.server.ts (createAiRuntime, toCoreMessages, etc.)
vi.mock("@/features/ai/public.server", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/features/ai/public.server")>();
  return {
    ...original,
    preflightCreditCheck: vi.fn().mockResolvedValue(undefined),
  };
});

import { resolveAiAdapterDeps } from "@/bootstrap/container";
import { createGraphExecutor } from "@/bootstrap/graph-executor.factory";

const mockResolveAiAdapterDeps = vi.mocked(resolveAiAdapterDeps);
const mockCreateGraphExecutor = vi.mocked(createGraphExecutor);

/**
 * Create a fake GraphExecutorPort for testing.
 * Emits a simple stream with text_delta and done events.
 */
function createFakeGraphExecutor(options: {
  responseContent: string;
  requestId: string;
}): GraphExecutorPort & { runGraphSpy: ReturnType<typeof vi.fn> } {
  const runGraphSpy = vi.fn();

  const executor: GraphExecutorPort = {
    runGraph(req: GraphRunRequest): GraphRunResult {
      runGraphSpy(req);

      // Create async generator for stream
      async function* createStream(): AsyncIterable<AiEvent> {
        yield { type: "text_delta", delta: options.responseContent };
        yield { type: "done" };
      }

      // Create final promise
      const final = Promise.resolve({
        ok: true as const,
        runId: req.runId,
        requestId: options.requestId,
        usage: { promptTokens: 10, completionTokens: 20 },
        finishReason: "stop",
      });

      return { stream: createStream(), final };
    },
  };

  return { ...executor, runGraphSpy };
}

describe("app/_facades/ai/completion.server", () => {
  const sessionUser = TEST_SESSION_USER_1;

  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("chatCompletion", () => {
    it("should handle valid input and return OpenAI-compatible ChatCompletion output via GraphExecutorPort", async () => {
      // Arrange
      const input = {
        messages: [{ role: "user" as const, content: "Hello" }],
        model: TEST_MODEL_ID,
        sessionUser,
        graphName: "langgraph:poet",
      };

      const fakeClock = new FakeClock("2025-01-01T12:00:00.000Z");
      const mockAccountService = createMockAccountServiceWithDefaults();

      mockResolveAiAdapterDeps.mockReturnValue({
        llmService: {} as never, // Not used in streaming path
        accountService: mockAccountService,
        clock: fakeClock,
        aiTelemetry: new FakeAiTelemetryAdapter(),
        langfuse: undefined,
      });

      // Create fake executor with spy
      const fakeExecutor = createFakeGraphExecutor({
        responseContent: "AI response",
        requestId: "req-123",
      });
      mockCreateGraphExecutor.mockReturnValue(fakeExecutor);

      const testCtx: RequestContext = {
        log: makeNoopLogger(),
        reqId: "test-req-123",
        traceId: "00000000000000000000000000000000",
        routeId: "test.route",
        clock: fakeClock,
      };

      // Act
      const result = await chatCompletion(input, testCtx);

      // Assert - CRITICAL: GraphExecutorPort.runGraph() MUST be called
      expect(fakeExecutor.runGraphSpy).toHaveBeenCalledTimes(1);
      const runGraphCall = fakeExecutor.runGraphSpy.mock
        .calls[0]?.[0] as GraphRunRequest;
      expect(runGraphCall).toBeDefined();
      expect(runGraphCall.runId).toBe("test-req-123"); // P0: runId = ctx.reqId
      expect(runGraphCall.ingressRequestId).toBe("test-req-123");
      expect(runGraphCall.model).toBe(TEST_MODEL_ID);
      expect(runGraphCall.messages).toHaveLength(1);

      // Verify OpenAI-compatible output
      expect(result.object).toBe("chat.completion");
      expect(result.id).toContain("chatcmpl-");
      expect(result.model).toBe(TEST_MODEL_ID);
      expect(result.choices).toHaveLength(1);
      expect(result.choices[0]?.message.role).toBe("assistant");
      expect(result.choices[0]?.message.content).toBe("AI response");
      expect(result.choices[0]?.finish_reason).toBe("stop");
      expect(result.usage.prompt_tokens).toBe(10);
      expect(result.usage.completion_tokens).toBe(20);
      expect(result.usage.total_tokens).toBe(30);

      // Verify contract compliance
      expect(() => chatCompletionsContract.output.parse(result)).not.toThrow();

      // Verify billing account lookup
      expect(
        mockAccountService.getOrCreateBillingAccountForUser
      ).toHaveBeenCalledWith({
        userId: sessionUser.id,
        walletAddress: sessionUser.walletAddress,
      });
    });

    it("should propagate errors from GraphExecutorPort final result", async () => {
      // Arrange
      const input = {
        messages: [{ role: "user" as const, content: "Hello" }],
        model: TEST_MODEL_ID,
        sessionUser,
        graphName: "langgraph:poet",
      };

      const fakeClock = new FakeClock();
      const mockAccountService = createMockAccountServiceWithDefaults();

      mockResolveAiAdapterDeps.mockReturnValue({
        llmService: {} as never,
        accountService: mockAccountService,
        clock: fakeClock,
        aiTelemetry: new FakeAiTelemetryAdapter(),
        langfuse: undefined,
      });

      // Create executor that returns error result
      const errorExecutor: GraphExecutorPort = {
        runGraph(req: GraphRunRequest): GraphRunResult {
          async function* createStream(): AsyncIterable<AiEvent> {
            yield { type: "done" };
          }

          return {
            stream: createStream(),
            final: Promise.resolve({
              ok: false as const,
              runId: req.runId,
              requestId: "req-err",
              error: "internal" as const,
            }),
          };
        },
      };
      mockCreateGraphExecutor.mockReturnValue(errorExecutor);

      const testCtx: RequestContext = {
        log: makeNoopLogger(),
        reqId: "test-req-123",
        traceId: "00000000000000000000000000000000",
        routeId: "test.route",
        clock: fakeClock,
      };

      // Act & Assert
      await expect(chatCompletion(input, testCtx)).rejects.toThrow(
        "Completion failed: internal"
      );
    });

    it("should use factory to create graph executor", async () => {
      // Arrange
      const input = {
        messages: [{ role: "user" as const, content: "Hello" }],
        model: TEST_MODEL_ID,
        sessionUser,
        graphName: "langgraph:poet",
      };

      const fakeClock = new FakeClock();
      const mockAccountService = createMockAccountServiceWithDefaults();

      mockResolveAiAdapterDeps.mockReturnValue({
        llmService: {} as never,
        accountService: mockAccountService,
        clock: fakeClock,
        aiTelemetry: new FakeAiTelemetryAdapter(),
        langfuse: undefined,
      });

      const fakeExecutor = createFakeGraphExecutor({
        responseContent: "Response",
        requestId: "req-456",
      });
      mockCreateGraphExecutor.mockReturnValue(fakeExecutor);

      const testCtx: RequestContext = {
        log: makeNoopLogger(),
        reqId: "test-req-123",
        traceId: "00000000000000000000000000000000",
        routeId: "test.route",
        clock: fakeClock,
      };

      // Act
      await chatCompletion(input, testCtx);

      // Assert - Factory must be called with (streamFn, userId, billingCommitFn)
      expect(mockCreateGraphExecutor).toHaveBeenCalledTimes(1);
      const [streamFn, userId, billingCommitFn] =
        mockCreateGraphExecutor.mock.calls[0] ?? [];
      expect(typeof streamFn).toBe("function");
      expect(typeof userId).toBe("string");
      // CRITICAL: billingCommitFn must be provided (task.0007 — decorator requires it)
      expect(typeof billingCommitFn).toBe("function");
    });

    it("should return valid created timestamp", async () => {
      // Arrange
      const input = {
        messages: [{ role: "user" as const, content: "First" }],
        model: TEST_MODEL_ID,
        sessionUser,
        graphName: "langgraph:poet",
      };

      const fakeClock = new FakeClock("2025-01-01T15:30:00.000Z");
      const mockAccountService = createMockAccountServiceWithDefaults();

      mockResolveAiAdapterDeps.mockReturnValue({
        llmService: {} as never,
        accountService: mockAccountService,
        clock: fakeClock,
        aiTelemetry: new FakeAiTelemetryAdapter(),
        langfuse: undefined,
      });

      const fakeExecutor = createFakeGraphExecutor({
        responseContent: "Response",
        requestId: "req-456",
      });
      mockCreateGraphExecutor.mockReturnValue(fakeExecutor);

      const testCtx: RequestContext = {
        log: makeNoopLogger(),
        reqId: "test-req-123",
        traceId: "00000000000000000000000000000000",
        routeId: "test.route",
        clock: fakeClock,
      };

      // Act
      const result = await chatCompletion(input, testCtx);

      // Assert - created should be a Unix timestamp in seconds
      expect(typeof result.created).toBe("number");
      expect(result.created).toBeGreaterThan(0);
    });

    it("should support system messages (OpenAI compatibility)", async () => {
      // Arrange
      const input = {
        messages: [
          { role: "system" as const, content: "You are a helpful assistant" },
          { role: "user" as const, content: "Hello" },
        ],
        model: TEST_MODEL_ID,
        sessionUser,
        graphName: "langgraph:poet",
      };

      const fakeClock = new FakeClock();
      const mockAccountService = createMockAccountServiceWithDefaults();

      mockResolveAiAdapterDeps.mockReturnValue({
        llmService: {} as never,
        accountService: mockAccountService,
        clock: fakeClock,
        aiTelemetry: new FakeAiTelemetryAdapter(),
        langfuse: undefined,
      });

      const fakeExecutor = createFakeGraphExecutor({
        responseContent: "Hi!",
        requestId: "req-sys",
      });
      mockCreateGraphExecutor.mockReturnValue(fakeExecutor);

      const testCtx: RequestContext = {
        log: makeNoopLogger(),
        reqId: "test-req-sys",
        traceId: "00000000000000000000000000000000",
        routeId: "test.route",
        clock: fakeClock,
      };

      // Act
      const result = await chatCompletion(input, testCtx);

      // Assert - System messages should be passed through
      expect(fakeExecutor.runGraphSpy).toHaveBeenCalledTimes(1);
      const runGraphCall = fakeExecutor.runGraphSpy.mock
        .calls[0]?.[0] as GraphRunRequest;
      expect(runGraphCall.messages).toHaveLength(2);
      expect(runGraphCall.messages[0]?.role).toBe("system");
      expect(result.choices[0]?.message.content).toBe("Hi!");
    });
  });
});
