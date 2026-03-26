// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@adapters/server/ai/codex/chatgpt-completion.backend`
 * Purpose: ChatGPT completion backend using Codex SDK subprocess.
 * Scope: Accepts pre-resolved credentials, spawns `codex exec` with per-request CODEX_HOME,
 *   maps ThreadEvents to AiEvents. No DB reads, no decryption — broker handles that.
 * Invariants:
 *   - LLM_PROVIDER_NOT_AGENT_RUNTIME: This is an LLM completion backend, not a full Codex agent container.
 *   - SUBPROCESS_PER_REQUEST: Each execution spawns an isolated `codex exec` subprocess.
 *   - TOKENS_NEVER_LOGGED: Credential values never appear in logs.
 *   - GRAPH_FINALIZATION_ONCE: Exactly one done event per run.
 * Side-effects: IO (spawns subprocess, writes temp auth.json, cleans up)
 * Links: docs/research/openai-oauth-byo-ai.md
 * @internal
 */

import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AiEvent, AiExecutionErrorCode, Message } from "@cogni/ai-core";
import type {
  ExecutionContext,
  GraphFinal,
  GraphRunRequest,
  GraphRunResult,
} from "@cogni/graph-execution-core";
import type { Logger } from "pino";

import type { ResolvedConnection } from "@/ports";
import { makeLogger } from "@/shared/observability";

const log = makeLogger({ component: "ChatGPTCompletionBackend" });

export interface ChatGPTExecutionParams {
  req: GraphRunRequest;
  ctx?: ExecutionContext | undefined;
  connection: ResolvedConnection;
}

/**
 * Execute a graph run using the ChatGPT completion backend (Codex SDK subprocess).
 * Accepts pre-resolved credentials from ConnectionBrokerPort.
 */
export function executeChatGPTCompletion(
  params: ChatGPTExecutionParams
): GraphRunResult {
  const { req, ctx, connection } = params;
  const runLog = log.child({ runId: req.runId, graphId: req.graphId });

  let finalResolve: ((value: GraphFinal) => void) | undefined;
  const finalPromise = new Promise<GraphFinal>((resolve) => {
    finalResolve = resolve;
  });

  const stream = executeWithTempAuth({
    req,
    requestId: ctx?.requestId ?? req.runId,
    connection,
    log: runLog,
    // biome-ignore lint/style/noNonNullAssertion: resolve assigned synchronously
    onFinal: (f) => finalResolve!(f),
  });

  return { stream, final: finalPromise };
}

async function* executeWithTempAuth(params: {
  req: GraphRunRequest;
  requestId: string;
  connection: ResolvedConnection;
  log: Logger;
  onFinal: (final: GraphFinal) => void;
}): AsyncIterable<AiEvent> {
  const { req, requestId, connection, log: runLog, onFinal } = params;
  const startMs = Date.now();
  const runId = req.runId;

  // Create isolated temp dir for this execution's auth
  const tempDir = join(tmpdir(), `cogni-codex-${randomUUID()}`);
  const codexDir = join(tempDir, ".codex");

  try {
    // Write temp auth.json matching Codex CLI's expected format
    // (verified against ~/.codex/auth.json structure)
    await mkdir(codexDir, { recursive: true });
    await writeFile(
      join(codexDir, "auth.json"),
      JSON.stringify({
        auth_mode: "chatgpt",
        OPENAI_API_KEY: null,
        tokens: {
          access_token: connection.credentials.accessToken,
          refresh_token: connection.credentials.refreshToken ?? "",
          account_id: connection.credentials.accountId ?? "",
        },
        last_refresh: Date.now(),
      }),
      { mode: 0o600 }
    );

    // Dynamic import to avoid module-scope subprocess spawn
    const { Codex } = await import("@openai/codex-sdk");
    const { serverEnv } = await import("@/shared/env");
    const codexBin = join(
      serverEnv().COGNI_REPO_ROOT,
      "node_modules",
      ".bin",
      "codex"
    );

    // Build env for the subprocess — inherit current env + override HOME
    // for per-request auth isolation (Codex reads from $HOME/.codex/auth.json)
    const { env: currentEnv } = await import("node:process");
    const envRecord: Record<string, string> = {};
    for (const [k, v] of Object.entries(currentEnv)) {
      if (v != null) envRecord[k] = v;
    }
    envRecord.HOME = tempDir; // Must be after loop to avoid being overwritten
    const codex = new Codex({
      codexPathOverride: codexBin,
      env: envRecord,
    });

    const thread = codex.startThread({
      sandboxMode: "read-only",
      approvalPolicy: "never",
      skipGitRepoCheck: true,
    });

    // Build prompt from full conversation history.
    // codex exec accepts a single string per turn — format the entire message
    // array so the model sees the full multi-turn context.
    const fullPrompt = formatMessagesAsPrompt(req.messages);

    runLog.info(
      { messageCount: req.messages.length },
      "ChatGPT completion started via codex exec"
    );

    yield { type: "status", phase: "thinking" } as AiEvent;

    const { events } = await thread.runStreamed(fullPrompt);

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
          runLog.error(
            {
              error: event.error.message,
              durationMs: Date.now() - startMs,
            },
            "ChatGPT turn failed"
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
          runLog.error(
            {
              error: event.message,
              durationMs: Date.now() - startMs,
            },
            "ChatGPT stream error"
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

        default:
          break;
      }
    }

    if (fullText) {
      yield { type: "assistant_final", content: fullText } as AiEvent;
    }

    const durationMs = Date.now() - startMs;
    runLog.info(
      {
        durationMs,
        textLength: fullText.length,
        promptTokens: usage?.promptTokens,
        completionTokens: usage?.completionTokens,
      },
      "ChatGPT completion finished"
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
    runLog.error(
      { error: message, durationMs: Date.now() - startMs },
      "ChatGPT completion failed"
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
  } finally {
    // Cleanup temp auth dir
    rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Format the full message history into a single prompt string.
 * codex exec takes one string per turn — we serialize the entire
 * conversation so the model has full multi-turn context.
 */
function formatMessagesAsPrompt(messages: Message[]): string {
  const parts: string[] = [];
  const systemParts: string[] = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      systemParts.push(msg.content);
    } else if (msg.role === "user") {
      parts.push(`User: ${msg.content}`);
    } else if (msg.role === "assistant") {
      parts.push(`Assistant: ${msg.content}`);
    } else if (msg.role === "tool") {
      parts.push(`Tool result: ${msg.content}`);
    }
  }

  const system = systemParts.length > 0 ? systemParts.join("\n") + "\n\n" : "";
  return system + parts.join("\n\n");
}
