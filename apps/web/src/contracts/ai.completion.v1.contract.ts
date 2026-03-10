// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@contracts/ai.completion.v1.contract`
 * Purpose: External API contract for AI completion with DTOs that isolate internal types.
 * Scope: Edge IO definition with schema validation. Does not contain business logic.
 * Invariants: Contract remains stable; breaking changes require new version.
 * Side-effects: none
 * Notes: Hard cap at schema level, client timestamps ignored.
 * Links: Used by HTTP routes for validation
 * @internal
 */

import { z } from "zod";

/** Input message length limit — caps client-submitted messages */
const MAX_INPUT_MESSAGE_CHARS = 4000;
/** Output message length limit — generous cap on LLM responses */
const MAX_OUTPUT_MESSAGE_CHARS = 65_536;

// DTOs that don't leak core internals
const InputMessageDtoSchema = z.object({
  /** No 'system' role allowed from client */
  role: z.enum(["user", "assistant"]),
  /** Hard cap enforced at schema level */
  content: z.string().max(MAX_INPUT_MESSAGE_CHARS),
  /** Client timestamp ignored - server sets timestamps */
  timestamp: z.string().optional(),
});

const OutputMessageDtoSchema = z.object({
  role: z.enum(["user", "assistant"]),
  /** LLM responses may be much longer than client input */
  content: z.string().max(MAX_OUTPUT_MESSAGE_CHARS),
  /** Always present in response */
  timestamp: z.string(),
  /** Request ID for billing reference */
  requestId: z.string(),
});

export const aiCompletionOperation = {
  id: "ai.completion.v1",
  summary: "Chat completion via AI",
  description: "Send messages to AI and receive completion response",
  input: z.object({
    messages: z.array(InputMessageDtoSchema),
    /** Model ID (REQUIRED) - client resolves to defaultModelId if needed */
    model: z.string(),
    /** Graph name or fully-qualified graphId to execute (required) */
    graphName: z.string(),
  }),
  output: z.object({
    message: OutputMessageDtoSchema,
  }),
} as const;
