---
id: autonomous-agent-operator-loops
type: research
title: "Research: Autonomous Agent Operator Loops"
status: active
trust: reviewed
summary: Survey of production agent loop architectures — Claude Code, SWE-Agent, Devin, Reflexion, BabyAGI, Google BATS — with synthesis for scheduled operator agents
read_when: Designing or improving the HEARTBEAT mission-control operator loop
spike: task.0153
owner: derekg1729
created: 2026-03-11
verified: 2026-03-11
tags: [governance, research, agent-loop, mission-control]
---

# Research: Autonomous Agent Operator Loops

> spike: task.0153 | date: 2026-03-11

## Question

What are the most effective autonomous agent loop architectures used in production systems, and how should we incorporate those patterns into our scheduled operator agent (HEARTBEAT → mission-control)?

Our agent runs hourly on a cron, picks work items, dispatches lifecycle skills, and must track its own effectiveness. This is fundamentally different from interactive chat agents — it needs persistent state, budget awareness, and outcome verification across runs.

## Context

**What exists today:** HEARTBEAT fires hourly via Temporal → OpenClaw gateway. Currently routes to `/git-sync` (useless). The agent has zero situational awareness, zero work item execution, and no memory across runs.

**What we're building:** A structured operator loop (task.0153) that gathers metrics, checks WIP, picks work, dispatches lifecycle skills, records decisions as EDOs, and reports to Discord.

**Key constraint:** The agent is a researcher (cheap model) that spawns a brain subagent (strong model) for writes. The operator loop itself must be cheap — only the dispatch step is expensive.

## Findings

### Pattern 1: Claude Code — Single-Threaded Master Loop

