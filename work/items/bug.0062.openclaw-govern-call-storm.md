---
id: bug.0062
type: bug
title: "OpenClaw gateway: single webchat message can trigger multi-call GOVERN loop (call storm)"
status: needs_design
priority: 0
estimate: 2
summary: "A single sandbox:openclaw webchat message can produce ~10-20 sequential LLM calls in one run, rapidly increasing prompt tokens and cost."
outcome: "Long multi-turn governance sessions are supported without runaway spend, and interactive webchat messages do not trigger call storms."
spec_refs: [openclaw-sandbox-spec, sandboxed-agents]
assignees: [derekg1729]
credit:
project: proj.openclaw-capabilities
branch:
pr:
reviewer:
created: 2026-02-14
updated: 2026-02-14
labels: [openclaw, cost, reliability, p0]
external_refs:
revision: 0
blocked_by:
deploy_verified: false
rank: 3
---

# bug.0062 — OpenClaw gateway call storm from a single user message

## Observed

- One webchat message to `sandbox:openclaw` produced ~19 sequential `claude-opus-4.5` calls in ~90 seconds.
- Prompt tokens grew from ~10k to ~29k during the run, with small output tokens between calls.
- OpenRouter prompt caching was active for a stable prefix (~9.8k cached tokens), but the uncached tail expanded rapidly.

## Expected

- Interactive user messages should not trigger multi-minute governance-style loops.
- Governance sessions should be able to run long/multi-turn without exploding cost (bounded work per “tick”, stable cached prefix, controlled context growth).

## Evidence (local dev)

- All 19 LiteLLM calls share the same `spend_logs_metadata.run_id` (single OpenClaw run).
- First call shows `cache_write_tokens ≈ 9785`; subsequent calls show `cached_tokens ≈ 9785`.
- OpenClaw gateway logs show many tool invocations (`read`, `exec`) during the same run.

## Root cause (current hypothesis)

- The gateway agent’s prompt/mode selection allows a GOVERN-style workflow to run in response to a normal webchat message.
- Tool outputs + incremental assistant turns rapidly expand the uncached prompt tail; only a stable prefix is cacheable.
- No explicit “governance tick” boundary exists (i.e., one user message implicitly becomes many internal turns).

## Deep dive plan (what to determine)

1. Identify what input/event caused the agent to enter the GOVERN loop (webchat payload vs runtime-injected prompt).
2. Identify how OpenClaw decides to “continue” and produce many assistant message ends within one run.
3. Determine how to structure long governance sessions safely:
   - stable cached prefix (Anthropic/OpenRouter cache_control with long TTL if needed)
   - controlled context growth (pruning/compaction strategy aligned with cache boundaries)
   - explicit tick/step budget per run (calls/tools/duration/spend)
4. Implement a concrete fix in the gateway runtime/prompt wiring (exact location TBD by the above).

## Validation (acceptance)

- A single webchat message cannot generate a call storm (bounded calls/tools) under worst-case prompts.
- A long governance session (multi-turn) maintains stable cached prefix and does not exhibit explosive uncached tail growth.

## Validation

- ✅ `pnpm check:docs`
