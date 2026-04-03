---
id: agent-contributor-protocol
type: research
title: "Agent Contributor Protocol: Multi-Agent Coordination on a Shared Codebase"
status: active
trust: draft
summary: Design for a protocol enabling multiple AI coding agents to coordinate work on a shared repo without human relay — communication mechanism, task claiming, structured review feedback, and external agent trust model.
read_when: Designing multi-agent dev workflows, building governance dispatch, planning agent-to-agent review pipelines, or evaluating how external AI contributors interact with the codebase.
owner: cogni-dev
created: 2026-04-02
verified: 2026-04-02
tags: [agents, workflow, protocol, research, coordination]
---

# Agent Contributor Protocol: Multi-Agent Coordination on a Shared Codebase

> spike: spike.0263 | date: 2026-04-02

## Question

How should multiple AI coding agents (Claude Code, Codex, custom OpenClaw agents) coordinate work on the Cogni codebase without a human relaying messages between them? What communication mechanism, task lifecycle, review format, and trust model enables this?

## Context

### The Problem: Human as Message Bus

During the task.0248 platform extraction, 3 dev agents and 1 reviewer worked concurrently. The human had to manually:

1. Copy "PR ready" from dev agent to reviewer agent
2. Copy review feedback from reviewer to dev agent
3. Track which agents were waiting vs working vs blocked

This worked for 3 agents but does not scale. The bottleneck is the human acting as message bus and scheduler.

### What We Have Today

**Development Lifecycle** ([development-lifecycle.md](../spec/development-lifecycle.md)):

- 9-status state machine: `needs_triage` through `done`
- Each `needs_*` status maps to exactly one `/command`
- Governance dispatch loop selects items by priority and status weight
- `claimed_by_run` field prevents double-dispatch
- `revision` counter with loop-limit escalation

**Work Items** (markdown frontmatter in `/work/items/`):

- `status`, `assignees`, `branch`, `pr`, `reviewer` fields
- `blocked_by` for dependency tracking
- `external_refs` for linking research docs

**Identity Model** ([identity-model.md](../spec/identity-model.md)):

- `actor_id` (UUID) as the economic subject
- Actor types: `user:{walletAddress}`, `agent:{agentId}`, `service:{serviceName}`
- Agent identity via `AgentRegistrationDocument` ([agent-registry.md](../spec/agent-registry.md))

**RBAC** ([rbac.md](../spec/rbac.md)):

- OpenFGA-based authorization
- Dual-check for delegated execution (agent acting on behalf of user)
- On-behalf-of (OBO) delegation model

**Agentic Interoperability** ([proj.agentic-interop](../../work/projects/proj.agentic-interop.md)):

- MCP server (Crawl/P0) — make agents addressable
- A2A agent cards (Walk/P1) — make agents discoverable
- Cross-agent delegation (Run/P2) — agents delegate to each other

**Manager Agent Concept** ([story.0091](../../work/items/story.0091.manager-agent-spawn-cli.md)):

- High-level orchestrator spawning specialized coding agents via CLI
- Manager maintains zero codebase awareness, delegates all implementation

### What the Industry Does

**SWE-bench / SWE-agent:**

- Single-agent benchmark. No multi-agent coordination protocol.
- Agent receives issue text, produces patch. No review loop, no claiming.
- Useful for evaluating individual agent capability, not team coordination.

**Devin (Cognition):**

- Proprietary agent-as-service. Internal orchestration is opaque.
- External interface: receives task via Slack/web, returns PR.
- No published protocol for multi-Devin coordination.
- Relevant pattern: task queue with single-assignment semantics.

**GitHub Copilot Workspace:**

- Human-initiated. Copilot proposes plan, human approves, Copilot implements.
- No agent-to-agent communication. Human remains in the loop for all transitions.
- Relevant pattern: plan-then-implement with explicit approval gate.

**OpenAI Codex (task queue model):**

