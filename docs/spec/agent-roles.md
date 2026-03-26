---
id: agent-roles
type: spec
title: Agent Workforce — LangGraph Roles on Temporal Schedules
status: draft
trust: draft
summary: Multi-role agent workforce using configurable LangGraph graphs, one reusable Temporal workflow, and WorkItemPort queue filtering
read_when: Adding a new agent role, understanding the agent workforce architecture, configuring role behavior
owner: derekg1729
created: 2026-03-26
verified: 2026-03-26
tags: [agents, governance, roles, langgraph, temporal]
---

# Agent Workforce — LangGraph Roles on Temporal Schedules

> A Role = catalog entry (graph + prompt + tools) + queue filter + Temporal schedule. That's it.

## Problem

One heartbeat loop picks one item from a global queue. No way to have a Git Reviewer agent focused on PRs while a PM agent triages incoming work. PR #562 sat for 2 weeks because no agent owned the outcome.

## Key Insight

Every graph factory in `@cogni/langgraph-graphs` is a 3-line wrapper around `createReactAgent` differing only in system prompt and tools. The "role" concept already exists — it's a catalog entry. We just need:

1. A parameterized graph factory (system prompt as config, not hardcoded)
2. A queue filter (which work items this role sees)
3. A reusable Temporal workflow (the execution loop)

## Design

### The Five Primitives (all exist today)

| Primitive             | What                                      | Exists?                               |
| --------------------- | ----------------------------------------- | ------------------------------------- |
| **Graph**             | LangGraph ReAct agent — the role's brain  | Yes: `createReactAgent` in 5 variants |
| **GraphExecutorPort** | Runs any graph with billing/observability | Yes: fully decorated                  |
| **GraphRunWorkflow**  | Temporal orchestration for any graph      | Yes: generic, proven                  |
| **Temporal Schedule** | When to run (cron/webhook)                | Yes: governance schedules             |
| **WorkItemQueryPort** | Filtered work queue                       | Yes: `@cogni/work-items`              |

### Change 1: Parameterize the Graph Factory

Current state: each graph has its own factory with a hardcoded system prompt.

```typescript
// Before — one file per "role", identical except for prompt
export function createPoetGraph(opts: CreateReactAgentGraphOptions) {
  return createReactAgent({
    llm: opts.llm,
    tools: [...opts.tools],
    messageModifier: POET_SYSTEM_PROMPT, // ← hardcoded
    stateSchema: MessagesAnnotation,
  });
}
```

Add optional `systemPrompt` to `CreateReactAgentGraphOptions`:

```typescript
export interface CreateReactAgentGraphOptions {
  readonly llm: LanguageModelLike;
  readonly tools: ReadonlyArray<StructuredToolInterface>;
  readonly responseFormat?: {
    readonly prompt?: string;
    readonly schema: unknown;
  };
  readonly systemPrompt?: string; // NEW — override default prompt
}
```

Then a single generic factory:

```typescript
export function createOperatorGraph(opts: CreateReactAgentGraphOptions) {
  if (!opts.systemPrompt)
    throw new Error("operator graph requires systemPrompt");
  return createReactAgent({
    llm: opts.llm,
    tools: [...opts.tools],
    messageModifier: opts.systemPrompt,
    stateSchema: MessagesAnnotation,
  });
}
```

Existing graph factories (poet, brain, etc.) are **unchanged** — they keep their hardcoded prompts. The new `createOperatorGraph` is for roles that are defined by configuration rather than code.

### Change 2: Catalog Entries for Roles

Each role is a catalog entry. Adding a role = adding config, not code.

```typescript
// New catalog entries alongside existing ones
const LANGGRAPH_CATALOG = {
  // ... existing graphs unchanged ...

  [CEO_OPERATOR_GRAPH_NAME]: {
    displayName: "CEO Operator",
    description: "Strategic operator — triages, prioritizes, dispatches work",
    toolIds: CEO_TOOL_IDS, // work-item query, metrics, etc.
    graphFactory: createOperatorGraph,
    systemPrompt: CEO_OPERATOR_PROMPT, // NEW field on CatalogEntry
  },

  [GIT_REVIEWER_GRAPH_NAME]: {
    displayName: "Git Reviewer",
    description: "Owns PR lifecycle — review, fix CI, merge or reject",
    toolIds: GIT_REVIEWER_TOOL_IDS, // github PR tools, CI tools
    graphFactory: createOperatorGraph,
    systemPrompt: GIT_REVIEWER_PROMPT,
  },
};
```

