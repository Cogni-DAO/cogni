---
id: openclaw-context-optimization
type: spec
title: "OpenClaw Context Optimization: vNext Architecture"
status: draft
spec_state: draft
trust: draft
summary: "Perpetual work-in-progress spec defining context efficiency strategies for multi-call agent workflows (GOVERN loops, research agents). Graphical context flow models, governance loop context competition analysis, and a prioritized lever table (ROI vs complexity vs improvement)."
read_when: "Optimizing OpenClaw context efficiency, designing multi-call agent workflows, or deciding between context pruning strategies."
intended_for: Humans
implements: proj.context-optimization
owner: derekg1729
created: 2026-02-14
verified: 2026-02-14
tags: [openclaw, context, tokens, cost, architecture]
---

# OpenClaw Context Optimization: vNext Architecture

> Multi-call agent workflows are architecturally correct but context-inefficient. This spec models how context flows through a GOVERN loop, identifies what competes for tokens, and catalogs optimization levers ranked by ROI, complexity, and improvement potential.

### Key References

|                  |                                                                                                        |
| ---------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------- |
| **Project**      | [proj.context-optimization](../../work/projects/proj.context-optimization.md)                          | Ongoing work planning                     |
| **Postmortem**   | [pm.openclaw-govern-call-storm.2026-02-14](../postmortems/pm.openclaw-govern-call-storm.2026-02-14.md) | Root cause: time-triggered pruning        |
| **Architecture** | [openclaw-sandbox-spec](openclaw-sandbox-spec.md)                                                      | OpenClaw integration & execution modes    |
| **Workspace**    | [openclaw-workspace-spec](openclaw-workspace-spec.md)                                                  | Gateway agent GOVERN loop & system prompt |

---

## Goal

Define how context accumulates in multi-call agent workflows, model the token budget "competition" during a GOVERN loop, and provide a prioritized catalog of optimization levers (code changes, config tuning, prompt engineering, architectural redesigns) ranked by **ROI vs Complexity vs Improvement Potential**.

## Non-Goals

