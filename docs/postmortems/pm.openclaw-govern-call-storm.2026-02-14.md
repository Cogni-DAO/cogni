---
id: pm.openclaw-govern-call-storm.2026-02-14
type: postmortem
title: "Postmortem: Context pruning too conservative; uncached tail grows unbounded in multi-call GOVERN loops"
status: draft
trust: draft
severity: SEV2
duration: "90 seconds, 19 sequential Opus calls per user message"
services_affected: [openclaw-gateway, litellm-proxy, app]
summary: "A single user message triggered an intentional 19-call GOVERN loop (correct architecture), but context pruning never activated. Uncached tail grew from 327 to 19K tokens across 90 seconds because pruning only triggers on cache TTL expiry (1h) or 30% context threshold—neither occurs in fast loops. Result: 19 × ~29K tokens = $5.50 spend for one user message."
read_when: "Debugging OpenClaw cost efficiency, context accumulation in multi-call agents, prompt caching effectiveness limits."
owner: derekg1729
created: 2026-02-14
verified: 2026-02-14
tags: [incident, openclaw, cost, context-management, architecture]
---

# Postmortem: Context pruning too conservative; uncached tail grows unbounded in multi-call GOVERN loops

**Date**: 2026-02-14
**Severity**: SEV2
**Status**: Root cause identified; mitigation strategy pending (see Action Items)
**Duration**: 90 seconds per user message; ongoing pattern until context optimization is deployed

---

## Summary

A single user message triggered an **intentional, architected 19-call GOVERN loop** (Orient → Pick → Execute → Maintain → Reflect). This loop is necessary and working correctly. However, OpenClaw's context pruning was too conservative to activate during the loop, causing the **uncached conversation tail to grow from ~327 tokens (call 1) to ~19K tokens (call 19)** across 90 seconds.

Root cause: `contextPruning: { mode: "cache-ttl", ttl: "1h" }` only prunes when **(1) cache TTL expires after 1 hour, OR (2) context exceeds ~30% of model window**. In a 90-second GOVERN loop, neither condition is met:

- Cache is fresh (< 1 hour old) → no TTL expiry
- Total context peaks at ~29K tokens = 14.5% of Opus 200K window → doesn't exceed 30% threshold

Result: **19 calls × ~29K tokens each = $5.50 spend** for one governance cycle, with ~9.8K tokens cached and reused (good) but ~19K uncached tokens needlessly re-sent on the final call (bad).

**Critical insight**: Prompt caching IS working correctly (verified ~9.8K stable prefix). The problem is that the uncached tail grows faster than caching can save on cost. Aggressive per-call pruning could fix this but risks losing critical context mid-agent execution.

---

## Timeline (UTC)

| Time                | Event                                                                                    |
| ------------------- | ---------------------------------------------------------------------------------------- |
| 2026-02-14 09:23:00 | OpenClaw embedded run starts for webchat message                                         |
| 2026-02-14 09:23:00 | Call 1: 10,127 tokens sent; cache writes 9,785 tokens. Output: 59 tokens.                |
| 2026-02-14 09:23:04 | Call 2: 10,696 tokens sent (9,785 cached + 911 uncached); cache hit. Output: 168 tokens. |
| 2026-02-14 09:23:06 | Call 3: 15,589 tokens sent; uncached tail grows to ~5,804. Output: 605 tokens.           |
| 2026-02-14 09:23:27 | Call ~11: 22,463 tokens sent; uncached tail reaches ~12,678. Output: 437 tokens.         |
| 2026-02-14 09:24:28 | Call 18: 28,971 tokens sent; uncached tail reaches ~19,186. Output: 470 tokens.          |
| 2026-02-14 09:24:41 | OpenClaw embedded run ends. Total duration: ~101 seconds.                                |

**Spend pattern**: Each call costs proportional to total tokens sent:

- Calls 1-5: ~$0.10-0.12 each (10-16K tokens)
- Calls 6-15: ~$0.20-0.27 each (17-27K tokens)
- Calls 16-19: ~$0.28-0.31 each (26-29K tokens)
- **Total: $4.90-5.50 for one user message.**

---

## Root Cause Analysis

### What Happened (Correct Understanding)

The agent entered a multi-step GOVERN loop—this is the correct, intended behavior. During the loop:

