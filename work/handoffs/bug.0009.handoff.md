---
id: bug.0009.handoff
type: handoff
work_item_id: bug.0009
status: active
created: 2026-02-10
updated: 2026-02-10
branch: feat/openclaw-observability
last_commit: 52e47abb
---

# Handoff: Mock-LLM SSE Streaming Incompatible with OpenClaw Agent Runtime

## Context

- OpenClaw gateway uses pi-ai (Vercel AI SDK) internally for LLM streaming
- Stack tests route through: OpenClaw agent runtime -> nginx proxy -> LiteLLM -> mock-llm (`zerob13/mock-openai-api`)
- With mock-llm, the agent runtime produces `content: [], usage: {input:0, output:0}` every time
- With real models (nemotron-nano-30b via OpenRouter through the same proxy chain), full content streams correctly
- This is a **testing-only blocker** — production with real models works fine

## Current State

- **Done**: Tightened stack test assertions (was silently passing on error text), skipped content test with bug reference, updated bug.0009 with narrowed root cause
- **Done**: Disproven 4 hypotheses: pi-ai compat params, OpenClaw version, nginx proxy, mock-llm SSE format
- **Done**: Confirmed the interaction effect: `agent runtime + mock-llm = fail`, but `pi-ai standalone + mock-llm = works` and `agent runtime + real model = works`
- **Not done**: Precise root cause within OpenClaw's agent runtime subscription handler
- **Not done**: Fix (either mock-llm compat, alternative mock, or OpenClaw config tweak)
- **Blocked on**: Understanding why OpenClaw's agent runtime drops streaming events that pi-ai produces correctly

## Decisions Made

- Gateway config default model set to `cogni/test-model` (must match LiteLLM test config)
- Content test skipped with `it.skip` + bug.0009 reference (not deleted — unskip when fixed)
- Workspace writable test also skipped (unrelated: tmpfs owned by root, container runs as `node`)
- Stack tests must not depend on external internet (no real model workaround for CI)
- See commit `52e47abb` for all assertion changes

## Next Actions

- [ ] Investigate OpenClaw's `pi-embedded-subscribe.handlers.messages.ts` — specifically `handleMessageUpdate()` event type filtering and `stripBlockTags()`
- [ ] Test the `compat` config on test-model in `openclaw-gateway.json` (may change agent runtime behavior beyond just SDK params)
- [ ] Capture what the agent runtime's subscription handler actually receives — use `OPENCLAW_RAW_STREAM=1` and cross-reference with `handleMessageUpdate` event types
- [ ] Check if `enforceFinalTag` is defaulting to `true` for the "cogni" provider (would discard all content without `<final>` tags)
- [ ] Consider replacing `zerob13/mock-openai-api` with LiteLLM's `fake-openai-endpoint` for OpenClaw tests
- [ ] Once content test passes, unskip `"gateway responds to agent call via WS"` in the stack test
- [ ] Fix workspace writable test (compose tmpfs needs `uid` option matching container user)

## Risks / Gotchas

- **Raw stream log shows only 1 event per call**: `assistant_message_end` with `rawText:""` — zero `text_delta` events reach the subscription handler. The stream is consumed but produces nothing.
- **Mock-llm responds in ~50ms** (all chunks at once) vs real models streaming over seconds. Timing/race condition in the subscription handler is a strong candidate.
- **The previous test was silently green on error content** — the gateway config pointed to `nemotron-nano-30b` which didn't exist in LiteLLM test config. LiteLLM returned 400 and OpenClaw captured the error string as "content". Always validate against `chat_error` events.
- **OpenClaw container is read-only rootfs** — can't copy scripts into it. Use `docker exec node --input-type=module -e '...'` for diagnostics.
- **OpenClaw source is at `/Users/derek/dev/openclaw/`** — key file: `src/agents/pi-embedded-subscribe.handlers.messages.ts`

## Pointers

| File / Resource                                                        | Why it matters                                                                               |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `work/items/bug.0009.openclaw-v2026.2.4-empty-payloads.md`             | Full bug report with evidence matrix and disproven hypotheses                                |
| `tests/stack/sandbox/sandbox-openclaw.stack.test.ts`                   | Stack test with tightened assertions and skipped content test                                |
| `services/sandbox-openclaw/openclaw-gateway.json`                      | Gateway config — model, provider, agent defaults                                             |
| `infra/compose/configs/litellm.test.config.yaml`                       | LiteLLM test routing — must match gateway model names                                        |
| `docs/research/openclaw-gateway-integration-handoff.md`                | Prior research: protocol corrections, params divergence analysis (lines 440-530)             |
| `~/dev/openclaw/src/agents/pi-embedded-subscribe.handlers.messages.ts` | OpenClaw subscription handler — event filtering, `stripBlockTags`, `shouldSkipAssistantText` |
| `~/dev/openclaw/src/agents/pi-embedded-subscribe.ts`                   | `enforceFinalTag`, `recordAssistantUsage`, deduplication logic                               |
| `scripts/diag-openclaw-gateway.mjs`                                    | Standalone WS diagnostic — captures full protocol sequence                                   |