- Task submitted via API or CLI. Runs in isolated sandbox.
- Returns diff/PR. No built-in review loop between Codex instances.
- Relevant pattern: fire-and-forget with result collection.
- `claude code` and Codex both support `RemoteTrigger` / scheduled agents for unattended execution.

**Claude Code (RemoteTrigger / scheduled agents):**

- Can be triggered remotely with a prompt and repo context.
- Returns result asynchronously. No built-in agent-to-agent messaging.
- Relevant pattern: remote invocation with async result.

**LangGraph / CrewAI / AutoGen (multi-agent frameworks):**

- In-process agent orchestration. Agents share memory within a single runtime.
- Not designed for distributed agents across separate machines/accounts.
- Relevant pattern: shared state graph with handoff nodes.

**AGENTS.md Convention (OpenAI):**

- Repo-level instructions for AI agents. Read-only context, not a protocol.
- No claiming, no status updates, no feedback loops.
- Relevant: establishes that agents read repo files for context.

**Key finding:** No existing system provides a distributed multi-agent contributor protocol over git. The closest analog is the human open-source contribution workflow (fork, branch, PR, review, merge) — which already uses git as the coordination substrate.

---

## Findings

### 1. Communication Mechanism

Three options evaluated:

#### Option A: Git-Native (Work Item Frontmatter + Git Fetch Polling)

Agents communicate by writing to work item frontmatter fields and committing. Other agents poll via `git fetch` + read frontmatter.

| Dimension           | Assessment                                               |
| ------------------- | -------------------------------------------------------- |
| Latency             | High (30-60s polling interval reasonable)                |
| Infrastructure cost | Zero — git is already the substrate                      |
| Agent compatibility | Universal — every agent can read/write files and run git |
| Durability          | Permanent — git history is the audit trail               |
| Complexity          | Low — no new infrastructure                              |
| Conflict risk       | Medium — concurrent frontmatter edits can conflict       |

**Mechanism:**

```
Agent A writes: status: needs_merge, pr: #123
Agent A commits + pushes to coordination branch
Agent B polls: git fetch origin && reads work item frontmatter
Agent B sees status changed, acts accordingly
```

**Conflict mitigation:** Use a dedicated `coordination` branch or write to separate files per agent (e.g., `work/claims/{agent_id}.{task_id}.yaml`). Alternatively, use atomic compare-and-swap via GitHub API (update file only if SHA matches).

#### Option B: GitHub-Native (PR Labels + Check Runs + gh CLI)

Agents communicate via GitHub API: PR labels for status, check run annotations for structured feedback, issue comments for messages.

| Dimension           | Assessment                                                |
| ------------------- | --------------------------------------------------------- |
| Latency             | Low (webhook-driven, sub-second with Actions)             |
| Infrastructure cost | Free tier sufficient; GitHub Actions minutes are the cost |
| Agent compatibility | Good — `gh` CLI available to Claude Code and Codex        |
| Durability          | GitHub retains PR/issue history                           |
| Complexity          | Medium — requires GitHub API calls, label conventions     |
| Conflict risk       | Low — GitHub handles concurrent API calls                 |

**Mechanism:**

```
Agent A: gh pr create --label "agent:ready-for-review"
GitHub Actions: triggers reviewer agent via workflow_dispatch
Reviewer: posts structured comment, sets label "agent:changes-requested"
GitHub Actions: triggers dev agent with feedback payload
```

#### Option C: Event Bus (Redis, workflow_dispatch, or MCP)

Agents communicate via an external message bus.

| Dimension           | Assessment                                                      |
| ------------------- | --------------------------------------------------------------- |
| Latency             | Very low (sub-second)                                           |
| Infrastructure cost | Requires Redis or equivalent running                            |
| Agent compatibility | Poor — Claude Code and Codex cannot natively subscribe to Redis |
| Durability          | Requires explicit persistence                                   |
| Complexity          | High — new infrastructure, new failure modes                    |
| Conflict risk       | Low — pub/sub handles ordering                                  |

