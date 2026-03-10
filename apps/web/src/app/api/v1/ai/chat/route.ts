// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@app/api/v1/ai/chat`
 * Purpose: HTTP endpoint for chat API using AI SDK Data Stream Protocol with server-authoritative thread persistence.
 * Scope: Accepts user message string, loads thread from DB, executes graph, streams via createUIMessageStream, accumulates response UIMessage for persistence. Does not implement business logic.
 * Invariants:
 *   - CLIENT_SENDS_USER_ONLY: client sends single message string; server loads authoritative thread from DB
 *   - OPTIMISTIC_APPEND: two-phase save (user before execute, assistant after pump) with expectedMessageCount guard
 *   - METADATA_ON_INSERT: thread metadata (model, graphName) saved on first persist only (expectedLen === 0)
 *   - Uses AI SDK createUIMessageStream (no custom SSE)
 *   - Per ASSISTANT_FINAL_REQUIRED: reconciles truncated text_delta events with assistant_final
 *   - Per STATUS_IS_EPHEMERAL: StatusEvent maps to transient data-status chunk, never persisted
 * Side-effects: IO (HTTP request/response, DB persistence)
 * Notes: P1 wire format — createUIMessageStream + createUIMessageStreamResponse (SSE). UIMessage accumulator is persistence-only.
 * Links: Uses ai.chat.v1 contract, completion.server facade, AI SDK streaming, ThreadPersistencePort
 * @public
 */

import { toUserId } from "@cogni/ids";
import type { UIMessage, UIMessageChunk } from "ai";
import { createUIMessageStream, createUIMessageStreamResponse } from "ai";
import { nanoid } from "nanoid";
import { NextResponse } from "next/server";
import { getSessionUser } from "@/app/_lib/auth/session";
import { getContainer } from "@/bootstrap/container";
import { wrapRouteHandlerWithLogging } from "@/bootstrap/http";
import {
  aiChatOperation,
  type ChatInput,
} from "@/contracts/ai.chat.v1.contract";
import { isAccountsFeatureError } from "@/features/accounts/public";
import {
  redactSecretsInMessages,
  uiMessagesToMessageDtos,
} from "@/features/ai/public.server";
import { isInsufficientCreditsPortError, ThreadConflictError } from "@/ports";
import {
  aiChatStreamDurationMs,
  logRequestWarn,
  type RequestContext,
} from "@/shared/observability";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Local error handler for chat route.
 * Maps domain errors to HTTP responses; returns null for unhandled errors.
 */
