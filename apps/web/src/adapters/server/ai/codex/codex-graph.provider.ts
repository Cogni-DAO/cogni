// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@adapters/server/ai/codex/codex-graph.provider`
 * Purpose: Codex-native graph executor using @openai/codex-sdk.
 * Scope: Implements GraphExecutorPort by spawning the Codex CLI via SDK, mapping ThreadEvents to AiEvents.
 * Invariants:
 *   - CODEX_NATIVE_TRANSPORT: Uses Codex SDK (not OpenAI API, not LiteLLM) for Codex subscription models
 *   - SINGLE_TRUSTED_RUNNER: v0 uses file-backed auth (~/.codex/auth.json), single developer subscription
 *   - GRAPH_FINALIZATION_ONCE: Exactly one done event per run
 *   - NO_SANDBOX: Codex runs with sandbox=read-only, no file writes to host
 * Side-effects: IO (spawns codex CLI subprocess via SDK)
 * Links: docs/research/openai-oauth-byo-ai.md
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

import { makeLogger } from "@/shared/observability";

/**
 * Provider ID for Codex-native graph execution.
 */
export const CODEX_PROVIDER_ID = "codex" as const;

/**
 * Codex graph executor using the @openai/codex-sdk.
 *
 * v0: single trusted runner with file-backed auth (~/.codex/auth.json).
 * Auth is obtained via `pnpm codex:login` which runs the PKCE OAuth flow
 * and stores tokens locally. The SDK reads these automatically.
 *
 * The SDK spawns `codex exec` as a subprocess, communicates via JSONL over stdio,
 * and handles the Codex-native transport (WebSocket + Responses API to ChatGPT backend).
 */
export class CodexGraphProvider implements GraphExecutorPort {
  private readonly log: Logger;

  constructor() {
    this.log = makeLogger({ component: "CodexGraphProvider" });
  }

  runGraph(req: GraphRunRequest, ctx?: ExecutionContext): GraphRunResult {
    const log = this.log.child({ runId: req.runId, graphId: req.graphId });
    const graphName = req.graphId.split(":")[1] ?? "default";

    // Codex SDK selects the best model for the user's subscription automatically.
    // Don't specify model — let the SDK default (avoids "model not supported" errors
    // when ChatGPT account doesn't have access to specific model names).
    const model = undefined;

    log.info(
      { model, graphName, messageCount: req.messages.length },
      "Starting Codex graph execution"
    );

    // Build the prompt from messages
    const lastUserMsg = [...req.messages]
      .reverse()
      .find((m) => m.role === "user");
    const prompt = lastUserMsg?.content ?? "";

    // System prompt based on graph name
    const systemPrompt = resolveSystemPrompt(graphName);
    const fullPrompt = systemPrompt
      ? `${systemPrompt}\n\nUser: ${prompt}`
      : prompt;

    // Track final state
    let finalResolve: ((value: GraphFinal) => void) | undefined;
    const finalPromise = new Promise<GraphFinal>((resolve) => {
      finalResolve = resolve;
    });

    const stream = this.executeCodex({
      prompt: fullPrompt,
      model,
      runId: req.runId,
      requestId: ctx?.requestId ?? req.runId,
      log,
      // biome-ignore lint/style/noNonNullAssertion: resolve is assigned synchronously in Promise constructor
      onFinal: (final) => finalResolve!(final),
    });

    return { stream, final: finalPromise };
  }

  private async *executeCodex(params: {
    prompt: string;
    model: string | undefined;
    runId: string;
    requestId: string;
    log: Logger;
    onFinal: (final: GraphFinal) => void;
  }): AsyncIterable<AiEvent> {
    const { prompt, model, runId, requestId, log, onFinal } = params;
    const startMs = Date.now();

    try {
      // Dynamic import to avoid loading the SDK at module scope
      // (it spawns a subprocess, don't want that at import time)
      const { Codex } = await import("@openai/codex-sdk");

      // Resolve codex CLI from node_modules/.bin (installed via @openai/codex).
      // Uses COGNI_REPO_ROOT for reliable path resolution across all environments.
      const { join } = await import("node:path");
      const { serverEnv } = await import("@/shared/env");
      const codexBin = join(
        serverEnv().COGNI_REPO_ROOT,
        "node_modules",
        ".bin",
        "codex"
      );
      const codex = new Codex({ codexPathOverride: codexBin });
      const thread = codex.startThread({
        ...(model ? { model } : {}),
        sandboxMode: "read-only",
        approvalPolicy: "never",
        skipGitRepoCheck: true,
      });

      log.info({ model }, "Codex thread started, sending prompt");

      yield { type: "status", phase: "thinking" } as AiEvent;

      const { events } = await thread.runStreamed(prompt);

      let fullText = "";
      let usage: { promptTokens: number; completionTokens: number } | undefined;

      for await (const event of events) {
        switch (event.type) {
          case "item.started":
          case "item.updated":
          case "item.completed": {
            if (event.item.type === "agent_message") {
              const newText = event.item.text;
              if (newText.length > fullText.length) {
                const delta = newText.slice(fullText.length);
                fullText = newText;
                yield { type: "text_delta", delta } as AiEvent;
              }
            }
            if (event.item.type === "reasoning") {
              yield {
                type: "status",
                phase: "thinking",
                label: "reasoning",
              } as AiEvent;
            }
            break;
          }

          case "turn.completed": {
            usage = {
              promptTokens: event.usage.input_tokens,
              completionTokens: event.usage.output_tokens,
            };
            break;
          }

          case "turn.failed": {
            log.error(
              { error: event.error.message, durationMs: Date.now() - startMs },
              "Codex turn failed"
            );
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
            return;
          }

          case "error": {
            log.error(
              { error: event.message, durationMs: Date.now() - startMs },
              "Codex stream error"
            );
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
            return;
          }

          // Ignore other events (thread.started, turn.started)
          default:
            break;
        }
      }

      // Emit assistant_final for history persistence
      if (fullText) {
        yield { type: "assistant_final", content: fullText } as AiEvent;
      }

      const durationMs = Date.now() - startMs;
      log.info(
        {
          durationMs,
          textLength: fullText.length,
          promptTokens: usage?.promptTokens,
          completionTokens: usage?.completionTokens,
        },
        "Codex graph execution complete"
      );

      yield {
        type: "done",
        finishReason: "stop",
        ...(usage ? { usage } : {}),
      } as AiEvent;

      onFinal({
        ok: true,
        runId,
        requestId,
        ...(usage ? { usage } : {}),
        finishReason: "stop",
        content: fullText,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error(
        { error: message, durationMs: Date.now() - startMs },
        "Codex graph execution failed"
      );
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

/**
 * Resolve system prompt for a given graph name.
 * Simple mapping — no external config for v0.
 */
function resolveSystemPrompt(graphName: string): string | null {
  switch (graphName) {
    case "poet":
      return "You are a poet. Respond to every message with a short, creative poem. Use vivid imagery and varied poetic forms.";
    case "spark":
      return "You are a helpful, concise coding assistant. Answer questions directly.";
    default:
      return null;
  }
}