#### Recommendation: Hybrid GitHub-Native + Git-Native (Option A + B)

Use **git-native work item frontmatter** as the source of truth for task state (compatible with existing development-lifecycle.md). Use **GitHub-native mechanisms** (PR labels, comments, workflow_dispatch) as the notification/trigger layer.

**Rationale:**

- Work item frontmatter is already the status source of truth in our lifecycle spec
- GitHub provides the notification mechanism that avoids polling latency
- Every agent tool (Claude Code, Codex) already has `gh` CLI and git access
- No new infrastructure required
- The git history becomes the complete audit trail of all coordination events

**State lives in git. Signals travel via GitHub.**

### 2. Structured Review Feedback Format

The reviewing agent needs to post feedback that the implementing agent can parse reliably.

#### Options Evaluated

| Format                                   | Parse reliability         | Agent compatibility                        | Visibility                    |
| ---------------------------------------- | ------------------------- | ------------------------------------------ | ----------------------------- |
| Free-text PR comment                     | Low — ambiguous           | Universal                                  | Good (GitHub UI)              |
| JSON block in PR comment                 | High — structured         | Universal (agents can parse fenced blocks) | Medium (readable but verbose) |
| Check run annotations                    | High — per-file, per-line | Medium (requires API)                      | Good (inline in PR diff)      |
| Separate review file committed to branch | High — structured         | Universal                                  | Low (not visible in PR UI)    |

#### Recommendation: Structured Markdown in PR Comment

Use a machine-readable markdown format in PR comments. This is both human-readable and agent-parseable.

````markdown
## Agent Review: {verdict}

<!-- agent-review-meta
{
  "verdict": "changes_requested",
  "reviewer": "agent:reviewer-1",
  "task_id": "task.0264",
  "blocking": ["ARCH_VIOLATION", "MISSING_TEST"],
  "timestamp": "2026-04-02T10:30:00Z"
}
-->

### Blocking Issues

1. **ARCH_VIOLATION** `src/features/foo/bar.ts:42`
   Feature layer imports directly from adapter. Must go through port.
   ```suggestion
   import { FooPort } from '@/ports/foo.port';
   ```
````

2. **MISSING_TEST** `src/features/foo/bar.ts`
   New public method `processItem()` has no unit test coverage.

### Non-Blocking Suggestions

1. **STYLE** `src/features/foo/bar.ts:15`
   Consider extracting the retry logic into a shared utility.

### Summary

Two blocking issues must be resolved before merge. The core logic is sound
but violates the hexagonal boundary (INV-ARCH-CRUISER-001) and lacks test
coverage for the new method.

```

**Why this format:**
- HTML comment contains machine-parseable JSON (verdict, blocking issues as typed categories)
- Markdown body is human-readable in the GitHub PR UI
- Implementing agent parses the HTML comment for structured data, reads markdown for details
- Categories (`ARCH_VIOLATION`, `MISSING_TEST`, `BREAKING_CHANGE`, `SECURITY`, `STYLE`) enable automated prioritization
- `suggestion` blocks use GitHub's native suggestion format for one-click apply

### 3. Task Claiming / Conflict Prevention

Agents must avoid double-assignment (two agents implementing the same task).

#### Options Evaluated

| Mechanism | Atomicity | Visibility | Complexity |
| --- | --- | --- | --- |
| Work item `assignees` field | Non-atomic (git push race) | Good | Low |
| Branch existence check | Atomic (GitHub rejects duplicate branch) | Good | Low |
| GitHub issue assignment API | Atomic | Good | Low |
| Lock files in repo | Non-atomic (same race as frontmatter) | Medium | Medium |
| External lock service (Redis) | Atomic | Low | High |

#### Recommendation: Two-Phase Claim via GitHub API + Frontmatter

**Phase 1 — Atomic claim:** Agent uses GitHub API to assign itself to the corresponding issue/PR. GitHub handles concurrency — if already assigned, the claim fails.

**Phase 2 — Record in frontmatter:** Agent updates work item frontmatter with `claimed_by: agent:{agentId}` and `claimed_at: {timestamp}`. This is the durable record.

```

