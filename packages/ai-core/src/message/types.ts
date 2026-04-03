// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/ai-core/message`
 * Purpose: Canonical LLM message types — the standard input/output shape for model calls.
 * Scope: Provider-agnostic message types (OpenAI, Anthropic, etc. all use role+content). Does not include thread state, DB metadata, or UI concerns.
 * Invariants: SINGLE_SOURCE_OF_TRUTH — these are the canonical message definitions
 * Side-effects: none
 * Links: nodes/operator/app/src/core/chat/model.ts (re-exports for backward compat)
 * @public
 */

/**
 * Tool call embedded in assistant message.
 * Represents a request from the LLM to invoke a tool.
 */
export interface MessageToolCall {
  /** Unique ID for this tool call (model-provided) */
  readonly id: string;
  /** Tool name (snake_case) */
  readonly name: string;
  /** JSON-encoded arguments string */
  readonly arguments: string;
}

export interface Message {
  role: MessageRole;
  content: string;
  /** ISO 8601 string, optional - set by feature layer */
  timestamp?: string;
  /** Tool calls requested by assistant (present when role="assistant" and LLM wants to use tools) */
  toolCalls?: MessageToolCall[];
  /** Tool call ID this message responds to (present when role="tool") */
  toolCallId?: string;
}

export type MessageRole = "user" | "assistant" | "system" | "tool";