The `CatalogEntry` interface gains an optional `systemPrompt` field. When present, it's passed to the graph factory. This is the only schema change needed.

### Change 3: One Reusable Temporal Workflow

Following the proven `PrReviewWorkflow` pattern: gather context → run graph → act on result.

```typescript
// packages/temporal-workflows/src/workflows/role-heartbeat.workflow.ts

export interface RoleHeartbeatInput {
  roleId: string; // "ceo-operator", "git-reviewer"
  graphId: string; // "langgraph:ceo-operator"
  model: string; // "openai/gpt-4o"
  queueFilter: {
    // Maps to WorkQuery
    statuses?: string[];
    labels?: string[];
    types?: string[];
  };
}

export async function RoleHeartbeatWorkflow(input: RoleHeartbeatInput) {
  // Activity: filter queue + pick highest-priority item
  const item = await pickNextItemActivity(input.queueFilter);
  if (!item) return { outcome: "no_op", roleId: input.roleId };

  // Activity: build context messages (item details, relevant data)
  const messages = await buildRoleContextActivity(input.roleId, item);

  // Reuse existing GraphRunWorkflow — no new execution code
  const result = await executeChild(GraphRunWorkflow, {
    args: [
      {
        graphId: input.graphId,
        messages,
        model: input.model,
        billingAccountId: SYSTEM_TENANT_BILLING_ACCOUNT,
      },
    ],
    workflowId: `role:${input.roleId}:${item.id}`,
  });

  // Activity: act on the graph's output (update item status, post to Discord)
  await processOutcomeActivity(input.roleId, item, result);

  return {
    outcome: result.ok ? "success" : "error",
    roleId: input.roleId,
    itemId: item.id,
  };
}
```

**This is ~30 lines.** It reuses `GraphRunWorkflow` for all the heavy lifting (billing, observability, error handling). No new execution infrastructure.

### Change 4: Temporal Schedules

One schedule per role in `repo-spec.yaml`:

```yaml
governance:
  schedules:
    - charter: HEARTBEAT
      cron: "0 * * * *"
      entrypoint: HEARTBEAT
      # Existing — fires RoleHeartbeatWorkflow with roleId=ceo-operator

    - charter: PR_LIFECYCLE
      cron: "0 */4 * * *"
      entrypoint: PR_LIFECYCLE
      # New — fires RoleHeartbeatWorkflow with roleId=git-reviewer
```

Schedule configuration follows temporal-patterns spec: `overlap: SKIP`, `catchupWindow: 0`, `workflowId: heartbeat:${roleId}:${timeBucket}`.

### What Each Role Looks Like

#### CEO Operator

```
Schedule: hourly
Queue filter: all actionable statuses
Graph: langgraph:ceo-operator
Tools: work_item_query, metrics_query, discord_post
Prompt: "You are the CEO operator. Pick the highest-priority item and execute it..."
```

The CEO's system prompt contains the policy logic (tier gating, finish-before-starting). The graph has tools to query work items and metrics. The Temporal workflow provides the execution loop.

#### Git Reviewer

```
Schedule: every 4 hours + webhook (walk phase)
Queue filter: { statuses: ["needs_merge"] }
Graph: langgraph:git-reviewer
Tools: github_pr_read, github_pr_comment, github_check_status, work_item_transition
Prompt: "You own the PR lifecycle. Review, fix CI, merge or reject..."
```

The reviewer's power comes from its **tools** (can read PRs, push fixes, merge) and **prompt** (instructions to drive to completion, not just comment). The queue filter ensures it only sees `needs_merge` items.

### Relationship to Existing Infrastructure

```
repo-spec.yaml schedule
  │
  ▼ Temporal Schedule fires (SCHEDULES_OVER_CRON)
  │
  ▼ RoleHeartbeatWorkflow(roleId, graphId, queueFilter, model)
  │
  ├─ pickNextItemActivity ─── WorkItemQueryPort (existing)
  │
  ├─ buildRoleContextActivity ─── format item + signals as messages
  │
  ├─ executeChild(GraphRunWorkflow) ─── GraphExecutorPort (existing)
  │   │
  │   └─ LANGGRAPH_CATALOG[graphId].graphFactory(opts)
  │       └─ createReactAgent({ llm, tools, messageModifier: systemPrompt })
  │
  └─ processOutcomeActivity ─── update item status, post to Discord
```