claim(task_id):

1. gh issue edit {task_id} --add-assignee {agent_id}
   → if already assigned: CLAIM_DENIED (another agent has it)
   → if success: proceed
2. Update work item frontmatter: claimed_by: agent:{agent_id}
3. git commit + push
4. If push fails (conflict): unclaim via API, retry or pick different task

```

**Fallback for pure git-native (no GitHub issues):** Use branch naming convention as the atomic claim. Agent creates branch `agent/{agent_id}/{task_id}`. If the branch already exists on remote, another agent claimed it.

**Stale claim detection:** If `claimed_at` is older than a configurable timeout (e.g., 2 hours for implementation, 30 minutes for review), the governance runner may revoke the claim and re-queue the task.

### 4. External Agent Trust Model

How does the system distinguish trusted internal agents from external contributors?

#### Trust Tiers

| Tier | Identity | Permissions | Example |
| --- | --- | --- | --- |
| **Internal** | GitHub actor in org allowlist + signed commits (GPG/SSH) | Full: create branches, push to protected paths, merge | Claude Code agent running in Cogni CI |
| **Trusted External** | GitHub actor with verified identity binding (user_bindings table) + contributor agreement | Create branches, push to non-protected paths, create PRs | Partner org's Codex agent with a registered identity |
| **Untrusted External** | Any GitHub actor not in allowlist | Fork + PR only (standard open-source model) | Random agent submitting a drive-by fix |

#### Identity Resolution

External agents are identified by their **GitHub actor** (the account that pushes commits and creates PRs). This maps to the existing identity model:

1. **GitHub actor** → `user_bindings` table (provider: `github`, external_id: GitHub username)
2. **user_id** → `actor_id` mapping for attribution
3. **actor_id** → OpenFGA permission check for allowed actions

For agents specifically:
- An agent's GitHub actor may be a bot account (e.g., `cogni-agent-1[bot]`)
- Bot accounts are registered in `agent_registrations` table with `signed_by` field
- The `AgentIdentityPort` resolves bot account → `agent:{agentId}` actor type

#### Enforcement Points

| Gate | Mechanism | When |
| --- | --- | --- |
| Branch push | GitHub branch protection rules | On push |
| PR creation | GitHub Actions workflow validates actor against allowlist | On PR open |
| Task claiming | Governance runner checks actor permission before granting claim | On claim attempt |
| Code review | Review agent verifies commit signatures and authorship | During review |
| Merge | Required status checks + approved review from trusted reviewer | On merge attempt |

#### Relationship to Existing Systems

- **RBAC** ([rbac.md](../spec/rbac.md)): The `agent:{agentId}` actor type and OBO delegation model handle permission checks
- **Agent Registry** ([agent-registry.md](../spec/agent-registry.md)): `AgentRegistrationDocument` and content hashing provide agent identity verification
- **User Identity** ([decentralized-user-identity.md](../spec/decentralized-user-identity.md)): `user_bindings` table maps GitHub accounts to internal user_ids
- **x402** ([proj.x402-e2e-migration](../../work/projects/proj.x402-e2e-migration.md)): External agents may pay per-request for costed endpoints (compute, LLM inference) — this is a dependency, not designed here

### 5. The Contributor Workflow State Machine

Building on the existing development lifecycle, the agent contributor protocol adds coordination semantics:

```

                        ┌─────────────────────────────────────────┐
                        │         GOVERNANCE DISPATCH              │
                        │  Selects task, identifies agent,         │
                        │  initiates claim sequence                │
                        └──────────────┬──────────────────────────┘
                                       │
                                       ▼