**Source:** [Claude Code Behind the Scenes](https://blog.promptlayer.com/claude-code-behind-the-scenes-of-the-master-agent-loop/)

**Architecture:** `while(tool_call) → execute tool → feed results → repeat`. Terminates when model produces plain text. Internally codenamed "nO".

**Key innovations:**
- **Flat message history** — no complex threading, no multi-agent swarms
- **At most one sub-agent** at a time — prevents recursive explosion
- **TODO lists as planning** — structured JSON task lists injected as system reminders
- **Context compression** — automatic at ~92% window usage, summarize and migrate
- **Diffs-first workflow** — minimal edits, easy review/revert

**Applicability to us:**
- ✅ Single sub-agent model matches our researcher→brain delegation
- ✅ TODO list pattern → our WIP.md serves the same function
- ✅ Context compression → our 500-char truncation per observation step
- ⚠️ Their loop is interactive (human in the loop); ours is autonomous (cron-triggered)

### Pattern 2: SWE-Agent — Thought-Action-Observation with ACI

**Source:** [SWE-agent NeurIPS 2024](https://arxiv.org/abs/2405.15793)

**Architecture:** Every step is an atomic `{thought, command}` pair. The Agent-Computer Interface (ACI) translates commands into environmental actions and summarizes results for the model. Malformed generations trigger error response → retry.

**Key innovations:**
- **Custom ACI** — purpose-built interface between LLM and environment (not raw shell)
- **History collapse** — observations older than last 5 collapsed to single-line summaries
- **Error recovery** — malformed output → structured error → model retries (not crash)
- **Live-SWE-agent** (2025) — agent evolves its own tool interface at runtime

**Applicability to us:**
- ✅ History collapse → our EDO index is exactly this (old decisions → one-line summary)
- ✅ Error recovery → our circuit breaker (3 failures → escalate, not crash)
- ✅ Custom ACI → our queries.sh and mc-billing.sh are purpose-built interfaces
- ⚠️ SWE-agent is single-session; ours spans multiple sessions (hourly)

### Pattern 3: Devin — Checkpoint-Based Plan-Implement-Test-Fix

**Source:** [Devin Agents 101](https://devin.ai/agents101)

**Architecture:** `Plan → Implement chunk → Test → Fix → Checkpoint review → Next chunk`. Human checkpoints after major phases.

**Key innovations:**
- **Self-verification** — agents must have access to CI, tests, linters, type checkers
- **Fresh start preference** — if agent is going in circles, restart with clean instructions (don't iterate on broken state)
- **Checkpoint pattern** — explicit pauses after significant phases for human review

**Applicability to us:**
- ✅ Self-verification → our outcome verification via external signals (git status, PR state, metrics)
- ✅ Fresh start → our stale reasoning detection (fresh context per run, not accumulated history)
- ✅ Checkpoint = each hourly run is a natural checkpoint
- ✅ "If it's going in circles, discontinue" → our circuit breaker (3 failures → skip)

### Pattern 4: Reflexion — Generate-Evaluate-Reflect with Episodic Memory

**Source:** [Reflexion NeurIPS 2023](https://arxiv.org/abs/2303.11366), [Reflecting on Reflexion](https://nanothoughts.substack.com/p/reflecting-on-reflexion)

**Architecture:** `Generate solution → Evaluate against tests → If fail: reflect on why → Store reflection → Retry with reflection context`. Achieved 91% pass@1 on HumanEval vs GPT-4's 80%.

**Key innovations:**
- **Verbal reinforcement** — reflections stored as natural language, not numeric rewards
- **Episodic memory** — reflections indexed to specific problem instances, retrieved on similar problems
- **Separate error ID from correction** — two distinct LLM calls: "what went wrong?" then "how to fix?"
- **Test-driven** — correctness determined by external tests, not self-evaluation

**Applicability to us:**
- ✅ Episodic memory → our WIP.md "Completed" section stores reflections per completed item
- ✅ External evaluation → our EDO outcome verification (metrics, git, gh CLI)
- ✅ Separate diagnosis from action → our Phase 1 (gather) separate from Phase 2 (decide)
- 🔑 **KEY INSIGHT**: Reflections should be retrieved when working on SIMILAR tasks, not just listed chronologically. Our current WIP.md design stores reflections but doesn't retrieve by similarity.

### Pattern 5: BabyAGI — Task-Driven Loop with Vector Retrieval

**Source:** [BabyAGI](https://babyagi.org/), [IBM: What is BabyAGI](https://www.ibm.com/think/topics/babyagi)

**Architecture:** `Execute task → Store result as embedding → Reprioritize task list → Retrieve relevant past results for next task → Repeat`.

**Key innovations:**
- **Vector-indexed task results** — past outcomes stored as embeddings, retrieved by relevance
- **Dynamic reprioritization** — task list reordered after each execution based on results
- **Context from past results** — before executing, query vector DB for most relevant past results

**Applicability to us:**
- ✅ Task prioritization → our _index.md priority ordering (finish-before-starting)
- ⚠️ Vector retrieval is overkill for our scale (10-50 work items, not thousands)
- ✅ Dynamic reprioritization concept → reading _index.md each run (fresh priorities)
- 🔑 **KEY INSIGHT**: We don't need vector search. Simple keyword match on WIP.md reflections is sufficient at our scale. But the principle is sound: retrieve relevant past experience before acting.

### Pattern 6: Google BATS — Budget-Aware Tool Spending

**Source:** [BATS arxiv](https://arxiv.org/abs/2511.17006), [CIO coverage](https://www.cio.com/article/4106863/google-unveils-budget-tracker-and-bats-framework-to-rein-in-ai-agent-costs.html)

**Architecture:** Inject continuous budget signal ("Query budget remaining: N") into the agent's reasoning loop. Agent conditions behavior on real-time resource availability.

**Key innovations:**
- **Budget Tracker module** — live counter injected into every reasoning step
- **Comparable accuracy with 40% fewer tool calls** — budget awareness alone cuts waste
- **Planning module** adjusts effort to match remaining budget
- **Verification module** decides "dig deeper" vs "pivot" based on resources

**Applicability to us:**
- ✅ **CRITICAL** — our agent MUST see its cost data. BATS proves budget-unaware agents waste 40% more.
- ✅ Budget header → our `_budget_header.md` serves this exact function
- ✅ Dig deeper vs pivot → our dispatch-or-no-op decision based on budget gate
- 🔑 **KEY INSIGHT**: Budget signal must be CONTINUOUS and VISIBLE, not just a gate check. The agent should see remaining budget in its context at decision time, not just get a pass/fail.

### Pattern 7: Plan-and-Execute over ReAct for Long-Running Tasks

**Source:** [LangChain Planning Agents](https://blog.langchain.com/planning-agents/), [Practical Comparison](https://dev.to/jamesli/react-vs-plan-and-execute-a-practical-comparison-of-llm-agent-patterns-4gh9), [Plan-and-Act arxiv](https://arxiv.org/html/2503.09572v3)

**Comparison data:**
| Dimension | ReAct | Plan-and-Execute |
|-----------|-------|------------------|
| Completion accuracy | 85% | 92% |
| Cost per task | $0.06-0.09 | $0.09-0.14 |
| Goal drift risk | High (after many steps) | Low (master plan as anchor) |
| Failure recovery | Derailed by single failure | Falls back to master plan |

**Key insight:** "If a single step fails, the agent doesn't just give up. It can refer back to the master plan, reassess, or ask the planner to revise." ReAct agents are easily derailed because they have no master plan to fall back on.

**Applicability to us:**
- ✅ Our operator loop IS plan-and-execute: the 9-step procedure is the plan, brain subagent executes
- ✅ Master plan as anchor → our SKILL.md procedure prevents goal drift
- ✅ Different models for different tasks → researcher (cheap) plans, brain (strong) executes
- 🔑 **KEY INSIGHT**: Our design is already plan-and-execute. The procedure IS the plan. Don't let the brain subagent deviate from the dispatched lifecycle skill.

### Pattern 8: Circuit Breaker for Agent Failure Handling

**Source:** [2026 Playbook](https://promptengineering.org/agents-at-work-the-2026-playbook-for-building-reliable-agentic-workflows/), [AI Agent Safety](https://www.syntaxia.com/post/ai-agent-safety-circuit-breakers-for-autonomous-systems)

**Architecture:** Monitor failure rate → threshold exceeded → circuit "opens" → halt retries → cooling period → escalate.

**Key findings:**
- Error propagation is the #1 reliability killer — one early mistake cascades
- Token budgets per loop and cost-threshold circuit breakers are primary levers
- Escalation ladders specify when agent must pause and request human approval
- Graceful degradation: pause, present state to human, resume from checkpoint

**Applicability to us:**
- ✅ Our 3-failure circuit breaker aligns with production patterns
- ✅ Escalation to Discord = our escalation ladder
- ✅ WIP.md "Blocked" section = the cooling period + state preservation
- 🔑 **KEY INSIGHT**: Don't just count failures — check if the failure is the SAME failure. 3 different failures might be progress; 3 identical failures means stuck.

### Anti-Pattern: ClawWork (HKUDS)

**Source:** [ClawWork GitHub](https://github.com/HKUDS/ClawWork)

ClawWork is a **browser automation agent** (Playwright wrapper with vision-based element detection). It's unrelated to our use case — it automates web UI interactions, not software engineering or operations. The HKUDS org also produces AutoAgent and AI-Researcher, but these are research frameworks, not production operator patterns.

**Verdict:** Not applicable. Our agent operates via CLI tools (bash, curl, git, gh), not browser automation.

## Synthesis: What Our Operator Loop Should Steal

Ranked by impact for a scheduled, autonomous, budget-constrained operator agent:

### 1. Budget Signal is Continuous (from BATS) — CRITICAL

The agent must see its remaining budget at decision time, not just hit a gate. Inject runway + cost data into the context BEFORE the pick/dispatch decision. Our `_budget_header.md` update (Step 5) before pick (Step 6) already does this, but the SKILL.md should explicitly instruct the agent to READ the budget data before deciding.

### 2. Plan-and-Execute Structure (from Plan-and-Act, Claude Code) — ALREADY DONE

Our 9-step procedure IS the plan. The brain subagent IS the executor. This is correct. Don't change it. The key discipline: the brain subagent gets ONE lifecycle skill and ONE work item. No scope creep.

### 3. External Verification Over Self-Evaluation (from Reflexion, SWE-Agent, Devin)

Never ask the agent "did you succeed?" Instead: check git status, PR state, test results, error metrics. Our EDO verification_method field does this. Our WIP expected_signal field does this. Both are correct.

### 4. Reflection-Retrieval (from Reflexion, BabyAGI) — ENHANCE

Current design stores reflections in WIP.md. Enhancement: before dispatching a lifecycle skill, check if any completed item used the SAME skill on a SIMILAR work item. If so, include that reflection in the brain subagent brief. At our scale (10-50 items), simple keyword matching suffices — no vector DB needed.

### 5. Fresh Context Per Run (from Devin, SWE-Agent history collapse)

Each hourly run starts fresh. No accumulated conversation history. Only persistent state: WIP.md, EDO index, _budget_header.md. This prevents stale reasoning from corrupting decisions. Our design already does this correctly.

### 6. Circuit Breaker with Same-Failure Detection (from production patterns)

Enhancement: track not just `fail_count` but `last_failure_reason`. If the same reason repeats 3 times → circuit break. If reasons differ → continue (agent might be making progress through different failure modes).

### 7. Single Sub-Agent at a Time (from Claude Code)

Our researcher→brain delegation already enforces this. One brain subagent, one work item, one lifecycle skill. No parallel execution. Sequential is safer for autonomous operation.

## What We Should NOT Do

1. **No vector databases** — overkill for 10-50 work items. Simple file-based memory (WIP.md) suffices.
2. **No multi-agent swarms** — single researcher + single brain is the right model for hourly cron.
3. **No ReAct for the operator loop** — Plan-and-Execute is better for structured, repeatable procedures.
4. **No browser automation** (ClawWork is irrelevant) — our agent uses CLI tools.
5. **No accumulated history across runs** — fresh context prevents stale reasoning. Only WIP.md, EDOs, and budget persist.
6. **No self-evaluation** — always use external signals (git, gh, metrics, tests).

## Recommendation

The task.0153 design is architecturally sound. It correctly uses:
- Plan-and-Execute (9-step procedure + brain executor)
- Budget awareness (mc-billing.sh → _budget_header.md → gate check)
- External verification (EDO verification_method, WIP expected_signal)
- Circuit breaker (3 failures → escalate)
- Fresh context per run (no accumulated history)
- Single sub-agent (researcher → brain)

**Three enhancements from this research:**

1. **Reflection retrieval** (from Reflexion): Before dispatch, scan WIP.md completed section for similar past work. Include relevant reflections in the brain subagent brief.

2. **Same-failure detection** (from circuit breaker research): Track `last_failure_reason` in WIP.md. Circuit break on 3 identical failures, not just 3 failures.

3. **Budget signal visibility** (from BATS): Ensure the agent explicitly reads and reasons about budget data before the pick/dispatch decision. Not just a pass/fail gate — the agent should see the numbers.

## Open Questions

1. **Reflection similarity matching**: Simple keyword match on work item type + lifecycle skill? Or something more sophisticated? Recommendation: start with exact skill match (e.g., "previous /implement reflections").

2. **Budget threshold tuning**: $5/day default — is this right? Need real burn rate data from a few runs to calibrate.

3. **WIP.md size management**: How many completed items to retain? Recommendation: last 10 (matches current design). Older items can be summarized into a single "lessons learned" section.

4. **Cross-run context**: Should the agent ever read the brain subagent's full output from the previous run? Recommendation: No. Only structured signals (WIP status, EDO verdict). Full output is noise.

## Proposed Layout

### No new project needed

This research directly informs task.0153 (already in proj.system-tenant-governance).

### Spec updates

None needed. The operator loop is a gateway skill, not an API contract. The EDO format and lifecycle dispatch are already specced.

### Task updates

**task.0153** should incorporate the three enhancements:
1. Add `last_failure_reason` field to WIP.md Active entries
2. Add reflection retrieval step before dispatch (scan completed section for same-skill reflections)
3. Ensure SKILL.md explicitly instructs reading budget data before pick decision (already partially there)

These are minor additions to the existing design, not new tasks.
