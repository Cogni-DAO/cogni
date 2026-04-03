// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// SPDX-FileCopyrightText: 2025 Cogni-DAO

/**
 * Module: `@cogni/langgraph-graphs/tests/runtime/message-converters.test`
 * Purpose: Unit tests for toBaseMessage / fromBaseMessage converters.
 * Scope: Verifies tool messages require toolCallId and assistant messages preserve toolCalls. Does NOT test LangGraph integration.
 * Invariants: toolCallId required for tool messages, toolCalls preserved on assistant messages
 * Side-effects: none
 * Links: src/runtime/core/message-converters.ts
 * @internal
 */

import { AIMessage, ToolMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";
import { toBaseMessage } from "../../src/runtime/core/message-converters";

describe("toBaseMessage", () => {
  it("converts tool message with toolCallId", () => {
    const msg = {
      role: "tool" as const,
      content: '{"result": "ok"}',
      toolCallId: "call_abc123",
    };

    const result = toBaseMessage(msg);

    expect(result).toBeInstanceOf(ToolMessage);
    expect(result.content).toBe('{"result": "ok"}');
    expect((result as ToolMessage).tool_call_id).toBe("call_abc123");
  });

  it("throws when tool message lacks toolCallId", () => {
    const msg = {
      role: "tool" as const,
      content: '{"result": "ok"}',
      // no toolCallId
    };

    expect(() => toBaseMessage(msg)).toThrow(
      "Tool message requires toolCallId"
    );
  });

  it("converts assistant message with toolCalls", () => {
    const msg = {
      role: "assistant" as const,
      content: "",
      toolCalls: [
        { id: "call_abc123", name: "search", arguments: '{"q":"test"}' },
      ],
    };

    const result = toBaseMessage(msg);

    expect(result).toBeInstanceOf(AIMessage);
    const aiMsg = result as AIMessage;
    expect(aiMsg.tool_calls).toHaveLength(1);
    expect(aiMsg.tool_calls?.[0]).toMatchObject({
      id: "call_abc123",
      name: "search",
      args: { q: "test" },
    });
  });

  it("round-trips a tool conversation without error", () => {
    // Simulates the exact message sequence that caused the production crash:
    // user → assistant (with tool call) → tool result → user follow-up
    const messages = [
      { role: "user" as const, content: "What's my schedule?" },
      {
        role: "assistant" as const,
        content: "",
        toolCalls: [
          {
            id: "call_xyz",
            name: "core__schedule_list",
            arguments: "{}",
          },
        ],
      },
      {
        role: "tool" as const,
        content: '{"schedules":[]}',
        toolCallId: "call_xyz",
      },
      { role: "user" as const, content: "Create one for me" },
    ];

    // Should not throw — this is the exact sequence that crashed before the fix
    const converted = messages.map((m) => toBaseMessage(m));
    expect(converted).toHaveLength(4);
    expect(converted[2]).toBeInstanceOf(ToolMessage);
  });
});