function handleRouteError(
  ctx: RequestContext,
  error: unknown,
  model?: string
): NextResponse | null {
  // Zod validation errors
  if (error && typeof error === "object" && "issues" in error) {
    logRequestWarn(ctx.log, error, "VALIDATION_ERROR");
    return NextResponse.json(
      { error: "Invalid input format" },
      { status: 400 }
    );
  }

  // Thread conflict (optimistic concurrency)
  if (error instanceof ThreadConflictError) {
    logRequestWarn(ctx.log, error, "THREAD_CONFLICT");
    return NextResponse.json(
      { error: "Thread conflict — please retry" },
      { status: 409 }
    );
  }

  // Port-level credit errors (thrown directly by PreflightCreditCheckDecorator
  // during stream iteration — not mapped to feature errors by the facade in
  // the streaming path)
  if (isInsufficientCreditsPortError(error)) {
    logRequestWarn(ctx.log, error, "INSUFFICIENT_CREDITS");
    return NextResponse.json(
      { error: "Insufficient credits" },
      { status: 402 }
    );
  }

  // Accounts feature errors
  if (isAccountsFeatureError(error)) {
    if (error.kind === "INSUFFICIENT_CREDITS") {
      logRequestWarn(ctx.log, error, "INSUFFICIENT_CREDITS");
      return NextResponse.json(
        { error: "Insufficient credits" },
        { status: 402 }
      );
    }
    if (error.kind === "BILLING_ACCOUNT_NOT_FOUND") {
      logRequestWarn(ctx.log, error, "BILLING_ACCOUNT_NOT_FOUND");
      return NextResponse.json({ error: "Account not found" }, { status: 403 });
    }
    if (error.kind === "VIRTUAL_KEY_NOT_FOUND") {
      logRequestWarn(ctx.log, error, "VIRTUAL_KEY_NOT_FOUND");
      return NextResponse.json(
        { error: "Virtual key not found" },
        { status: 403 }
      );
    }
    // Fallback for GENERIC
    logRequestWarn(ctx.log, error, "ACCOUNT_ERROR");
    return NextResponse.json(
      { error: error.kind === "GENERIC" ? error.message : "Account error" },
      { status: 400 }
    );
  }

  // LLM-specific errors
  if (error instanceof Error) {
    if (
      error.message.includes("MESSAGE_TOO_LONG") ||
      error.message.includes("INVALID_CONTENT")
    ) {
      logRequestWarn(ctx.log, error, "MESSAGE_VALIDATION_ERROR");
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (
      error.message.includes("timeout") ||
      error.message.includes("AbortError")
    ) {
      logRequestWarn(ctx.log, error, "REQUEST_TIMEOUT");
      return NextResponse.json({ error: "Request timeout" }, { status: 408 });
    }
    if (error.message.includes("LiteLLM API error: 429")) {
      logRequestWarn(ctx.log, error, "RATE_LIMIT_EXCEEDED");
      return NextResponse.json(
        { error: "Rate limit exceeded" },
        { status: 429 }
      );
    }
    if (
      error.message.includes("LiteLLM API error: 404") ||
      error.message.includes("No endpoints found")
    ) {
      logRequestWarn(ctx.log, error, "MODEL_UNAVAILABLE");
      return NextResponse.json(
        { code: "MODEL_UNAVAILABLE", model },
        { status: 409 }
      );
    }
    if (error.message.includes("LiteLLM")) {
      logRequestWarn(ctx.log, error, "LLM_SERVICE_UNAVAILABLE");
      return NextResponse.json(
        { error: "AI service temporarily unavailable" },
        { status: 503 }
      );
    }
  }

  return null; // Unhandled → let wrapper catch as 500
}

export const POST = wrapRouteHandlerWithLogging(
  { routeId: "ai.chat", auth: { mode: "required", getSessionUser } },
  async (ctx, request, sessionUser) => {
    let input: ChatInput | undefined;
    try {
      // Parse JSON body
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return NextResponse.json(
          { error: "Invalid JSON body" },
          { status: 400 }
        );
      }

      // Validate input with contract (safeParse for better error handling)
      const inputParseResult = aiChatOperation.input.safeParse(body);
      if (!inputParseResult.success) {
        logRequestWarn(ctx.log, inputParseResult.error, "VALIDATION_ERROR");
        return NextResponse.json(
          {
            error: "Invalid input",
            details: inputParseResult.error.flatten(),
          },
          { status: 400 }
        );
      }
      input = inputParseResult.data;

      // --- CLIENT_SENDS_USER_ONLY: message comes directly from input ---
      const userText = input.message;

      const handlerStartMs = performance.now();

      // Validate model against cached allowlist (MVP-004: PERF-001 fix)
      const { isModelAllowed, getDefaults } = await import(
        "@/shared/ai/model-catalog.server"
      );
      const modelIsValid = await isModelAllowed(input.model);

      if (!modelIsValid) {
        const defaults = await getDefaults();
        logRequestWarn(
          ctx.log,
          {
            model: input.model,
            defaultModelId: defaults.defaultPreferredModelId,
          },
          "model_validation_failed"
        );
        return NextResponse.json(
          {
            error: "Invalid model",
            defaultModelId: defaults.defaultPreferredModelId,
          },
          { status: 409 }
        );
      }

      if (!sessionUser) throw new Error("sessionUser required");

      // --- stateKey lifecycle ---
      const stateKey = input.stateKey ?? nanoid(21);
      const userId = toUserId(sessionUser.id);
      const threadPersistence = getContainer().threadPersistenceForUser(userId);

      // --- Load authoritative thread from DB ---
      let existingThread = await threadPersistence.loadThread(
        sessionUser.id,
        stateKey
      );
      let expectedLen = existingThread.length;

      // Build user UIMessage
      const userUIMessage: UIMessage = {
        id: nanoid(),
        role: "user",
        parts: [{ type: "text" as const, text: userText }],
      };

      // --- Phase 1: persist user message before execution (optimistic) ---
      // Metadata (model, graphName) saved on INSERT only — first persist creates the thread row.
      const threadMetadata =
        expectedLen === 0
          ? { model: input.model, graphName: input.graphName }
          : undefined;

      let threadWithUser = [...existingThread, userUIMessage];
      try {
        await threadPersistence.saveThread(
          sessionUser.id,
          stateKey,
          redactSecretsInMessages(threadWithUser),
          expectedLen,
          threadMetadata
        );
      } catch (e) {
        if (!(e instanceof ThreadConflictError)) throw e;
        // Retry once: reload + re-append
        existingThread = await threadPersistence.loadThread(
          sessionUser.id,
          stateKey
        );
        expectedLen = existingThread.length;
        threadWithUser = [...existingThread, userUIMessage];
        await threadPersistence.saveThread(
          sessionUser.id,
          stateKey,
          redactSecretsInMessages(threadWithUser),
          expectedLen,
          expectedLen === 0 ? threadMetadata : undefined
        );
        // If this throws ThreadConflictError again, handleRouteError catches → 409
      }
      const expectedLenAfterUser = threadWithUser.length;

      ctx.log.info(
        {
          reqId: ctx.reqId,
          userId: sessionUser.id,
          requestedModel: input.model,
          threadMessages: expectedLenAfterUser,
          stateKey,
        },
        "ai.chat_received"
      );

      // --- Convert persisted thread → DTOs for execution ---
      const { completionStream } = await import(
        "@/app/_facades/ai/completion.server"
      );
      const messageDtos = uiMessagesToMessageDtos(threadWithUser);

      const streamStartMs = performance.now();

      const { stream: deltaStream, final } = await completionStream(
        {
          messages: messageDtos,
          model: input.model,
          sessionUser,
          abortSignal: request.signal,
          graphName: input.graphName,
          stateKey,
        },
        ctx
      );

      ctx.log.info(
        {
          reqId: ctx.reqId,
          handlerMs: performance.now() - handlerStartMs,
          resolvedModel: input.model,
          stream: true,
        },
        "ai.chat_response_started"
      );

      // --- Persistence accumulator (outer scope — survives stream lifecycle) ---
      // Per PERSIST_AFTER_PUMP: written by stream callback, read by detached persist.
      let accumulatedText = "";
      let assistantFinalContent: string | undefined;
      const accToolParts: Array<{
        toolCallId: string;
        toolName: string;
        input: unknown;
        output?: unknown;
        state: "input-available" | "output-available";
      }> = [];
      const toolPartIndexByCallId = new Map<string, number>();
      let resolvePumpDone!: () => void;
      const pumpDone = new Promise<void>((r) => {
        resolvePumpDone = r;
      });

      // --- Stream response via AI SDK Data Stream Protocol (SSE) ---
      const textPartId = nanoid();
      let textBlockOpen = false;

      const uiStream = createUIMessageStream({
        execute: async ({ writer }) => {
          try {
            let eventSeq = 0;

            for await (const event of deltaStream) {
              if (request.signal.aborted) break;
              eventSeq++;

              if (event.type === "text_delta") {
                accumulatedText += event.delta;
                if (!textBlockOpen) {
                  writer.write({ type: "text-start", id: textPartId });
                  textBlockOpen = true;
                }
                writer.write({
                  type: "text-delta",
                  delta: event.delta,
                  id: textPartId,
                });
              } else if (event.type === "assistant_final") {
                assistantFinalContent = event.content;
                ctx.log.debug(
                  {
                    seq: eventSeq,
                    accLen: accumulatedText.length,
                    finalLen: event.content.length,
                  },
                  "ai.chat_assistant_final_received"
                );
              } else if (event.type === "tool_call_start") {
                // Close text block before tool call
                if (textBlockOpen) {
                  writer.write({ type: "text-end", id: textPartId });
                  textBlockOpen = false;
                }

                ctx.log.info(
                  { toolCallId: event.toolCallId, toolName: event.toolName },
                  "tool_call_start received"
                );

                writer.write({
                  type: "tool-input-start",
                  toolCallId: event.toolCallId,
                  toolName: event.toolName,
                } as UIMessageChunk);

                if (event.args != null) {
                  writer.write({
                    type: "tool-input-available",
                    toolCallId: event.toolCallId,
                    toolName: event.toolName,
                    input: event.args,
                  } as UIMessageChunk);
                }

                // Accumulator: track tool call for persistence
                const idx = accToolParts.length;
                accToolParts.push({
                  toolCallId: event.toolCallId,
                  toolName: event.toolName,
                  input: event.args ?? {},
                  state: "input-available",
                });
                toolPartIndexByCallId.set(event.toolCallId, idx);
              } else if (event.type === "tool_call_result") {
                writer.write({
                  type: "tool-output-available",
                  toolCallId: event.toolCallId,
                  output: event.result,
                } as UIMessageChunk);

                ctx.log.info(
                  { toolCallId: event.toolCallId },
                  "tool_call_result completed"
                );

                // Accumulator: update tool part with result
                const partIdx = toolPartIndexByCallId.get(event.toolCallId);
                if (partIdx !== undefined) {
                  const part = accToolParts[partIdx];
                  if (!part) continue;
                  part.output = event.result;
                  part.state = "output-available";
                }
              } else if (event.type === "status") {
                // STATUS_IS_EPHEMERAL: transient data part, never persisted in UIMessage
                // STATUS_BEST_EFFORT: safe to skip if stream is backpressured
                writer.write({
                  type: "data-status",
                  data: {
                    phase: event.phase,
                    ...(event.label ? { label: event.label } : {}),
                  },
                  transient: true,
                } as UIMessageChunk);
              }
            }

            // Reconcile: if assistant_final has text beyond what deltas delivered,
            // append the remainder.
            if (
              assistantFinalContent !== undefined &&
              assistantFinalContent.length > accumulatedText.length &&
              assistantFinalContent.startsWith(accumulatedText)
            ) {
              const remainder = assistantFinalContent.slice(
                accumulatedText.length
              );
              ctx.log.info(
                {
                  accLen: accumulatedText.length,
                  finalLen: assistantFinalContent.length,
                  remainderLen: remainder.length,
                },
                "ai.chat_reconcile_appending_remainder"
              );
              if (!textBlockOpen) {
                writer.write({ type: "text-start", id: textPartId });
                textBlockOpen = true;
              }
              writer.write({
                type: "text-delta",
                delta: remainder,
                id: textPartId,
              });
            } else if (
              assistantFinalContent !== undefined &&
              assistantFinalContent !== accumulatedText &&
              !assistantFinalContent.startsWith(accumulatedText)
            ) {
              ctx.log.warn(
                {
                  accLen: accumulatedText.length,
                  finalLen: assistantFinalContent.length,
                  accTail: accumulatedText.slice(-40),
                  finalTail: assistantFinalContent.slice(-40),
                },
                "ai.chat_reconcile_content_diverged"
              );
            }

            if (
              assistantFinalContent === undefined &&
              accumulatedText.length > 0
            ) {
              ctx.log.error(
                {
                  accLen: accumulatedText.length,
                  eventCount: eventSeq,
                },
                "ai.chat_assistant_final_missing — ASSISTANT_FINAL_REQUIRED violated"
              );
            }

            // Close text block if still open
            if (textBlockOpen) {
              writer.write({ type: "text-end", id: textPartId });
              textBlockOpen = false;
            }

            // Flush barrier
            await new Promise((r) => setTimeout(r, 0));

            // Wait for final result (billing) with 15s timeout
            const FINAL_TIMEOUT_MS = 15000;
            const finalTimeout = new Promise<{ ok: false; error: "timeout" }>(
              (resolve) =>
                setTimeout(
                  () => resolve({ ok: false, error: "timeout" }),
                  FINAL_TIMEOUT_MS
                )
            );

            const result = await Promise.race([final, finalTimeout]);

            if (result.ok) {
              // AI SDK uiMessageChunkSchema uses z.strictObject for finish —
              // only finishReason and messageMetadata are allowed (no usage).
              writer.write({
                type: "finish",
                finishReason: result.finishReason as
                  | "stop"
                  | "length"
                  | "tool-calls"
                  | "content-filter"
                  | "other"
                  | "error",
              });
            } else {
              ctx.log.warn(
                { reqId: ctx.reqId, error: result.error },
                "ai.chat_stream_final_error"
              );
              writer.write({
                type: "error",
                errorText: `Stream finalization failed: ${result.error}`,
              });
            }
          } catch (error) {
            if (error instanceof Error && error.name === "AbortError") {
              ctx.log.info({ reqId: ctx.reqId }, "ai.chat_client_aborted");
            } else {
              ctx.log.error({ err: error }, "Stream error in route");
              throw error;
            }
          } finally {
            const streamMs = performance.now() - streamStartMs;
            aiChatStreamDurationMs.observe(streamMs);
            ctx.log.info(
              { reqId: ctx.reqId, streamMs },
              "ai.chat_stream_closed"
            );
            resolvePumpDone();
          }
        },
      });

      // --- Phase 2: persist assistant message after pump (disconnect-safe) ---
      // Detached from stream lifecycle — client disconnect cannot prevent this.
      const persistAfterPump = pumpDone.then(async () => {
        const finalText = assistantFinalContent ?? accumulatedText;
        if (!finalText && accToolParts.length === 0) {
          ctx.log.warn({ stateKey }, "ai.thread_persist_skipped — no content");
          return;
        }

        const responseParts: UIMessage["parts"] = [];
        if (finalText) {
          responseParts.push({ type: "text" as const, text: finalText });
        }
        for (const tp of accToolParts) {
          responseParts.push({
            type: "dynamic-tool",
            toolCallId: tp.toolCallId,
            toolName: tp.toolName,
            state: tp.state,
            input: tp.input,
            ...(tp.output !== undefined ? { output: tp.output } : {}),
          } as UIMessage["parts"][number]);
        }

        const assistantUIMessage: UIMessage = {
          id: nanoid(),
          role: "assistant",
          parts: responseParts,
        };

        try {
          const fullThread = [...threadWithUser, assistantUIMessage];
          await threadPersistence.saveThread(
            sessionUser.id,
            stateKey,
            redactSecretsInMessages(fullThread),
            expectedLenAfterUser
          );
          ctx.log.info(
            { stateKey, messageCount: fullThread.length },
            "ai.thread_persisted"
          );
        } catch (persistErr) {
          if (persistErr instanceof ThreadConflictError) {
            try {
              const reloaded = await threadPersistence.loadThread(
                sessionUser.id,
                stateKey
              );
              const retryThread = [...reloaded, assistantUIMessage];
              await threadPersistence.saveThread(
                sessionUser.id,
                stateKey,
                redactSecretsInMessages(retryThread),
                reloaded.length
              );
              ctx.log.info(
                { stateKey, messageCount: retryThread.length },
                "ai.thread_persisted (retry)"
              );
            } catch (retryErr) {
              ctx.log.error(
                { err: retryErr, stateKey },
                "ai.thread_persist_retry_failed"
              );
            }
          } else {
            ctx.log.error(
              { err: persistErr, stateKey },
              "ai.thread_persist_failed"
            );
          }
        }
      });
      persistAfterPump.catch((err) =>
        ctx.log.error({ err, stateKey }, "ai.thread_persist_unhandled")
      );

      // Return SSE response with stateKey header for thread continuity
      // Wrap in NextResponse: createUIMessageStreamResponse returns Response,
      // but wrapRouteHandlerWithLogging expects NextResponse.
      const sseResponse = createUIMessageStreamResponse({
        stream: uiStream,
        headers: { "X-State-Key": stateKey },
      });
      return new NextResponse(sseResponse.body, {
        status: sseResponse.status,
        headers: sseResponse.headers,
      });
    } catch (error) {
      const errorResponse = handleRouteError(ctx, error, input?.model);
      if (errorResponse) return errorResponse;
      throw error; // Unhandled → wrapper catches
    }
  }
);
