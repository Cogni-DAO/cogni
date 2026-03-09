---
id: proj.context-optimization
type: project
state: Active
status: in_progress
title: "Context Optimization: Maximize intelligence while minimizing token waste"
priority: 0
assignees: [derekg1729]
estimate: 5
summary: "Multi-call agent workflows are correct but inefficient. Uncached context grows linearly in GOVERN loops (19 calls × 29K tokens = $5.50/run). This project catalogs optimization levers ranked by ROI vs complexity."
outcome: "Enable GOVERN loops to cost <$0.50/run while preserving agent reasoning depth. Maintain >99% success rate."
owner: derekg1729
created: 2026-02-14
updated: 2026-02-14
initiative: ini.cost-efficiency
tags: [context, tokens, cost, openclaw, architecture, ongoing]
---

# Context Optimization

## Goal

Enable multi-call agent workflows (GOVERN loops, research agents, orchestrators) to execute intelligently without token waste. Keep all critical context while dropping only redundant information. This is a never-finished optimization effort.

## Constraints

- Multi-call workflows are architecturally necessary (GOVERN loops cannot be single-call)
- Aggressive pruning risks losing agent reasoning mid-task
- Context pruning must preserve signal; no silent information loss
- Optimization must not reduce agent success rate (<baseline)
- All changes must be measurable (token counts, cost, latency, success rate)

## Design Notes

See [openclaw-context-optimization spec](../../docs/spec/openclaw-context-optimization.md) for:

- Context flow diagrams & accumulation models
- Governance loop context competition analysis
- Prioritized lever table (ROI vs complexity vs improvement)

## Mission

Enable multi-call agent workflows (GOVERN loops, research agents, orchestrators) to be intelligent and thorough **without token waste**. The goal: keep **all critical context** while dropping **only redundant context**.

This is a never-finished battle. New workflows will emerge, new challenges will surface. This project is the home for ongoing context efficiency work.

---

## Problem Statement

Multi-call agent workflows (like GOVERN loops) are architecturally correct but inefficient:

**Current state**: 19 GOVERN calls × 29K tokens/call = $5.50 spend + 90-second latency for one user message (this agent then got cut off before doing ANYTHING productive. terrible.)

**Root cause**: Context pruning is time-triggered (fires after 1 hour cache TTL or at 30% context threshold). In fast loops, neither condition is met, so:

- Uncached conversation tail grows linearly: 327 → 1.9K → 5.8K → 12.7K → 19.2K tokens
- No intelligent pruning occurs mid-loop
- Aggressive per-call pruning risks losing critical context

**The tension**:

- _Conservative pruning_ (now): Preserve all context, risk accumulation
- _Aggressive pruning_: Cap cost, risk losing signal mid-task
- _Sweet spot_: Prune intelligently WITHOUT losing information

---

## Scope

**In scope**: All OpenClaw agents and multi-call workflows:

- Gateway agent (GOVERN loops, user research, delegation)
- Sandbox agent (development, code review, testing)
- Future orchestrators, sub-agents, specialized workflows

**Out of scope**: Single-call agents or tasks with bounded context (those work fine).

---

## Strategies (Prioritized)

### Strategy 1: Rate-Based Pruning (Quick Win)

**The idea**: Prune based on calls-per-run or uncached-tokens-per-call, not time.

**Approaches**:

1. **Lower `softTrimRatio` threshold** (effort: 15 min)
   - Current: prune at 30% of window
   - Proposal: prune at 10-15% of window
   - Effect: Pruning fires on call ~2-3 instead of call 19
   - Risk: May trim too-aggressive context before agent finishes thought
   - Measurement: Cost/call, latency/call, success rate