**Call 1** (initialization):

- Sent: SOUL.md + AGENTS.md + GOVERN.md (~3K tokens, system prompt) + conversation context (~7K tokens)
- Received: 59-token assistant output
- Cache action: Writes 9,785 tokens to OpenRouter cache

**Calls 2-19** (loop iterations):

- Each call inherits: cached prefix (9,785 tokens) + new context
- New context = assistant message from previous call + tool results + new user message
- Each loop iteration adds ~1K tokens to uncached tail (assistant message + tool output + new instruction)
- No pruning occurs because:
  - Cache is fresh (<1 hour old)
  - Total context never exceeds 30% threshold

**Result**: Uncached tail grows linearly: 327 → 1,900 → 5,800 → 12,700 → 19,200 tokens

### Why Pruning Never Fired

OpenClaw's `contextPruning: { mode: "cache-ttl", ttl: "1h" }` uses a **time-triggered** model:

```
Pruning activates IF:
  (cache.lastTouch < now - 1h) OR (context_size > 30% of window)

For this incident:
  - cache.lastTouch = 09:23:00 (fresh, not expired)
  - context_size = 28.9K = 14.5% of Opus 200K window (below threshold)

Therefore: Pruning = NEVER
```

This is the core architectural issue: **time-based pruning works for isolated tasks but fails for rapid multi-call loops.**

### Contributing Factors

1. **Conservative threshold**: `softTrimRatio: 0.3` (prune at 30% full) was chosen to preserve context fidelity. But this trades immediate safety for accumulation risk.

2. **No rate-based trigger**: No guardrail caps tokens-per-call or N-calls-per-run. History grows freely.

3. **Conversation history accumulation**: Each tool invocation adds results to history. With 19 tool calls per loop, results compound.

4. **Observation gap**: UI shows `cached_tokens` and `costUsd` but not:
   - Uncached token growth rate per call
   - Calls-per-run count
   - When pruning occurs (or doesn't)

---

## Why This Matters

**For the user**: One message cost $5.50 and took 90 seconds. Multi-call governance is unusable at this cost/latency.

**For the platform**: This pattern repeats for any multi-call agent workflow. GOVERN loops are the intended architecture—they must be efficient.

**For context optimization**: This exposes a fundamental tension:

- _Conservative pruning_ = preserve all context, risk accumulation in fast loops
- _Aggressive pruning_ = cap cost, risk losing critical context mid-task
- _Sweet spot_ = prune intelligently without losing signal (the project below)

---

## What Worked

- ✅ LiteLLM spend logs captured `cached_tokens` and `cache_write_tokens` → enabled fast diagnosis
- ✅ `spend_logs_metadata.run_id` correlated all 19 calls to a single run → clear forensics
- ✅ Prompt caching actually worked (~9.8K stable prefix cached correctly)

## What Didn't Work

- ❌ Context pruning too conservative for fast loops (time-triggered, not rate-triggered)
- ❌ No per-call token budget enforcement
- ❌ UI/observability didn't surface uncached token growth or calls-per-run

---

## Impact

**Customer**: One governance message unusable ($5.50, 90 seconds)

**Technical**: Exposed that GOVERN loops—while architecturally correct—are unoptimized for context efficiency.

**Cost**: $5.50 × 20 daily GOVERN runs = $110/day if scaled; $3,300/month.

---

## Action Items

| Pri | Action                                                                                                                                                                                      | Work Item                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| P0  | Create **proj.context-optimization** project: ongoing context efficiency work for multi-call agents. Include strategies: intelligent pruning, cache breakpoint placement, per-call budgets. | proj.context-optimization |
| P1  | Add `historyLimit` tuning: lower default `softTrimRatio` to 0.1 (prune at 10% instead of 30%) to trigger faster in loops. Test cost impact.                                                 | task.0068                 |
| P1  | Add UI visibility: show uncached tokens, calls-per-run, and pruning events in Activity. Alert on uncached tail growth >1K/call.                                                             | task.0069                 |
| P2  | Explore smart pruning: identify "stable context blocks" (initial system prompt, user mission statement) for separate cache markers beyond system prefix.                                    | task.0070                 |

---

## Related

- `work/projects/proj.context-optimization.md` (new project)
- `docs/postmortems/pm.billing-observability-gaps.2026-02-14.md`