┌──────────┐ claim(task*id) ┌──────────────┐ begin_work ┌────────────────┐
│ idle │ ───────────────► │ claimed │ ────────────► │ implementing │
└──────────┘ └──────────────┘ └───────┬────────┘
▲ │ │
│ claim_timeout submit(branch,
│ or unclaim() summary)
│ │ │
│ ▼ ▼
│ ┌──────────┐ ┌──────────────┐
│ │ idle │ │ submitted │
│ └──────────┘ └──────┬───────┘
│ │
│ assign_reviewer
│ │
│ ▼
│ ┌─────────────┐
│ │ in_review │
│ └──────┬──────┘
│ │
│ ┌─────────────────┼──────────────┐
│ │ │
│ ▼ ▼
│ ┌──────────────┐ ┌────────────┐
│ │ approved │ │ changes* │
│ └──────┬───────┘ │ requested │
│ │ └─────┬──────┘
│ merge() │
│ │ revision++
│ ▼ back to implementing
│ ┌──────────┐ │
└──────────────────────────────────│ done │◄─────────────────────────┘
└──────────┘ (if revision >= 5:
blocked + escalate)

```

#### Mapping to Existing Development Lifecycle

| Protocol State | Lifecycle Status | Transition Trigger |
| --- | --- | --- |
| `idle` | `needs_implement` (unclaimed) | Task exists, no agent assigned |
| `claimed` | `needs_implement` + `claimed_by` set | Agent claims task |
| `implementing` | `needs_implement` + `claimed_by` set + branch exists | Agent begins work |
| `submitted` | `needs_closeout` | Agent finishes implementation |
| `in_review` | `needs_merge` + `reviewer` set | PR created, reviewer assigned |
| `approved` | `needs_merge` + review approved | Reviewer approves |
| `changes_requested` | `needs_implement` + `revision` incremented | Reviewer requests changes |
| `done` | `done` | PR merged |

The protocol states are not new statuses — they are **the existing statuses plus coordination metadata** (`claimed_by`, `reviewer`, `revision`). This means zero changes to the status enum or lifecycle spec.

#### Operations

```

claim(task_id, agent_id) → Result<ClaimGrant, ClaimDenied>
Precondition: task.status = needs_implement, task.claimed_by = null
Effect: task.claimed_by = agent_id, task.claimed_at = now()
Atomic via: GitHub issue assignment API

unclaim(task_id, agent_id) → void
Precondition: task.claimed_by = agent_id
Effect: task.claimed_by = null, task.claimed_at = null

submit(task_id, branch, summary) → void
Precondition: task.claimed_by = caller, branch exists with commits
Effect: task.status = needs_closeout
Side-effect: /closeout creates PR, sets task.pr

request_review(task_id, reviewer_agent_id) → void
Precondition: task.status = needs_merge, task.pr set
Effect: task.reviewer = reviewer_agent_id
Trigger: GitHub workflow_dispatch or label change notifies reviewer

post_review(task_id, verdict, feedback) → void
Precondition: task.reviewer = caller, task.status = needs_merge
Effect: if verdict=approved → merge-ready
if verdict=changes_requested → task.status = needs_implement, revision++
Format: Structured markdown comment (see Section 2)

check_status(task_id) → TaskState
Effect: none (read-only)
Returns: current status, claimed_by, reviewer, revision, pr

````

### 6. Notification / Trigger Mechanism

How does an agent know it needs to act?

#### GitHub Actions as the Orchestrator

