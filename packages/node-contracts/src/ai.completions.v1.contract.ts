// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@contracts/ai.completions.v1.contract`
 * Purpose: OpenAI-compatible Chat Completions API contract (POST /v1/chat/completions).
 * Scope: Edge IO definition with schema validation matching OpenAI spec. Does not contain business logic.
 * Invariants:
 *   - Request/response shapes match OpenAI Chat Completions API
 *   - Extension fields (graph_name) are optional and namespaced to avoid conflicts
 *   - Contract remains stable; breaking changes require new version
 * Side-effects: none
 * Notes: See https://platform.openai.com/docs/api-reference/chat/create
 * Links: Used by HTTP routes for validation
 * @public
 */

import { z } from "zod";

/** Input message length limit — caps client-submitted messages */
const MAX_INPUT_MESSAGE_CHARS = 4_000;

// ─────────────────────────────────────────────────────────────────────────────
// Request: Messages
// ─────────────────────────────────────────────────────────────────────────────

const SystemMessageSchema = z.object({
  role: z.literal("system"),
  content: z.string().max(MAX_INPUT_MESSAGE_CHARS),
  name: z.string().optional(),
});

const UserMessageSchema = z.object({
  role: z.literal("user"),
  content: z.string().max(MAX_INPUT_MESSAGE_CHARS),
  name: z.string().optional(),
});

const ToolCallFunctionSchema = z.object({
  name: z.string(),
  arguments: z.string(),
});

const ToolCallSchema = z.object({
  id: z.string(),
  type: z.literal("function"),
  function: ToolCallFunctionSchema,
});

const AssistantMessageSchema = z.object({
  role: z.literal("assistant"),
  content: z.string().nullish(),
  name: z.string().optional(),
  tool_calls: z.array(ToolCallSchema).optional(),
});

const ToolMessageSchema = z.object({
  role: z.literal("tool"),
  content: z.string(),
  tool_call_id: z.string(),
});

const ChatMessageSchema = z.discriminatedUnion("role", [
  SystemMessageSchema,
  UserMessageSchema,
  AssistantMessageSchema,
  ToolMessageSchema,
]);

// ─────────────────────────────────────────────────────────────────────────────
// Request: Tools
// ─────────────────────────────────────────────────────────────────────────────

const FunctionDefinitionSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  parameters: z.record(z.string(), z.unknown()).optional(),
  strict: z.boolean().optional(),
});

const ToolDefinitionSchema = z.object({
  type: z.literal("function"),
  function: FunctionDefinitionSchema,
});

const ToolChoiceSchema = z.union([
  z.enum(["auto", "none", "required"]),
  z.object({
    type: z.literal("function"),
    function: z.object({ name: z.string() }),
  }),
]);

// ─────────────────────────────────────────────────────────────────────────────
// Request: Response format
// ─────────────────────────────────────────────────────────────────────────────

const ResponseFormatSchema = z.union([
  z.object({ type: z.literal("text") }),
  z.object({ type: z.literal("json_object") }),
  z.object({
    type: z.literal("json_schema"),
    json_schema: z.object({
      name: z.string(),
      description: z.string().optional(),
      strict: z.boolean().optional(),
      schema: z.record(z.string(), z.unknown()),
    }),
  }),
]);

// ─────────────────────────────────────────────────────────────────────────────
// Request: Stream options
// ─────────────────────────────────────────────────────────────────────────────

const StreamOptionsSchema = z
  .object({
    include_usage: z.boolean().optional(),
  })
  .nullable();

// ─────────────────────────────────────────────────────────────────────────────
// Request: Full input schema
// ─────────────────────────────────────────────────────────────────────────────