- Changing OpenClaw core architecture (outside scope)
- Designing new execution models (e.g., distributed agents, orchestrator patterns)
- Optimizing single-call agents (they're already efficient)
- Prompt engineering for cost reduction (that's orthogonal)

---

## Design

### 1. Context Flow in a Multi-Call Agent (Current State)

```
USER MESSAGE
     |
     v
[System Prompt: SOUL.md + AGENTS.md + GOVERN.md] (3K tokens, cached)
     |
     v
CALL 1: [cached prefix] + [user context] (10K tokens total)
  -> LLM invokes tool (e.g., "read work items")
  -> Tool returns: 5KB of JSON/text (1.2K tokens)
  -> Tool result APPENDED to conversation history
     |
     v
CALL 2: [cached prefix (9.8K)] + [prev assistant msg] + [tool result] + [new instruction]
     = ~11K tokens total
  -> LLM invokes tool (e.g., "search for related issue")
  -> Search returns: 3KB of results (0.8K tokens)
  -> APPENDED to history
     |
     v
CALL 3: [cached prefix] + [all prior turns + results] + [new work]
     = ~15K tokens
     |
     v
... (linear growth)
     |
     v
CALL 19: [cached prefix] + [18 turns of accumulated context + tool results]
      = ~29K tokens

RESULT: 19 calls × ~29K average = $5.50 spend
        But caching only saves ~9.8K per call = limited effectiveness
        Uncached tail grows linearly: 327 → 1.9K → 5.8K → 19K tokens
```

### 2. Context Budget During GOVERN Loop (ASCII Flow)

```
MODEL CONTEXT WINDOW: 200K tokens (Opus 4)
├─ Static (never prunes): System prompt + workspace files = ~3K
│
├─ Stable but re-sent: User mission, initial instructions = ~7K
│  (Cached after call 1, then reused)
│
├─ Ephemeral & accumulating:
│  Call 1:  new conversation = 100 tokens
│  Call 2:  assistant(59) + tool_result(1200) + instruction(200) = 1.5K
│  Call 3:  assistant(168) + tool_result(800) + instruction(250) = 1.2K
│  ...
│  Call 19: assistant(470) + accumulated_tools(15K) + context(3K) = ~19K
│
└─ Result: Uncached tail = 327 + 1.5K + 1.2K + ... + 19K = 19K by call 19
           Context % of window = 29K / 200K = 14.5% (below 30% pruning threshold)
           -> NO PRUNING FIRES
           -> Cost = 19 × 29K average tokens = $5.50
```

### 3. Context Competition in GOVERN Loop

During a GOVERN loop, five types of context compete for tokens:

```
+─────────────────────────────────────────────────────────────────+
│                    GOVERN LOOP CONTEXT COMPETITION              │
+─────────────────────────────────────────────────────────────────+
│                                                                 │
│ TYPE 1: System Prompt (SOUL.md, AGENTS.md, GOVERN.md)          │
│         Size: ~3K tokens (fixed, cached)                        │
│         Competition Level: LOW (once per session)              │
│         Prunable: NO (core agent identity)                      │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│ TYPE 2: Initial Context (User mission, charter, invariants)    │
│         Size: ~5-7K tokens (fixed, cached after call 1)        │
│         Competition Level: MEDIUM (stable, helps reasoning)    │
│         Prunable: MAYBE (lose fidelity if summarized)          │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│ TYPE 3: Tool Results (work item JSON, search results, git log) │
│         Size: ~1-2K per call × 19 calls = 19-38K tokens        │
│         Competition Level: VERY HIGH (accumulates linearly)    │
│         Prunable: YES (summarize, truncate, drop after use)    │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│ TYPE 4: Conversation History (assistant messages, user turns)  │
│         Size: ~200-500 tokens per turn × 19 turns = 4-9K       │
│         Competition Level: HIGH (needed for coherence)         │
│         Prunable: MAYBE (consolidate, drop old turns)          │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│ TYPE 5: Intermediate State (partial decisions, draft EDOs)     │
│         Size: ~1-2K tokens                                      │
│         Competition Level: MEDIUM (helps agent track progress) │
│         Prunable: YES (save to disk, not conversation)         │
│                                                                 │
+─────────────────────────────────────────────────────────────────+

TOTAL CONTEXT BY CALL 19:
  Type 1: ~3K (cached, doesn't count against new token spend)
  Type 2: ~7K (cached, doesn't count against new token spend)
  Type 3: ~19K (accumulating, NOT pruned, FULL COST)
  Type 4: ~4K (accumulating, NOT pruned, FULL COST)
  Type 5: ~2K (accumulating, NOT pruned, FULL COST)
  ─────────────
  TOTAL:  ~29K tokens sent (of which ~9.8K cached, ~19.2K uncached)

PROBLEM:
  - Type 3 (tool results) dominates cost: 19-38K tokens
  - No pruning fires because context never exceeds 30% window threshold
  - Uncached tail grows linearly across 90 seconds
  - Agent reasoning depth stays HIGH (good for correctness)
  - But token waste is EXTREME (bad for cost/latency)
```

---

## Optimization Levers: Prioritized by ROI vs Complexity vs Improvement

| Rank   | Lever                                                         | Description                                                                                                                                                                                                                    | ROI (Cost Savings)                   | Complexity                                       | Implementation                                        | Improvement Potential              | Risk                                                                |
| ------ | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------ | ------------------------------------------------ | ----------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------- |
| **1**  | Lower `softTrimRatio` to 0.1                                  | Change pruning threshold from 30% → 10% of window. Fires earlier in loops.                                                                                                                                                     | ⭐⭐⭐⭐ (Quick)                     | ⭐ (Config only)                                 | 15 min: 1 line in `openclaw-gateway.json`             | -30-40% uncached tokens            | ⚠️ May prune too early, lose context before reasoning done          |
| **2**  | Add `historyLimit` per channel                                | Cap conversation turns (e.g., keep last 7 turns max). Automatically drops oldest.                                                                                                                                              | ⭐⭐⭐⭐ (Predictable)               | ⭐⭐ (OpenClaw config + testing)                 | 30 min: config + test 2-3 settings                    | -40-50% conversation history       | ⚠️ May lose long-term context (e.g., original user request)         |
| **3**  | Truncate tool results in-flight                               | On tool invocation, cap output to 500 chars. Append "[truncated, ask agent to expand]"                                                                                                                                         | ⭐⭐⭐⭐⭐ (Huge savings)            | ⭐⭐ (OpenClaw extension or proxy)               | 2 hours: hook tool results before adding to history   | -50-70% tool result tokens         | ⚠️ Agent may ask "expand tool result" → adds calls back (net -30%)  |
| **4**  | Separate cache breakpoints for stable context                 | Use OpenRouter cache markers to cache "mission + charter" block separately from system prompt.                                                                                                                                 | ⭐⭐⭐ (Modest)                      | ⭐⭐⭐ (Requires cache marker injection)         | 4 hours: inject markers at tool boundary              | -15-25% cache write overhead       | ⚠️ Complex to maintain; fragile if context blocks change            |
| **5**  | Tool result summarization (AI-driven)                         | Use a fast model (Haiku) to summarize large tool results before appending. "47 files match X" instead of full list.                                                                                                            | ⭐⭐⭐⭐ (High ROI if well-designed) | ⭐⭐⭐⭐ (Agent orchestration needed)            | 6 hours: spawn summarizer subagent                    | -60-75% tool result tokens         | ⚠️⚠️ Compression artifacts; agent loses fidelity, may re-ask        |
| **6**  | Per-call `maxTokensPerCall` budget                            | Fail closed if any call would send >15K uncached tokens. Forces checkpointing.                                                                                                                                                 | ⭐⭐⭐⭐ (Hard guarantee)            | ⭐⭐⭐ (OpenClaw extension)                      | 2 hours: add guardrail in context builder             | -70% (but forces checkpointing)    | ⚠️⚠️ May interrupt multi-step reasoning; needs state save/restore   |
| **7**  | Turn consolidation (periodic summaries)                       | Every 5-7 turns, replace with: "We discussed X, decided Y, attempted Z." Save originals to disk.                                                                                                                               | ⭐⭐⭐ (Moderate savings)            | ⭐⭐⭐⭐ (Complex state management)              | 8 hours: summarizer + replay logic                    | -40-50% conversation history       | ⚠️⚠️⚠️ Requires robust serialization; risk of state corruption      |
| **8**  | Checkpoint-driven loops (architectural)                       | After each GOVERN phase (Pick/Execute/etc), snapshot state to disk. Next phase reads state, not conversation.                                                                                                                  | ⭐⭐⭐⭐⭐ (Extreme savings)         | ⭐⭐⭐⭐⭐ (Major redesign)                      | 16+ hours: new execution model + state store          | -80-90% uncached tokens            | ⚠️⚠️⚠️⚠️ Adds complexity, error recovery, state management overhead |
| **9**  | Streaming responses without re-context                        | Deliver partial results to user in real-time. Don't re-send context for each step.                                                                                                                                             | ⭐⭐⭐ (UX improvement + cost)       | ⭐⭐⭐⭐ (Streaming architecture)                | 12 hours: modify response protocol                    | -30-50% intermediate calls         | ⚠️⚠️ May reduce agent reasoning depth (user sees partial thinking)  |
| **10** | Hierarchical context per mode                                 | Different context depth for GOVERN vs user messages. Executive summary for loops, full for reasoning.                                                                                                                          | ⭐⭐ (Requires tuning)               | ⭐⭐⭐⭐⭐ (Per-task calibration)                | Ongoing: profile → tune → measure                     | -20-30% (mode-dependent)           | ⚠️⚠️⚠️ Fragile; breaks when new workflows added                     |
| **11** | Governor Dashboards (pre-computed context)                    | GOVERN loop reads pre-built dashboard files (work summary, priorities, metrics) instead of scanning raw work items. Dashboards updated async (cron).                                                                           | ⭐⭐⭐⭐⭐ (Massive ROI)             | ⭐⭐ (1-2 dashboards to start)                   | 3-4 hours: build 2-3 dashboard generators             | -50-70% Orient phase tokens        | ✅ No risk; strictly improves signal                                |
| **12** | Repository Doc Organization (signal-first layout)             | Reorganize docs/ so agent can find relevant specs/guides in 1-2 grepping vs 5+ random reads. Use consistent naming, cross-linking, index files.                                                                                | ⭐⭐⭐⭐ (High ROI)                  | ⭐⭐⭐ (Structural refactor)                     | 2-3 sprints: audit + reorganize + update links        | -30-45% research phase tokens      | ✅ No risk; improves discoverability                                |
| **13** | Better Tools & Tool Guides (information gathering efficiency) | Create tool-specific guides: "use `git log --format=...` not `git log`", "prefer `grep -l` over full grep when checking file presence". Train agents on efficient patterns.                                                    | ⭐⭐⭐⭐ (High ROI)                  | ⭐⭐ (Documentation)                             | 1-2 sprints: audit tools + write guides               | -20-35% tool output size           | ✅ No risk; teaches efficiency                                      |
| **14** | Audience-Optimized Spec Structure                             | **Humans**: 80% diagrams, 20% concise text (visual-first). **Agents**: JSON/structured data, high specificity, machine-parseable (agent-first). Default: agent-optimized; flag human-facing specs with `intended_for: Humans`. | ⭐⭐⭐⭐ (Reduces agent confusion)   | ⭐⭐⭐ (Restructure templates, update practices) | 2-3 sprints: template overhaul + audit existing specs | -15-25% agent research token waste | ✅ No risk; clarifies intent                                        |

### The Three "Signal-First" Levers (11, 12, 13)

**These are orthogonal to token pruning.** They don't reduce context; they **reduce the need for context in the first place**.

#### Lever 11: Governor Dashboards (Pre-Computed Context)

Problem: GOVERN loop spends 30-40% of tokens reading raw work items, filtering, summarizing.

Solution: Pre-compute dashboard files (updated async via cron):

- `dashboards/work-summary.md` — "5 In Progress items, 12 blocked on review, 3 bugs SEV2+"
- `dashboards/metrics.md` — "Ship rate: 8 PRs/week, cost spike: $X on 2026-02-14"
- `dashboards/priorities.md` — Top 3 user-facing issues, top 3 tech-debt issues

Benefit: Agent reads **2KB dashboard** instead of **15KB raw items** → -80% Orient phase tokens.

#### Lever 12: Repository Doc Organization (Signal-First Layout)

Problem: Agent spends tokens searching for specs, reading wrong docs, backtracking.

Solution: Reorganize docs/ per signal hierarchy:

- Specs organized by consumer (AI agents, developers, operators)
- Consistent naming: `{topic}-{audience}.md` or `{topic}-spec.md`
- Index files linking to "start here" guides per workflow
- Cross-references at top of each doc

Benefit: Agent finds what it needs in 1-2 grep/read operations vs 5+ random walks → -30-45% research phase.

#### Lever 13: Better Tools & Tool Guides (Efficient Patterns)

Problem: Agent uses tools inefficiently (full output when summary suffices, N calls instead of 1).

Solution: Create "TOOLS.md" with efficient patterns:

```
## grep
❌ grep "pattern" src/**/*.ts → large output, slow
✅ grep -l "pattern" src/**/*.ts → just filenames, fast

## git
❌ git log --oneline → 100+ lines
✅ git log -n 5 --oneline → recent 5 commits

## find
❌ find . -name "*.ts" | wc -l → count files
✅ find . -name "*.ts" -ls | wc -l → with size info in one pass
```

Benefit: Agents learn efficient patterns → -20-35% tool output size.

---

### ROI Legend

| Symbol     | Meaning                                   |
| ---------- | ----------------------------------------- |
| ⭐         | Cost savings minimal or one-time only     |
| ⭐⭐       | Modest savings (~10-20% cost reduction)   |
| ⭐⭐⭐     | Moderate savings (~30-50%)                |
| ⭐⭐⭐⭐   | Significant savings (~50-70%)             |
| ⭐⭐⭐⭐⭐ | Extreme savings (>70%) or hard guarantees |

### Complexity Legend

| Symbols    | Meaning                                   |
| ---------- | ----------------------------------------- |
| ⭐         | Config change only; no code               |
| ⭐⭐       | Small code change; isolated module        |
| ⭐⭐⭐     | Medium change; affects multiple modules   |
| ⭐⭐⭐⭐   | Large change; requires new infrastructure |
| ⭐⭐⭐⭐⭐ | Architectural redesign; major refactor    |

### Risk Legend

| Symbol   | Meaning                                                     |
| -------- | ----------------------------------------------------------- |
| ✅       | No significant risk                                         |
| ⚠️       | Acceptable risk; can be mitigated with testing              |
| ⚠️⚠️     | Moderate risk; may lose information or introduce bugs       |
| ⚠️⚠️⚠️   | High risk; requires careful design & rollback plan          |
| ⚠️⚠️⚠️⚠️ | Very high risk; extensive testing + staged rollout required |

---

## Implementation Bundles (Recommended Combinations)

### Bundle A: Quick Wins (15 min + 4h, -40% cost)

1. Lower `softTrimRatio` to 0.1
2. Add UI visibility (uncached tokens, calls-per-run, pruning events)
3. Test with real GOVERN runs

### Bundle B: Medium-Term (-60% cost, 1-2 sprints)

1. All of Bundle A
2. Add `historyLimit: 7` per channel
3. Truncate tool results to 500 chars in-flight
4. Test extensively (regression + success rate metrics)

### Bundle C: Information Architecture (-40-70% cost, 2-3 sprints)

1. Implement Governor Dashboards (pre-computed work summaries)
2. Reorganize docs/ for signal-first discoverability
3. Create Tool Guides (efficient patterns for common operations)
4. **No code changes needed** — pure org/docs work with massive ROI

### Bundle D: Long-Term Redesign (-80% cost, 4+ weeks)

1. All of Bundle B
2. Implement checkpoint-driven loops with state persistence
3. Add per-call `maxTokensPerCall` budget enforcement
4. Redesign subagent spawning to use checkpoints

---

## Core Invariants

| Rule                     | Constraint                                                                                                                                           |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| CONTEXT_NEVER_INFINITE   | Context pruning MUST fire before conversation reaches model context limit (fail-closed). Test: `assert(context_tokens < model_context_window * 0.8)` |
| PRUNING_PRESERVES_SIGNAL | Pruned context must not lose critical reasoning or user intent. Test: Agent success rate ≥ baseline after pruning (measure via EDO outcomes)         |
| UNCACHED_TOKENS_BUDGET   | No single uncached context block should exceed 15K tokens without checkpointing. Test: Log uncached tokens per call; alert if >15K                   |
| CACHE_HIT_RATE_MINIMUM   | Caching must provide ≥80% cache hit rate on reused static content. Test: Query LiteLLM `cached_tokens` / `prompt_tokens` per run                     |
| TOOL_RESULT_TRUNCATION   | Tool results must be truncated to 500 chars by default; agent can request full output. Test: Measure token reduction per call                        |
| GOVERNER_LOOP_LATENCY    | Multi-call GOVERN loop must complete in ≤120 seconds per user message (vs current ~90s). If slower, investigate pruning overhead.                    |

---

## File Pointers

| File                                                                                    | Purpose                                                                                              |
| --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `services/sandbox-openclaw/openclaw-gateway.json`                                       | Context pruning config: `softTrimRatio`, `historyLimit`, `contextPruning.mode`, `contextPruning.ttl` |
| `/Users/derek/dev/openclaw/src/agents/pi-extensions/context-pruning/`                   | OpenClaw pruning engine (thresholds, algorithms)                                                     |
| `/Users/derek/dev/openclaw/src/agents/pi-extensions/context-pruning/settings.ts`        | Default thresholds: `softTrimRatio: 0.3`, `hardClearRatio: 0.5`, `keepLastAssistants: 3`             |
| `/Users/derek/dev/cogni-template/services/sandbox-openclaw/gateway-workspace/GOVERN.md` | GOVERN loop checklist (Orient, Pick, Execute, Maintain, Reflect)                                     |
| `/Users/derek/dev/cogni-template/services/sandbox-openclaw/gateway-workspace/SOUL.md`   | Agent persona & delegation strategy                                                                  |

---

## Open Questions

- [ ] What is the empirical relationship between `softTrimRatio` and agent success rate? (Test needed)
- [ ] How much does `historyLimit` reduce latency vs cost tradeoff? (A/B test needed)
- [ ] Can tool result summarization preserve fidelity >90% without agent re-asking? (PoC needed)
- [ ] What state needs checkpointing for GOVERN loops? (Design spike needed)
- [ ] Should cache breakpoints be per-workflow or global? (Requires workflow taxonomy)
- [ ] How to measure "signal preserved" after aggressive pruning? (Metrics design needed)

---

## Related

- [proj.context-optimization](../../work/projects/proj.context-optimization.md) — Ongoing work planning and milestone tracking
- [pm.openclaw-govern-call-storm.2026-02-14](../postmortems/pm.openclaw-govern-call-storm.2026-02-14.md) — Root cause: time-triggered pruning doesn't fire in fast loops
- [openclaw-sandbox-spec](openclaw-sandbox-spec.md) — OpenClaw architecture & execution modes
- [openclaw-workspace-spec](openclaw-workspace-spec.md) — Gateway agent & GOVERN operating model
- [MEMORY.md § Cost Control](../../../services/sandbox-openclaw/gateway-workspace/MEMORY.md) — Critical cost insights & past lessons