```yaml
# .github/workflows/agent-dispatch.yml
on:
  # Trigger when work item frontmatter changes
  push:
    paths:
      - 'work/items/**'
  # Trigger when PR labels change
  pull_request:
    types: [labeled, review_requested]
  # Manual trigger for governance dispatch
  workflow_dispatch:
    inputs:
      task_id:
        description: 'Task to dispatch'
      agent_type:
        description: 'Agent to invoke (claude-code, codex, custom)'
      command:
        description: 'Lifecycle command (/implement, /review-implementation, etc.)'
````

**Flow:**

1. Governance runner (scheduled Action or manual dispatch) selects next task
2. Action invokes agent via appropriate mechanism:
   - **Claude Code:** `claude --remote-trigger` with task context
   - **Codex:** API call to Codex task queue
   - **OpenClaw:** MCP tool call or direct API
3. Agent works, commits, pushes
4. Push triggers next workflow step (review dispatch, status update)

This aligns with the existing governance dispatch loop in `development-lifecycle.md` but replaces the single-agent model with multi-agent dispatch.

---

## Updated Findings (2026-04-02): OSS Landscape Has Shifted

The original research (above) proposed a bespoke protocol with shell scripts and GitHub Actions. Further investigation reveals three existing systems that collectively solve this problem:

### Claude Agent Teams (experimental)

Anthropic's Agent Teams feature provides: shared task list with dependencies, peer-to-peer mailbox between agents, file locking for conflict prevention, and hooks (`TeammateIdle`, `TaskCreated`, `TaskCompleted`) for quality gates. This is the internal coordination primitive we were building from scratch.

**Limitation:** Experimental. No session resumption for teammates. Lead agent is fixed. Best for parallel work within a single session, not long-running async coordination across days.

### MCP Tasks Primitive (Nov 2025 spec)

The MCP spec now includes async `Tasks` — MCP servers can perform long-running operations. Multiple agents sharing an MCP server can coordinate through shared state. This is the programmatic API layer.

### Google A2A Protocol (v0.3, Linux Foundation)

Agent Cards for discovery + JSON-RPC task objects for coordination. External agents discover Cogni's capabilities via a well-known URL, submit tasks, and receive results. This is the external federation layer.

### Also relevant

- **ComposioHQ agent-orchestrator**: OSS tool that creates worktree-isolated agents per PR, routes CI failures and review comments back. GitHub-native pattern.
- **agentapi (Coder)**: HTTP wrapper around Claude Code / Codex sessions — gives any agent an HTTP endpoint another agent can POST to.
- **OpenHands AgentDelegateAction**: Explicit delegation to agent type, mature OSS framework.

## Recommendation

### Revised architecture: compose OSS primitives, don't build bespoke

The protocol has three layers. Each layer uses an existing primitive:

| Layer                     | Primitive                             | What it does                                                     | Status                                |
| ------------------------- | ------------------------------------- | ---------------------------------------------------------------- | ------------------------------------- |
| **Internal coordination** | Claude Agent Teams                    | Shared task list + mailbox between agents in one session         | Experimental, usable now              |
| **Programmatic API**      | MCP server (`@cogni/contributor-mcp`) | `claim_task`, `submit_work`, `check_status`, `post_review` tools | Build (thin, wraps work-item CRUD)    |
| **External federation**   | A2A Agent Card                        | External agents discover contributor tools via well-known URL    | Build when proj.agentic-interop ships |

### Phase 1: MCP contributor server (Crawl)

Build a single MCP server that exposes the contributor workflow as tools:

```
@cogni/contributor-mcp (MCP server)
  tools:
    cogni_list_tasks(status_filter?) → TaskSummary[]
    cogni_claim_task(task_id) → ClaimResult
    cogni_task_status(task_id) → TaskDetail
    cogni_submit_work(task_id, branch, summary) → SubmitResult
    cogni_post_review(task_id, verdict, feedback) → void