2. **Add `historyLimit` per channel** (effort: 30 min)
   - Cap number of conversation turns (e.g., keep last 7 turns)
   - Automatically drops oldest turns regardless of context size
   - Predictable behavior: agents know history depth
   - Risk: May lose long-term context (e.g., user's original request)

3. **Add `maxTokensPerCall` budget** (effort: 2 hours)
   - Fail closed if any LLM call would send >15K uncached tokens
   - Forces checkpointing: save state, prune aggressively, start fresh
   - Benefit: Hard guarantees on cost/call
   - Risk: May interrupt multi-step reasoning mid-stream

**Expected impact**: -30-50% uncached tokens/call (depending on approach)

**Tradeoff**: Requires careful testing to avoid cutting critical context.

---

### Strategy 2: Smart Pruning (Medium Effort)

**The idea**: Identify "stable context blocks" that should never be pruned, vs "ephemeral context" (tool results, intermediate steps) that can be summarized.

**Approaches**:

1. **Separate cache breakpoints** (effort: 4 hours)
   - System prefix: SOUL.md + AGENTS.md (~3K tokens, never prune)
   - Stable context: user mission, charter, key invariants (~2K tokens, cache separately)
   - Ephemeral context: tool results, intermediate steps (~14K tokens, prune aggressively)
   - Benefit: Cache stable blocks while allowing tool results to be replaced
   - Implementation: Use OpenRouter cache breakpoints or token-level markers

2. **Tool result summarization** (effort: 6 hours)
   - Instead of keeping full tool output, keep only summaries
   - E.g., "file search returned 47 matches in foo.ts, bar.ts, baz.ts" vs full file contents
   - Benefit: 70-80% reduction in uncached tokens from tool results
   - Risk: Loss of fidelity; agent needs to re-read full output if needed

3. **Turn consolidation** (effort: 8 hours)
   - Every N turns, consolidate: "In the last 5 exchanges, we discussed X, decided Y, attempted Z"
   - Replace original turns with consolidated summary
   - Benefit: Compress history while preserving intent
   - Risk: Compression artifacts; loss of reasoning traces

**Expected impact**: -50-70% uncached tokens/call

**Tradeoff**: More implementation work; more architectural risk.

---

### Strategy 3: Architectural Redesign (Long-term)

**The idea**: Change how multi-call agents work to reduce context reuse.

**Approaches**:

1. **Checkpoint-driven loops** (effort: 16+ hours)
   - After each major step (Pick, Execute, etc.), save state to disk
   - Next step reads state, not full conversation history
   - Benefit: Context never grows beyond 1-2 steps of data
   - Cost: Need robust serialization, state management, error recovery
   - Risk: Adds complexity, state becomes bottleneck

2. **Streaming responses without re-context** (effort: 12+ hours)
   - Return partial results to user in real-time
   - Don't re-send context for each internal step
   - Benefit: User sees progress; reduced intermediate calls
   - Risk: May reduce agent reasoning depth

3. **Hierarchical context** (effort: ongoing)
   - Different context depth for different agent modes
   - GOVERN loops: stripped-down context (executive summary)
   - Research tasks: full context (reasoning chains matter)
   - Benefit: Right-sized context for task
   - Risk: Requires per-task calibration

**Expected impact**: -70-90% uncached tokens/call

**Tradeoff**: Significant architectural change; requires rethinking agent design.

---

## Work Breakdown

### Phase 1: Quick Wins (This Sprint)

| Task                                                                          | Effort | Owner | Target                    |
| ----------------------------------------------------------------------------- | ------ | ----- | ------------------------- |
| task.0068: Lower `softTrimRatio` to 0.15, test cost/latency                   | 2h     | —     | -30% uncached tokens/call |
| task.0069: Add UI visibility (uncached tokens, calls-per-run, pruning events) | 4h     | —     | Better observability      |
| task.0070: Spike on `historyLimit` implementation                             | 2h     | —     | Design proposal           |

### Phase 2: Medium-Term (Next Sprint)

| Task                                                               | Effort | Owner | Target                    |
| ------------------------------------------------------------------ | ------ | ----- | ------------------------- |
| task.0071: Implement separate cache breakpoints for stable context | 4h     | —     | -50% uncached tokens      |
| task.0072: Build tool result summarization                         | 6h     | —     | -70% tool result overhead |
| task.0073: Per-channel `historyLimit` tuning                       | 3h     | —     | Predictable history depth |

### Phase 3: Long-term (Ongoing)

| Task                                               | Effort  | Owner | Target                  |
| -------------------------------------------------- | ------- | ----- | ----------------------- |
| task.0074: Spike on checkpoint-driven loops        | 4h      | —     | Design for -80% tokens  |
| task.0075: Research streaming partial results      | 3h      | —     | Feasibility assessment  |
| task.0076: Monitor real-world cost impact, iterate | ongoing | —     | Continuous optimization |

---

## Success Metrics

| Metric                                        | Current | Target (12 weeks) | Target (6 months) |
| --------------------------------------------- | ------- | ----------------- | ----------------- |
| Avg uncached tokens/call (GOVERN loop)        | ~19K    | ~7K (-63%)        | ~2K (-89%)        |
| Cost per GOVERN run                           | $5.50   | $1.50 (-73%)      | $0.20 (-96%)      |
| Avg latency per call                          | ~5s     | ~2s               | ~1s               |
| Agent success rate (context-related failures) | unknown | >99%              | >99.5%            |
| Operator time spent on context tuning         | TBD     | -50%              | -80%              |

---

## Known Tradeoffs

1. **Aggressive pruning vs fidelity**: Pruning fast saves cost but risks losing context. Must test extensively.

2. **Caching placement**: Where to place cache breakpoints? Too many = overhead; too few = no savings. Requires experimentation.

3. **Summarization accuracy**: Tool output summaries faster but may lose crucial details. Risk: agent asks "can you show me the full output?" (adds calls, not saved).

4. **Checkpoint complexity**: State snapshots reduce context but add complexity (serialization, recovery, coordination). Worth it only if savings >70%.

---

## Dependencies

- OpenClaw token visibility (spend logs with `cached_tokens`, `cache_write_tokens`) ✓
- LiteLLM proxy with cache instrumentation ✓
- Activity UI updates (for visibility) — task.0069
- Observability: alerts on uncached tail growth — task.0065

---

## Risks & Mitigations

| Risk                                     | Mitigation                                                                                                         |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Aggressive pruning loses agent reasoning | Phase 1: Test with lower threshold only. Phase 2: Separate "never prune" context. Phase 3: Architectural redesign. |
| Cache breakpoint placement is fragile    | Document stable vs ephemeral context per workflow. Test multiple configurations.                                   |
| Summarization loses critical details     | Require agent to explicitly "expand" if needed. Log summarization decisions.                                       |
| Checkpoint state becomes bottleneck      | Profile state I/O before committing to design. Consider in-memory vs disk.                                         |

---

## Timeline

- **This sprint (2026-02-14 → 2026-02-28)**: Phase 1 quick wins
- **Next sprint (2026-03-01 → 2026-03-14)**: Phase 2 medium-term
- **Ongoing**: Phase 3 long-term research + monitoring

---

## Why This Project Exists

GOVERN loops and multi-call workflows are the future of Cogni. They need to work efficiently. Context optimization is not a "feature" but a **sustainability foundation**. Without it:

- Multi-call agents are unusable (too expensive, too slow)
- Platform scales poorly (cost explodes with usage)
- Token efficiency becomes a permanent constraint

With it:

- GOVERN loops become practical ($0.20 instead of $5.50/run)
- Agents can do deeper reasoning (more calls allowed)
- Platform scales gracefully

This project is the commitment to making multi-call workflows viable long-term.

---

## Roadmap

Work is prioritized in the [openclaw-context-optimization spec](../../docs/spec/openclaw-context-optimization.md) using a lever table (ROI vs Complexity). High-level direction:

1. **Phase 1 (Quick wins)**: Lower pruning threshold, add UI visibility
2. **Phase 2 (Medium-term)**: Tool result truncation, separate cache breakpoints
3. **Phase 3 (Long-term)**: Checkpoint-driven loops, hierarchical context

See the spec's "Implementation Bundles" section for concrete combinations.

## As-Built Specs

- [openclaw-context-optimization](../../docs/spec/openclaw-context-optimization.md) (draft, perpetual work-in-progress)
- [openclaw-sandbox-spec](../../docs/spec/openclaw-sandbox-spec.md) (current OpenClaw execution model)
- [openclaw-workspace-spec](../../docs/spec/openclaw-workspace-spec.md) (gateway agent GOVERN loop)

## Related

- [pm.openclaw-govern-call-storm.2026-02-14.md](../../docs/postmortems/pm.openclaw-govern-call-storm.2026-02-14.md) (root cause postmortem)
- [task.0053.token-model-optimization.md](../items/task.0053.token-model-optimization.md) (broader cost effort)
- [MEMORY.md § Cost Control](../../services/sandbox-openclaw/gateway-workspace/MEMORY.md) (critical cost insights)
