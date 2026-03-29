---
id: task.0232
type: task
title: "Token-aware context management for thread persistence"
status: needs_design
priority: 2
rank: 2
estimate: 3
summary: Replace 200-message hard cap with token-counting truncation to prevent context overflow and silent context loss
outcome: Long conversations stay within model context window automatically, preserving most-recent and system messages
spec_refs:
assignees:
credit:
project:
branch:
pr:
reviewer:
created: 2026-03-29
updated: 2026-03-29
labels: [agents, memory, reliability]
external_refs: [spike.0231]
revision: 0
blocked_by:
deploy_verified: false
---

# Token-Aware Context Management

## Problem

`thread-persistence.adapter.ts` enforces `MAX_THREAD_MESSAGES = 200` — a hard message count cap. This fails in two ways:

1. **Context overflow:** 200 long messages can exceed model context window → LLM API error
2. **Silent context loss:** Short conversations hit 200 messages and lose early context that may be critical

Dify solves this with `TokenBufferMemory` (`api/core/memory/token_buffer_memory.py`) — token-aware truncation with configurable limits.

## Design

### Invariants

- **SYSTEM_PROMPT_PRESERVED**: System prompt messages are never truncated
- **NEWEST_WINS**: When truncating, remove oldest non-system messages first
- **TOKEN_BUDGET**: `model_context_window - reserve` where reserve = tool schemas + system prompt + response buffer
- **THREAD_PERSISTENCE_IS_SEAM**: All truncation logic lives in the persistence layer, transparent to graphs

### Approach

1. Add a `countTokens(messages: Message[]): number` utility
   - Use tiktoken (`cl100k_base` for GPT-4 class, `o200k_base` for newer) or LiteLLM's `/utils/token_counter` endpoint
   - Cache tokenizer instance (singleton, thread-safe)

2. Modify `loadThread()` in `DrizzleThreadPersistenceAdapter`:
   - After loading messages, compute total tokens
   - If over budget: keep system messages + most recent messages that fit within budget
   - Return truncated array with a synthetic "context truncated" system message if any messages were dropped

3. Token budget calculation:
   - Read model context window from LiteLLM model info or config
   - Reserve: ~4000 tokens for tool schemas, ~2000 for response buffer
   - Remaining budget = context_window - reserve

### Files to Modify

| File | Change |
|---|---|
| `apps/web/src/adapters/server/ai/thread-persistence.adapter.ts` | Add truncation in `loadThread()` |
| `packages/ai-core/src/tokens/` (new) | Token counting utility |

### Validation

- Unit test: 200 short messages → no truncation
- Unit test: 50 long messages exceeding budget → oldest truncated, system preserved
- Unit test: system messages never removed regardless of position
- Stack test: Long conversation stays under context window
