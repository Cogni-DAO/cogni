---
id: "handoff-task.0078-20260217"
type: handoff
work_item_id: task.0078
status: active
created: 2026-02-17
updated: 2026-02-17
branch: feat/openclaw-thinking-streaming
last_commit: b61c4e4e
---

# Handoff: OpenClaw reasoning token streaming

## Context

- OpenClaw extracts reasoning/thinking tokens from models (DeepSeek, Claude, Gemini) with three modes: `"off"`, `"on"`, `"stream"`. Currently Cogni does not configure `reasoningLevel` on the session, so reasoning is hidden.
- assistant-ui provides a built-in `Reasoning` component that renders AI SDK `reasoning` parts as collapsible "Thought for N seconds" blocks — exactly like ChatGPT. No bespoke UI needed.
- task.0074 (Done, same branch) added phase indicators (`data-status` transient chunks: thinking/tool_use/compacting). This task adds actual reasoning TEXT display. They are complementary.
- The gateway protocol has `reasoningLevel` and `thinkingLevel` in its session schema, but it is **unverified** whether reasoning tokens reach WS clients. Step 1 is investigation.
- Hard rule: reasoning must NEVER be persisted in `ai_threads` or sent back to the model.

## Current State

- **task.0074 is Done** — StatusEvent pipeline committed: `packages/ai-core` StatusEvent, gateway client agent event consumption, provider pass-through, route `data-status` transient chunks, `verboseDefault: "full"` in gateway config
- **task.0078 is filed** — work item created at `work/items/task.0078.openclaw-reasoning-streaming.md` with full plan
- **No implementation started** for task.0078
- **Branch `feat/openclaw-thinking-streaming`** has task.0074 commits + task.0078 filing. Branch is forked from `fix/gov-schedules` (governance dashboard work) — consider rebasing onto `staging` before PR
- **`pnpm check` passes** on the branch as of last commit

## Decisions Made

- Use assistant-ui `Reasoning` component (`npx assistant-ui add reasoning`) — [assistant-ui docs](https://www.assistant-ui.com/docs/ui/Reasoning)
- Reasoning maps to AI SDK `reasoning-start`/`reasoning-delta`/`reasoning-end` stream protocol — standard, not bespoke
- `uiMessagesToMessageDtos()` already filters out reasoning parts (only maps `text` + `dynamic-tool`) — see `src/features/ai/services/mappers.ts:137`
- Route accumulator only tracks text + tool parts → reasoning never reaches DB — see `route.ts:318-327`
- `configureSession()` needs a new `reasoningLevel` param passed through `sessions.patch` — see `openclaw-gateway-client.ts:482`
- OpenClaw valid values: `"off" | "on" | "stream"` — set `"stream"` for real-time reasoning display

## Next Actions

- [ ] Investigate how reasoning tokens travel through gateway WS (send message to DeepSeek v3.2 with `reasoningLevel: "stream"` via sessions.patch, capture raw WS frames)
- [ ] Run `npx assistant-ui add reasoning` and wire into `AssistantMessage` in `thread.tsx`
- [ ] Add `reasoningLevel` param to `configureSession()` → `sessions.patch`
- [ ] Add reasoning event handling in gateway client WS message handler
- [ ] Map reasoning events through provider → route → AI SDK reasoning chunks
- [ ] Verify reasoning is NOT in persisted thread or model transcript
- [ ] `pnpm check` + manual test with DeepSeek v3.2

## Risks / Gotchas

- **Critical unknown**: It is unverified whether OpenClaw's gateway forwards reasoning tokens via WS. Internally, reasoning flows through `onReasoningStream` callbacks, not `emitAgentEvent()`. If reasoning doesn't reach WS clients, this may require an OpenClaw-side change or a different approach.
- **`verboseDefault` validation**: OpenClaw config accepts `"off" | "on" | "full"` only (not `"names"`). The previous incorrect value caused a container crash loop. Verify any new config values against OpenClaw's Zod schema at `openclaw/src/config/zod-schema.agent-defaults.ts`.
- **Branch contamination**: This branch includes governance dashboard commits (task.0070). Consider rebasing onto staging to isolate task.0078 changes before PR.
- **Reasoning vs status**: These are different concerns. Status events (task.0074) show agent phase labels. Reasoning (this task) shows model thinking text. Both should exist independently.

## Pointers

| File / Resource                                                        | Why it matters                                                                     |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `work/items/task.0078.openclaw-reasoning-streaming.md`                 | Full work item with plan and requirements                                          |
| `docs/spec/streaming-status.md`                                        | Governing spec — StatusEvent + reasoning pipeline                                  |
| `src/adapters/server/sandbox/openclaw-gateway-client.ts`               | Gateway WS client — add reasoning event handling + configureSession reasoningLevel |
| `src/adapters/server/sandbox/sandbox-graph.provider.ts:494`            | `configureSession()` call site — add reasoningLevel param                          |
| `src/app/api/v1/ai/chat/route.ts:342`                                  | Stream execute callback — emit reasoning-start/delta/end here                      |
| `src/features/ai/services/mappers.ts:137`                              | `uiMessagesToMessageDtos()` — verify reasoning filtered (already true)             |
| `src/components/vendor/assistant-ui/thread.tsx:232`                    | `AssistantMessage` — add Reasoning to MessagePrimitive.Parts components            |
| `/Users/derek/dev/openclaw/src/auto-reply/thinking.ts`                 | OpenClaw reasoning modes: `"off" \| "on" \| "stream"`                              |
| `/Users/derek/dev/openclaw/src/gateway/protocol/schema/sessions.ts:54` | Gateway sessions.patch schema — `thinkingLevel`, `reasoningLevel` fields           |
| `/Users/derek/dev/openclaw/src/agents/pi-embedded-subscribe.ts:524`    | OpenClaw reasoning stream callback — how reasoning is emitted internally           |