const ChatCompletionInputSchema = z.object({
  /** Model ID (required) */
  model: z.string(),
  /** Conversation messages */
  messages: z.array(ChatMessageSchema),
  /** Sampling temperature (0-2) */
  temperature: z.number().min(0).max(2).optional(),
  /** Nucleus sampling (0-1) */
  top_p: z.number().min(0).max(1).optional(),
  /** Number of choices to generate */
  n: z.number().int().min(1).max(1).optional(),
  /** Enable SSE streaming */
  stream: z.boolean().optional(),
  /** Stream options (only when stream: true) */
  stream_options: StreamOptionsSchema.optional(),
  /** Stop sequences */
  stop: z
    .union([z.string(), z.array(z.string()).max(4)])
    .nullable()
    .optional(),
  /** Max tokens (deprecated, use max_completion_tokens) */
  max_tokens: z.number().int().positive().optional(),
  /** Max completion tokens */
  max_completion_tokens: z.number().int().positive().optional(),
  /** Presence penalty (-2 to 2) */
  presence_penalty: z.number().min(-2).max(2).optional(),
  /** Frequency penalty (-2 to 2) */
  frequency_penalty: z.number().min(-2).max(2).optional(),
  /** Logit bias map */
  logit_bias: z.record(z.string(), z.number()).nullable().optional(),
  /** End-user identifier */
  user: z.string().optional(),
  /** Tool definitions */
  tools: z.array(ToolDefinitionSchema).optional(),
  /** Tool choice policy */
  tool_choice: ToolChoiceSchema.optional(),
  /** Response format */
  response_format: ResponseFormatSchema.optional(),
  /** Seed for deterministic sampling */
  seed: z.number().int().optional(),

  // ── Extension fields (not in OpenAI spec) ────────────────────────────
  /** Graph name or fully-qualified graphId for routing (extension) */
  graph_name: z.string().optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Response: Non-streaming (ChatCompletion)
// ─────────────────────────────────────────────────────────────────────────────

const ResponseMessageSchema = z.object({
  role: z.literal("assistant"),
  content: z.string().nullable(),
  tool_calls: z.array(ToolCallSchema).optional(),
  refusal: z.string().nullable().optional(),
});

const ChoiceSchema = z.object({
  index: z.number().int(),
  message: ResponseMessageSchema,
  finish_reason: z.enum(["stop", "length", "tool_calls", "content_filter"]),
  logprobs: z.unknown().nullable().optional(),
});

const UsageSchema = z.object({
  prompt_tokens: z.number().int(),
  completion_tokens: z.number().int(),
  total_tokens: z.number().int(),
});

const ChatCompletionOutputSchema = z.object({
  id: z.string(),
  object: z.literal("chat.completion"),
  created: z.number().int(),
  model: z.string(),
  choices: z.array(ChoiceSchema),
  usage: UsageSchema,
  system_fingerprint: z.string().nullable().optional(),
  service_tier: z.string().nullable().optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Response: Streaming (ChatCompletionChunk)
// ─────────────────────────────────────────────────────────────────────────────

const DeltaSchema = z.object({
  role: z.enum(["assistant"]).optional(),
  content: z.string().nullable().optional(),
  tool_calls: z
    .array(
      z.object({
        index: z.number().int(),
        id: z.string().optional(),
        type: z.literal("function").optional(),
        function: z
          .object({
            name: z.string().optional(),
            arguments: z.string().optional(),
          })
          .optional(),
      })
    )
    .optional(),
});

const ChunkChoiceSchema = z.object({
  index: z.number().int(),
  delta: DeltaSchema,
  finish_reason: z
    .enum(["stop", "length", "tool_calls", "content_filter"])
    .nullable(),
  logprobs: z.unknown().nullable().optional(),
});

/** Extension: agent activity status indicator (per STATUS_IS_EPHEMERAL). */
const CogniStatusSchema = z
  .object({
    phase: z.enum(["thinking", "tool_use", "compacting"]),
    label: z.string().optional(),
  })
  .optional();

const ChatCompletionChunkSchema = z.object({
  id: z.string(),
  object: z.literal("chat.completion.chunk"),
  created: z.number().int(),
  model: z.string(),
  choices: z.array(ChunkChoiceSchema),
  usage: UsageSchema.nullable().optional(),
  system_fingerprint: z.string().nullable().optional(),
  service_tier: z.string().nullable().optional(),
  /** Extension: agent activity phase (additive, never breaks OpenAI compat). */
  cogni_status: CogniStatusSchema,
});

// ─────────────────────────────────────────────────────────────────────────────
// Error response (OpenAI format)
// ─────────────────────────────────────────────────────────────────────────────

const ErrorResponseSchema = z.object({
  error: z.object({
    message: z.string(),
    type: z.string(),
    param: z.string().nullable(),
    code: z.string().nullable(),
  }),
});

// ─────────────────────────────────────────────────────────────────────────────
// Export
// ─────────────────────────────────────────────────────────────────────────────

export const chatCompletionsContract = {
  id: "chat.completions.v1",
  summary: "OpenAI-compatible Chat Completions API",
  description:
    "Create a model response for the given chat conversation. Supports streaming.",
  input: ChatCompletionInputSchema,
  output: ChatCompletionOutputSchema,
  chunk: ChatCompletionChunkSchema,
  error: ErrorResponseSchema,
} as const;

// ── Inferred types ──────────────────────────────────────────────────────────

export type ChatCompletionInput = z.infer<typeof ChatCompletionInputSchema>;
export type ChatCompletionOutput = z.infer<typeof ChatCompletionOutputSchema>;
export type ChatCompletionChunk = z.infer<typeof ChatCompletionChunkSchema>;
export type CogniStatus = z.infer<typeof CogniStatusSchema>;
export type ChatCompletionError = z.infer<typeof ErrorResponseSchema>;
export type ChatMessage = z.infer<typeof ChatMessageSchema>;
export type ToolCall = z.infer<typeof ToolCallSchema>;
export type Usage = z.infer<typeof UsageSchema>;