```

Implementation: each tool reads/writes `work/items/*.md` frontmatter via the existing `@cogni/work-items` package (which already has YAML frontmatter parsing). No custom state machine — the lifecycle spec's status enum IS the state machine.

Any agent that supports MCP (Claude Code, Codex via MCP bridge, custom agents) can connect to this server and participate in the contributor workflow.

**Why MCP over custom API endpoints:**

- MCP servers are discoverable and self-describing (tool schemas)
- Claude Code, the primary agent, natively supports MCP
- No auth infrastructure needed for local agents (MCP runs in-process)
- External agents access via the existing API proxy + MCP-over-HTTP bridge (proj.agentic-interop)

### Phase 2: Agent Teams integration (Walk)

When Agent Teams stabilizes, use it as the coordination runtime for multi-agent sessions:

- Lead agent (governance dispatcher) spawns teammate agents via Agent Teams
- Teammates discover tasks via the MCP contributor server
- Teammates communicate progress via the Agent Teams mailbox
- Review feedback flows through MCP `post_review` tool

### Phase 3: A2A federation (Run)

External agents discover the contributor MCP server via an A2A Agent Card served at `/.well-known/agent.json`. Authentication via OAuth + x402 for costed operations.

---

## Open Questions

1. **Worktree isolation:** Should each agent get its own git worktree (avoids branch conflicts) or share a single clone? Worktrees are cleaner but require filesystem management. The current `claimed_by_run` + branch naming may suffice.

2. **Reviewer assignment strategy:** Round-robin? Expertise-based? The governance runner needs a reviewer selection policy. For Phase 1, a single designated reviewer agent is sufficient.

3. **Cost attribution for review cycles:** When a reviewer requests changes and the implementer re-works, who bears the cost of the extra cycle? The existing `charge_receipts` pipeline attributes cost to the actor, but review-triggered rework may need separate attribution.

4. **Merge authority:** Should an agent be able to merge its own approved PR, or must a human (or designated merge-bot) perform the final merge? For Phase 1, human merge is safest.

5. **Partial work / handoff:** If an agent times out or fails mid-implementation, how does another agent pick up partial work? The branch contains partial commits — the new agent needs to assess and continue. This is similar to human developer handoffs.

6. **Cross-node coordination:** When work spans multiple nodes (operator + poly + resy), how do agents coordinate across node boundaries? The existing multi-node test infrastructure (task.0258) provides the testing substrate, but the coordination protocol may need node-aware task decomposition.

---

## Proposed Layout

### New Spec

**`docs/spec/agent-contributor-protocol.md`** — As-built spec for the contributor protocol once Phase 1 is implemented. Covers:

- State machine (maps to existing lifecycle statuses)
- Structured review feedback format
- Claim/unclaim operations
- Trust tiers and enforcement points

### New Project

**`proj.agent-contributor-protocol`** — Implementation project with three phases:

| Phase          | Deliverables                                                                                        | Dependencies                                           |
| -------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| **Crawl (P0)** | GitHub Actions dispatch workflow, structured review format, claim helpers, agent invocation scripts | None (uses existing git + GitHub)                      |
| **Walk (P1)**  | MCP tools for task operations, automated reviewer assignment, cost attribution for review cycles    | proj.agentic-interop P0 (MCP server)                   |
| **Run (P2)**   | A2A contributor discovery, external agent onboarding, x402 billing for contributed work             | proj.agentic-interop P1 (A2A), proj.x402-e2e-migration |

### Follow-Up Work Items

| Item         | Type  | Summary                                                                                    |
| ------------ | ----- | ------------------------------------------------------------------------------------------ |
| `task.0264`  | task  | Implement GitHub Actions governance dispatch workflow for multi-agent coordination         |
| `task.0265`  | task  | Define and document structured agent review comment format with parseable metadata         |
| `spike.0266` | spike | Evaluate Claude Code remote trigger and Codex API for unattended agent invocation patterns |

### Connection to Existing Projects

| Project                                                                                   | Relationship                                             |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| [proj.development-workflows](../../work/projects/proj.development-workflows.md)           | Parent — this protocol extends the development lifecycle |
| [proj.agentic-interop](../../work/projects/proj.agentic-interop.md)                       | Phase 2+ depends on MCP server and A2A agent cards       |
| [proj.x402-e2e-migration](../../work/projects/proj.x402-e2e-migration.md)                 | Phase 3 uses x402 for external agent billing             |
| [proj.agent-registry](../../work/projects/proj.agent-registry.md)                         | Agent identity resolution for trust tiers                |
| [proj.docs-system-infrastructure](../../work/projects/proj.docs-system-infrastructure.md) | Work item frontmatter validation must support new fields |
