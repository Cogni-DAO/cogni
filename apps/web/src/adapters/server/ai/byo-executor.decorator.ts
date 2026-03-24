// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@adapters/server/ai/byo-executor.decorator`
 * Purpose: BYO-AI executor decorator — routes graph execution through user's own LLM subscription
 *   when modelConnectionId is present on the request.
 * Scope: Decorator in the executor stack. Resolves credentials via ConnectionBrokerPort, delegates
 *   to ChatGPT completion backend. Passes through to inner executor when no BYO connection.
 * Invariants:
 *   - GRAPH_BACKEND_ORTHOGONAL: Same graph, different backend based on connection presence.
 *   - DECORATOR_PATTERN: Sits in the executor decorator stack, not namespace routing.
 *   - BROKER_RESOLVES_ALL: Uses ConnectionBrokerPort, never direct DB reads.
 *   - NO_CREDIT_BYPASS: Stack ordering handles billing — BYO runs never reach inner executor.
 * Side-effects: IO (credential resolution via broker, subprocess execution)
 * Links: docs/spec/tenant-connections.md, apps/web/src/adapters/server/ai/codex/chatgpt-completion.backend.ts
 * @internal
 */

import type { AiEvent, AiExecutionErrorCode } from "@cogni/ai-core";
import type {
  ExecutionContext,
  GraphExecutorPort,
  GraphFinal,
  GraphRunRequest,
  GraphRunResult,
} from "@cogni/graph-execution-core";
import type { Logger } from "pino";

import type { ConnectionBrokerPort } from "@/ports";

import { executeChatGPTCompletion } from "./codex/chatgpt-completion.backend";

/**
 * BYO executor decorator.
 *
 * When `req.modelConnectionId` is present, resolves the user's credentials
 * via ConnectionBrokerPort and routes the run through the ChatGPT completion backend.
 * When absent, passes through to the inner executor (standard LiteLLM/OpenRouter path).
 *
 * Stack position: inside PreflightCreditCheckDecorator, wrapping the inner executor.
 * BYO runs never reach the inner executor → no platform usage_report → no credits consumed.
 */
export class BYOExecutorDecorator implements GraphExecutorPort {
  constructor(
    private readonly inner: GraphExecutorPort,
    private readonly broker: ConnectionBrokerPort,
    private readonly billingAccountId: string,
    private readonly log: Logger
  ) {}

  runGraph(req: GraphRunRequest, ctx?: ExecutionContext): GraphRunResult {
    if (!req.modelConnectionId) {
      return this.inner.runGraph(req, ctx);
    }

    // BYO path: resolve credentials and route to ChatGPT backend
    const connectionId = req.modelConnectionId;
    const billingAccountId = this.billingAccountId;
    const broker = this.broker;
    const log = this.log.child({
      runId: req.runId,
      connectionId,
      byoProvider: true,
    });

    let finalResolve: ((value: GraphFinal) => void) | undefined;
    const finalPromise = new Promise<GraphFinal>((resolve) => {
      finalResolve = resolve;
    });

    const stream = this.executeBYO(
      req,
      ctx,
      connectionId,
      billingAccountId,
      broker,
      log,
      // biome-ignore lint/style/noNonNullAssertion: resolve assigned synchronously
      (f) => finalResolve!(f)
    );

    return { stream, final: finalPromise };
  }

  private async *executeBYO(
    req: GraphRunRequest,
    ctx: ExecutionContext | undefined,
    connectionId: string,
    billingAccountId: string,
    broker: ConnectionBrokerPort,
    log: Logger,
    onFinal: (f: GraphFinal) => void
  ): AsyncIterable<AiEvent> {
    const runId = req.runId;
    const requestId = ctx?.requestId ?? runId;

    try {
      const connection = await broker.resolve(connectionId, billingAccountId);
      log.info(
        { provider: connection.provider, graphId: req.graphId },
        "BYO connection resolved, routing to ChatGPT backend"
      );

      const result = executeChatGPTCompletion({
        req,
        ctx,
        connection,
      });

      // Forward all events from the ChatGPT backend
      for await (const event of result.stream) {
        yield event;
      }

      // Forward the final result
      const final = await result.final;
      onFinal(final);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error({ error: message }, "BYO execution failed");

      yield {
        type: "error",
        error: "internal" as AiExecutionErrorCode,
      } as AiEvent;
      yield { type: "done" } as AiEvent;
      onFinal({
        ok: false,
        runId,
        requestId,
        error: "internal" as AiExecutionErrorCode,
      });
    }
  }
}
