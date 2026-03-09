// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@contracts/ai.chat.v1.contract`
 * Purpose: Chat API contract for AI SDK streaming integration.
 * Scope: Wire format definition. Client sends a single user message string; server streams UIMessageChunks via SSE. Does not contain business logic or message transformations.
 * Invariants: Contract remains stable; breaking changes require new version. All consumers use z.infer types.
 * Side-effects: none
 * Notes: P1 wire format — client sends { message } instead of { messages[] }. Server responds with AI SDK Data Stream Protocol (SSE).
 * Links: Used by /api/v1/ai/chat route and chat runtime provider
 * @internal
 */

import { z } from "zod";

/** Max user message length (matches route-level MAX_USER_TEXT_CHARS) */
const MAX_USER_MESSAGE_CHARS = 16_000;

/** Max text part length for output schema */
const MAX_MESSAGE_CHARS = 100_000;

/** Max ID length (toolCallId, message id, requestId) */
const MAX_ID_CHARS = 128;

/**
 * Max stateKey length - app-level conversation routing key.
 * Tightened in P0 to match nanoid(21) output charset.
 */
const MAX_STATE_KEY_CHARS = 128;

/**
 * Safe character pattern for stateKey - prevents log injection.
 * Matches nanoid(21) output charset: [A-Za-z0-9_-].
 */
const STATE_KEY_SAFE_PATTERN = /^[a-zA-Z0-9_-]+$/;

/**
 * Text content part - standard message text (output schema).
 */
const TextPartSchema = z.object({
  type: z.literal("text"),
  text: z.string().max(MAX_MESSAGE_CHARS),
});

// Output schema part alias
const ChatMessagePartSchema = TextPartSchema;

/**
 * Base message schema for output
 * - id: client or server generated UUID (bounded)
 * - role: user or assistant (no system from client)
 * - createdAt: ISO 8601 datetime
 * - content: array of message parts
 * - requestId: optional, only present on assistant messages from server
 */
export const ChatMessageSchema = z.object({
  id: z.string().max(MAX_ID_CHARS),
  role: z.enum(["user", "assistant"]),
  createdAt: z.string().datetime(),
  content: z.array(ChatMessagePartSchema),
  requestId: z.string().max(MAX_ID_CHARS).optional(),
});

/**
 * Chat input schema — P1 (AI SDK Data Stream Protocol).
 * Client sends a single user message text string.
 * Server loads authoritative thread from DB; client never sends history.
 */
export const AssistantUiInputSchema = z.object({
  /** The user's message text */
  message: z.string().min(1).max(MAX_USER_MESSAGE_CHARS),
  /** Model ID */
  model: z.string(),
  /** Graph name or fully-qualified graphId to execute (required) */
  graphName: z.string(),
  /**
   * Conversation state key for multi-turn conversations.
   * If absent, server generates one and returns it via X-State-Key header.
   * Client should reuse for subsequent messages in same conversation.
   * Must contain only safe characters: alphanumeric, underscores, hyphens.
   * Note: This is an app-level key, NOT a provider-specific thread_id.
   */
  stateKey: z
    .string()
    .max(MAX_STATE_KEY_CHARS)
    .regex(STATE_KEY_SAFE_PATTERN, "stateKey must contain only safe characters")
    .optional(),
});

export const aiChatOperation = {
  id: "ai.chat.v1",
  summary: "Chat with AI via AI SDK streaming",
  description:
    "Send a user message and receive streaming responses via AI SDK Data Stream Protocol (SSE)",
  input: AssistantUiInputSchema,
  output: z.object({
    /** Echo back stateKey for client reuse */
    stateKey: z.string(),
    /** Assistant message with server-assigned requestId for billing reference */
    message: ChatMessageSchema.required({ requestId: true }),
  }),
} as const;

// Export inferred types - all consumers MUST use these, never manual interfaces
export type ChatMessage = z.infer<typeof ChatMessageSchema>;
export type ChatInput = z.infer<typeof aiChatOperation.input>;
export type ChatOutput = z.infer<typeof aiChatOperation.output>;