Everything after the first `│` already exists. New code: `RoleHeartbeatWorkflow` (~30 lines), `pickNextItemActivity` (~20 lines), `buildRoleContextActivity` (~30 lines), `processOutcomeActivity` (~20 lines), `createOperatorGraph` (~10 lines), catalog entries (~20 lines), prompts (~100 lines each).

### What We Delete

- `mc-controller.ts` — replaced by `RoleHeartbeatWorkflow`
- `mc-status.sh` — health signals become a tool the graph can call
- `mc-pick.ts` — replaced by `pickNextItemActivity`
- OpenClaw as the primary agent runtime for governance — LangGraph replaces it

OpenClaw remains for Discord-bound conversational agents (poet, ideas, development channels). The governance/operator agents move to LangGraph + Temporal.

## Invariants

- `CATALOG_IS_ROLE_REGISTRY`: Each operator role = one catalog entry. Adding a role = adding config.
- `ONE_WORKFLOW_ALL_ROLES`: `RoleHeartbeatWorkflow` is reusable. No per-role workflow code.
- `GRAPH_RUNS_VIA_EXECUTOR`: All graph execution flows through `GraphExecutorPort` (billing, observability).
- `REUSE_GRAPH_RUN_WORKFLOW`: `RoleHeartbeatWorkflow` delegates to existing `GraphRunWorkflow` via `executeChild`.
- `QUEUE_FILTER_IS_WORKQUERY`: Role queue filters map to `WorkQuery` from `@cogni/work-items`.
- `TEMPORAL_SCHEDULE_AUTHORITY`: One Temporal Schedule per role. `overlap: SKIP`, `catchupWindow: 0`.
- `PROMPT_IS_THE_PLAYBOOK`: The system prompt IS the role's instructions. No separate SKILL.md for operator agents.
- `TOOLS_ARE_THE_CAPABILITIES`: What a role can do = which tools it has. Tool allowlist per catalog entry.
- `EXISTING_FACTORIES_UNCHANGED`: Poet, brain, ponderer, research, pr-review keep their hardcoded prompts.

## Crawl / Walk / Run

### Crawl

- Add `systemPrompt` to `CreateReactAgentGraphOptions` and `CatalogEntry`
- Create `createOperatorGraph` factory (~10 lines)
- Add `ceo-operator` and `git-reviewer` catalog entries
- Write system prompts for both roles
- Create `RoleHeartbeatWorkflow` + 3 activities
- Add operator tools: `work_item_query`, `work_item_transition`, `discord_post`
- Add `PR_LIFECYCLE` schedule to repo-spec.yaml
- Wire `HEARTBEAT` schedule to use `RoleHeartbeatWorkflow` instead of OpenClaw

### Walk

- Webhook triggers for Git Reviewer (GitHub PR events → Temporal signal)
- Outcome logging (`PlaybookOutcome` records for feedback loop)
- Dashboard: role snapshots via API contract
- PM and Data Analyst roles (new catalog entries + prompts)
- Prompt versioning and A/B testing

### Run

- Self-improving prompts (metaprompt reviews failures, proposes edits)
- Cross-role escalation (reviewer → PM → CEO)
- Role performance dashboard (success rate, time-to-resolution)

## Non-Goals

- **New graph types** — ReAct is sufficient. Research (supervisor) pattern available if needed later.
- **Agent-to-agent communication** — Roles don't talk. Escalation = new work item creation.
- **Dynamic role creation** — Roles are catalog entries, added via code.
- **OpenClaw replacement** — OpenClaw stays for Discord agents. Operator roles move to LangGraph.

## Related

- [Temporal Patterns](temporal-patterns.md) — Workflow/activity invariants
- [Graph Execution](graph-execution.md) — GraphExecutorPort, billing decorators
- [Development Lifecycle](development-lifecycle.md) — Status → command mapping
- [Work Items Port](work-items-port.md) — WorkItemQueryPort interface
