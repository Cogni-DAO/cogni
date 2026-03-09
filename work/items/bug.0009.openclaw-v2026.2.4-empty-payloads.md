---
id: bug.0009
type: bug
title: "Mock-LLM SSE streaming incompatible with OpenClaw pi-ai parser — gateway returns empty payloads"
status: needs_design
priority: 1
estimate: 1
summary: Mock-LLM's SSE streaming format causes pi-ai's for-await loop to produce zero iterations inside OpenClaw's embedded agent runtime. Real models (nemotron-nano-30b via OpenRouter) work perfectly. Blocks stack tests that depend on mock-llm.
outcome: Stack tests pass with mock-llm, or tests are reconfigured to use a real model for gateway E2E
spec_refs:
  - openclaw-sandbox-spec
project: proj.openclaw-capabilities
branch: feat/concurrent-openclaw
pr:
reviewer:
created: 2026-02-09
updated: 2026-02-10
labels: [openclaw, mock-llm, testing]
external_refs:
  - "OpenClaw image: openclaw-outbound-headers:latest (v2026.2.6-3)"
assignees: derekg1729
credit:
revision: 0
blocked_by:
deploy_verified: false
rank: 4
---

# Mock-LLM SSE streaming incompatible with OpenClaw pi-ai parser

## Root Cause (narrowed, not yet pinpointed)

**Not an OpenClaw bug. Not an nginx bug. Not an SDK params issue.** The full gateway pipeline works with real models through the full proxy chain (OpenClaw → nginx → LiteLLM → OpenRouter). The issue is specific to mock-llm's SSE output being consumed by OpenClaw's pi-ai agent runtime.

### What works

| Test                                                                                      | Backend                                          | Result                          |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------- |
| curl `stream:true` from inside container                                                  | mock-llm → LiteLLM → nginx                       | 59 chunks, 7950 chars           |
| OpenAI SDK v6.10.0 standalone                                                             | same                                             | 60 chunks, 7950 chars           |
| OpenAI SDK with pi-ai's extra params (`stream_options`, `store`, `max_completion_tokens`) | same                                             | 60 chunks, works                |
| pi-ai `streamSimple` standalone                                                           | same                                             | 56 events, 9824 chars           |
| **OpenClaw agent runtime**                                                                | **nemotron-nano-30b (real, through full proxy)** | **38 text_delta, full content** |

### What fails

| Test                       | Backend      | Result                                      |
| -------------------------- | ------------ | ------------------------------------------- |
| **OpenClaw agent runtime** | **mock-llm** | **content: [], usage: {input:0, output:0}** |

### The interaction effect

This is a mock-llm × agent-runtime interaction. Neither component is broken alone:

- agent runtime + real model = works
- pi-ai + mock-llm = works (standalone)
- **agent runtime + mock-llm = fails**

### Disproven hypotheses

1. **Pi-ai compat params** — SDK works with all extra params (`stream_options`, `store`, `max_completion_tokens`). Not the cause.
2. **OpenClaw version** — Rebuilt to v2026.2.6-3, same behavior. Version was never the issue.
3. **nginx proxy** — Same proxy chain works with real models.
4. **Mock-llm SSE format** — Standard OpenAI-compatible SSE with proper headers and `[DONE]` terminator. pi-ai parses it fine standalone.

### Previous test assertions were masking the bug

The gateway config had `"primary": "cogni/nemotron-nano-30b"` but LiteLLM test config only has mock models. LiteLLM returned 400 "Invalid model name". OpenClaw captured the **error message as assistant text**. The test only checked `chatFinal.text.length > 0`, so it passed on error content. Assertions have been tightened (2026-02-10).

### Remaining investigation

The gap is between pi-ai `streamSimple` (works) and OpenClaw's agent runtime subscription handler (fails). Likely candidates:

1. **Timing/race condition** — mock-llm responds in ~50ms (all chunks at once). Real models stream slowly over seconds. The agent runtime's `handleMessageUpdate` subscription handler may not consume events before the stream completes.
2. **`stripBlockTags` / content filtering** — OpenClaw's subscription handler (`pi-embedded-subscribe.handlers.messages.ts`) has `shouldSkipAssistantText()` and `stripBlockTags()` that could silently discard content.
3. **`enforceFinalTag` default** — If enabled for unknown providers, all text outside `<final>` tags is discarded. Mock-llm doesn't produce `<final>` tags.

## Reproduction

```bash
# Fails (mock-llm backend):
# Config: "model": { "primary": "cogni/test-model" }
curl -s http://127.0.0.1:3333/v1/chat/completions \
  -H "Authorization: Bearer openclaw-internal-token" \
  -H "Content-Type: application/json" \
  -d '{"model":"cogni/test-model","messages":[{"role":"user","content":"Say hello"}]}'
# Returns: "No response from OpenClaw."
```

## Impact

**Testing-only blocker.** Real models work. The gateway content stack test is skipped until this is resolved. Billing and protocol tests still pass with mock-llm.

## Plan

- [x] Add `OPENCLAW_RAW_STREAM=1` to compose, run diagnostic matrix
- [x] Confirm PI_RAW_STREAM is pi-mono only (not applicable to embedded)
- [x] Rebuild OpenClaw to v2026.2.6-3 — same result (disproves version theory)
- [x] Test with real model (nemotron-nano-30b) — works perfectly
- [x] Disprove pi-ai compat params theory (SDK works with all extra params)
- [x] Confirm real model works through full proxy stack (OpenClaw → nginx → LiteLLM → OpenRouter)
- [x] Tighten stack test assertions (was passing on error content)
- [x] Skip content test with bug.0009 reference
- [ ] Identify precise failure point in OpenClaw agent runtime (timing? content filter? enforceFinalTag?)
- [ ] Fix mock-llm compat or replace mock with a compatible local alternative

## Validation

```bash
# Tightened test: asserts no chat_error, no error strings in content, real litellm_call_id in billing
pnpm dotenv -e .env.test -- pnpm vitest run --config vitest.stack.config.mts tests/stack/sandbox/sandbox-openclaw.stack.test.ts
```

## PR / Links

- Blocks: task.0008 (stack test content assertions only)
- Project: [proj.openclaw-capabilities](../projects/proj.openclaw-capabilities.md)
- Test file: tests/stack/sandbox/sandbox-openclaw.stack.test.ts (content test skipped)
- Diagnostic env vars in compose: `OPENCLAW_RAW_STREAM=1`, `OPENCLAW_RAW_STREAM_PATH=/tmp/openclaw-raw-stream.jsonl`
- Handoff: [handoff](../handoffs/bug.0009.handoff.md)

## Attribution

- Investigation: AI-assisted raw stream diagnostic (OPENCLAW_RAW_STREAM matrix)
- 2026-02-10: Tightened assertions, confirmed full-stack real model works, narrowed root cause
