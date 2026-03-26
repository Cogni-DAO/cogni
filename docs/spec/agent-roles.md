---
id: agent-roles
type: spec
title: Agent Roles — Playbook-Driven Workforce Architecture
status: draft
trust: draft
summary: Standardized Role abstraction binding agents to work queues, playbooks, policies, and execution loops via Temporal schedules
read_when: Designing agent roles, adding new agent types, understanding the agent workforce architecture
owner: derekg1729
created: 2026-03-26
verified: 2026-03-26
tags: [agents, governance, roles, workforce]
---

# Agent Roles — Playbook-Driven Workforce Architecture

> A Role is the binding between an agent identity, the work it sees, the playbooks it follows, and the policy that governs its execution. Roles are the unit of agent workforce management.

## Problem

The current system has a single heartbeat → single agent → single work item loop. The CEO agent picks the globally highest-priority item and dispatches the matching lifecycle skill. This works for one agent but doesn't scale to:

- **Multiple concurrent agents** working different queues (Git Reviewer on PRs, PM on triage, Data Analyst on metrics)
- **Role-specific queue filtering** (the Git Reviewer shouldn't pick up design tasks)
- **Different trigger patterns** (hourly heartbeat vs. webhook-driven vs. daily digest)
- **Outcome ownership** (the Git Reviewer doesn't just review — it drives PRs to merge or rejection)
- **Escalation chains** (stale items escalate from specialist → PM → CEO)

## Key Insight: Skills Are Already Playbooks

SKILL.md files are exactly the "per-item-type guides" that playbook-driven systems need. The existing `status → /command` mapping in `development-lifecycle.md` is the playbook dispatch table. What's missing is the **Role** layer that scopes which items and playbooks each agent sees.

## Design

### What a Role Is

A Role is a **typed configuration** — not a CRUD entity, not a port. It answers four questions:

| Question             | Typed piece       | Existing infra                           |
| -------------------- | ----------------- | ---------------------------------------- |
| **Who?**             | `RoleDefinition`  | Extends `AgentDefinition` from task.0162 |
| **What work?**       | `WorkQueueFilter` | `WorkQuery` from `@cogni/work-items`     |
| **Which playbooks?** | `PlaybookMap`     | `statusToSkill` from `MissionPolicy`     |
| **What rules?**      | `RolePolicy`      | Extends `MissionPolicy` from task.0162   |

A Role is NOT:

- A port/adapter (no CRUD — roles are configuration, not stored entities)
- A Temporal workflow (the workflow is the execution loop; the role is its input)
- An OpenClaw agent (an OpenClaw agent may fulfil a role, but the role is backend-agnostic)

### Where Roles Live

**Crawl**: Code-first. `RoleDefinition` constants in TypeScript, co-located with the controller. Zod schemas, not YAML. We don't know the shape yet — premature config is premature abstraction.

**Walk**: After 3+ roles prove the shape, extract to `work/roles/role.*.yaml` files with a `RoleQueryPort` for the dashboard.

**Run**: Role definitions in repo-spec.yaml alongside schedules, enabling fork-time customization.

### Type Definitions

```typescript
// ── Role Definition ──────────────────────────────────

const RoleDefinitionSchema = z.object({
  id: z.string(), // "ceo", "git-reviewer", "pm", "data-analyst"
  name: z.string(), // "Chief Executive Officer"
  description: z.string(), // One-line purpose
  agentId: z.string().optional(), // OpenClaw agent ID (if bound to a specific agent)
  model: z.string(), // LLM model for brain dispatch
  workDir: z.string(), // Repo root
});

// ── Work Queue Filter ────────────────────────────────
// Scopes what items this role sees. Maps to WorkQuery fields.

const WorkQueueFilterSchema = z.object({
  statuses: z.array(z.string()).optional(), // Only these statuses
  labels: z.array(z.string()).optional(), // Must have ALL these labels
  types: z.array(z.string()).optional(), // Only these work item types
  assignedToSelf: z.boolean().optional(), // Only items assigned to this role's agent
  hasExternalRef: z
    .object({
      // Must have external ref matching
      system: z.string(), // e.g., "github"
      kind: z.string(), // e.g., "pull_request"
    })
    .optional(),
});

// ── Playbook Map ─────────────────────────────────────
// Which skill to invoke for each work item status.
// Extends the global status→skill map with role-specific overrides.

const PlaybookMapSchema = z.record(
  z.string(), // WorkItemStatus
  z.string() // Skill path, e.g., "/review-implementation"
);

// ── Role Policy ──────────────────────────────────────
// Execution rules for this role.

const RolePolicySchema = z.object({
  // Tier gating (inherited from MissionPolicy)
  tierThresholds: z.object({
    greenMinRunwayDays: z.number(),
    yellowMinRunwayDays: z.number(),
  }),

  // Queue ordering (which statuses to prioritize)
  statusWeights: z.record(z.string(), z.number()),

  // Tier degradation (which statuses are allowed per tier)
  yellowAllowedStatuses: z.array(z.string()),

  // Escalation
  escalation: z
    .object({
      staleAfterHours: z.number(), // Hours before item is "stale"
      escalateToRole: z.string().optional(), // Role ID to escalate to
      action: z.enum(["reassign", "notify", "comment"]),
    })
    .optional(),

  // Concurrency
  maxConcurrentItems: z.number().default(1),
});

// ── Complete Role ────────────────────────────────────

const RoleSchema = z.object({
  definition: RoleDefinitionSchema,
  queueFilter: WorkQueueFilterSchema,
  playbookMap: PlaybookMapSchema,
  policy: RolePolicySchema,
});
```

### Relationship to Existing Infrastructure

```
┌─────────────────────────────────────────────────┐
│  repo-spec.yaml                                 │
│  ┌───────────────────────────────────────┐      │
│  │ governance.schedules[]                │      │
│  │   - charter: HEARTBEAT               │      │
│  │     cron: "0 * * * *"                │      │
│  │     roles: [ceo]          ← NEW      │      │
│  │   - charter: PR_REVIEW               │      │
│  │     trigger: webhook      ← NEW      │      │
│  │     roles: [git-reviewer] ← NEW      │      │
│  └───────────────────────────────────────┘      │
└──────────────────┬──────────────────────────────┘
                   │ Temporal Schedule fires
                   ▼
┌─────────────────────────────────────────────────┐
│  mc-controller.ts (generalized)                 │
│                                                 │
│  1. Load RoleDefinition for roleId              │
│  2. OBSERVE: run signal providers               │
│  3. GATE: apply RolePolicy tier thresholds      │
│  4. FILTER: apply WorkQueueFilter               │
│  5. PICK: sort by statusWeights, pick top       │
│  6. MAP: playbookMap[status] → skill            │
│  7. SNAPSHOT: persist AgentSnapshot              │
│  8. OUTPUT: DispatchEnvelope to stdout           │
└──────────────────┬──────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────┐
│  SKILL.md (thin dispatch — identical per role)  │
│                                                 │
│  Read envelope → spawn /<skill> <itemId> → report│
└─────────────────────────────────────────────────┘
```

### How mc-controller.ts Generalizes

The current controller hardcodes CEO logic. The generalization is a single parameter:

```bash
# Before (task.0162 crawl)
npx tsx mc-controller.ts

# After (this spec)
npx tsx mc-controller.ts --role ceo
npx tsx mc-controller.ts --role git-reviewer
```

Internally, the controller:

1. Loads the `Role` constant by ID (crawl: from code; walk: from file)
2. Runs the same observe→gate→filter→pick→snapshot→output loop
3. The only difference is the `WorkQueueFilter` and `PlaybookMap`

This is a ~50-line diff to the existing controller, not a rewrite.

### Starter Roles

#### CEO (existing — renamed from hardcoded default)

```typescript
const CEO_ROLE: Role = {
  definition: {
    id: "ceo",
    name: "Chief Executive Officer",
    description: "Strategic oversight, escalation handler, weekly summaries",
    model: "cogni/deepseek-v3.2",
    workDir: "/repo/current",
  },
  queueFilter: {
    // Sees everything — no filter
  },
  playbookMap: {
    needs_triage: "/triage",
    needs_research: "/research",
    needs_design: "/design",
    needs_implement: "/implement",
    needs_closeout: "/closeout",
    needs_merge: "/review-implementation",
  },
  policy: {
    tierThresholds: { greenMinRunwayDays: 30, yellowMinRunwayDays: 7 },
    statusWeights: {
      needs_merge: 6,
      needs_closeout: 5,
      needs_implement: 4,
      needs_design: 3,
      needs_research: 2,
      needs_triage: 1,
    },
    yellowAllowedStatuses: ["needs_merge", "needs_closeout", "needs_triage"],
    maxConcurrentItems: 1,
  },
};
```

#### Git Reviewer (new — outcome-owning PR lifecycle agent)

```typescript
const GIT_REVIEWER_ROLE: Role = {
  definition: {
    id: "git-reviewer",
    name: "Git Reviewer",
    description: "Owns PR lifecycle: review → green CI → merge or reject",
    model: "cogni/deepseek-v3.2",
    workDir: "/repo/current",
  },
  queueFilter: {
    statuses: ["needs_merge"],
    // Future: hasExternalRef: { system: "github", kind: "pull_request" }
  },
  playbookMap: {
    needs_merge: "/review-implementation",
  },
  policy: {
    tierThresholds: { greenMinRunwayDays: 30, yellowMinRunwayDays: 7 },
    statusWeights: { needs_merge: 1 },
    yellowAllowedStatuses: ["needs_merge"],
    escalation: {
      staleAfterHours: 48,
      escalateToRole: "ceo",
      action: "notify",
    },
    maxConcurrentItems: 1,
  },
};
```

The Git Reviewer's power comes not from a special Role schema but from an **enhanced `/review-implementation` skill** that owns the outcome:

1. **Review**: Run quality gates (existing cogni-git-review)
2. **Fix**: If CI fails with fixable errors → push fix commits → wait for CI
3. **Follow up**: If review has open threads → comment requesting resolution
4. **Decide**: If all gates pass + approval → merge. If fundamentally broken → reject with rationale.
5. **Escalate**: If stale > 48h → notify CEO role

This is a skill enhancement, not a role schema change. The Role just routes `needs_merge` items to the Git Reviewer instead of the CEO.

#### PM (walk phase)

```typescript
const PM_ROLE: Role = {
  definition: { id: "pm", name: "Project Manager" /* ... */ },
  queueFilter: {
    statuses: ["needs_triage"],
  },
  playbookMap: {
    needs_triage: "/triage",
  },
  policy: {
    /* ... */
    escalation: {
      staleAfterHours: 24,
      escalateToRole: "ceo",
      action: "notify",
    },
  },
};
```

#### Data Analyst (walk phase)

```typescript
const DATA_ANALYST_ROLE: Role = {
  definition: { id: "data-analyst", name: "Data Analyst" /* ... */ },
  queueFilter: {
    labels: ["metrics", "observability", "cost"],
  },
  playbookMap: {
    needs_research: "/research",
    needs_triage: "/triage",
  },
  policy: {
    /* ... */
  },
};
```

### Temporal Alignment (spec: temporal-patterns)

The agent-roles design must align with `temporal-patterns-spec` invariants. The key tension: **mc-controller.ts is a CLI script doing I/O, not a Temporal workflow.**

#### Crawl: OpenClaw as Runtime (no Temporal workflow changes)

In crawl, the execution path stays:

```
Temporal Schedule → OpenClaw gateway → /mission-control SKILL.md → mc-controller.ts (CLI)
```

This is compatible with `SCHEDULES_OVER_CRON` (Temporal fires the schedule) but the controller itself is NOT a Temporal workflow — it's a shell-invoked CLI. Temporal provides the cron trigger; OpenClaw provides the agent runtime; mc-controller.ts provides the deterministic decision logic. No Temporal workflow code is needed.

**Task queue**: Role schedules use `governance-tasks` queue (existing). The Temporal Schedule starts a thin `AgentHeartbeatWorkflow` that calls a single Activity: `runOpenClawSkillActivity(roleId, "/mission-control")`. This keeps Temporal as the authority while OpenClaw executes the actual logic.

**Workflow ID convention**: `heartbeat:${roleId}:${timeBucket}` — follows `WORKFLOW_ID_STABILITY`.

#### Walk: Decompose Controller into Temporal Activities

When roles need webhook triggers and cross-role escalation, mc-controller.ts decomposes into proper Temporal activities:

```typescript
// Workflow: deterministic orchestration (TEMPORAL_DETERMINISM compliant)
export async function RoleHeartbeatWorkflow(roleId: string) {
  // Activity: load role config (I/O: file read)
  const role = await loadRoleActivity(roleId);

  // Activity: observe signals (I/O: Prometheus, Grafana, RPC)
  const signals = await observeSignalsActivity(role.definition);

  // Workflow: deterministic tier evaluation (NO I/O)
  const tier = evaluateTier(signals, role.policy);
  if (tier === "RED") return;

  // Activity: filter work queue (I/O: file system read)
  const items = await filterQueueActivity(role.queueFilter);

  // Workflow: deterministic pick (NO I/O)
  const picked = pickItem(items, role.policy);
  if (!picked) return;

  // Activity: persist snapshot (I/O: file write)
  await persistSnapshotActivity({ roleId, tier, picked });

  // Activity: dispatch skill via OpenClaw (I/O: HTTP/exec)
  await dispatchSkillActivity(role, picked);

  // Activity: log playbook outcome (I/O: file write)
  await logOutcomeActivity(roleId, picked);
}
```

This follows the `GovernanceAgentWorkflow` pattern from temporal-patterns: workflow does deterministic decisions, activities do all I/O.

**Webhook fast-path**: Follows Pattern 3 (Router with Fast-Path Kick):

```typescript
// workflowId = `heartbeat:git-reviewer:${timeBucket}` for idempotency
// Can be started by cron schedule OR webhook signal
```

**Schedule config**: `overlap: SKIP`, `catchupWindow: 0` per `OVERLAP_SKIP_DEFAULT` and `CATCHUP_WINDOW_ZERO`.

### Trigger Patterns

Roles are triggered by **schedules in repo-spec.yaml**. Two trigger types:

| Type        | Example                                    | Implementation                                  |
| ----------- | ------------------------------------------ | ----------------------------------------------- |
| **Cron**    | CEO hourly, PM hourly, Analyst daily       | Temporal Schedule (existing)                    |
| **Webhook** | Git Reviewer on PR event, CI status change | GitHub webhook → internal API → Temporal signal |

Crawl uses cron only. Walk adds webhook triggers.

```yaml
# repo-spec.yaml (walk phase)
governance:
  schedules:
    - charter: HEARTBEAT
      cron: "0 * * * *"
      roles: [ceo]
    - charter: PR_LIFECYCLE
      cron: "0 */4 * * *" # Fallback: every 4 hours
      webhook: github.pull_request # Primary: on PR events
      roles: [git-reviewer]
```

### Playbook Feedback Loop (Walk Phase)

After each completed dispatch, the controller logs an outcome record:

```typescript
const PlaybookOutcomeSchema = z.object({
  roleId: z.string(),
  itemId: z.string(),
  skill: z.string(), // Which playbook was invoked
  startedAt: z.string(),
  completedAt: z.string(),
  outcome: z.enum(["success", "failure", "escalated", "timeout"]),
  statusBefore: z.string(),
  statusAfter: z.string().nullable(),
  iterations: z.number(), // How many times the agent looped (e.g., fix CI → retry)
  notes: z.string().optional(),
});
```

These records enable:

1. **Playbook success rate** per skill per role (which playbooks need improvement)
2. **Time-to-resolution** per item type (are we getting faster?)
3. **Escalation frequency** (is the agent handling things or punting?)
4. **Skill improvement triggers** — a metaprompt agent reviews failures weekly and proposes SKILL.md edits (human-approved, version-controlled in git)

### Dashboard (Walk Phase)

Each role gets a dashboard view powered by persisted `AgentSnapshot` files (from task.0162):

```
┌─────────────────────────────────────────────┐
│  CEO Dashboard                              │
│  ┌─────────┐ ┌─────────┐ ┌───────────────┐ │
│  │ Runway  │ │ Burn    │ │ Active Roles  │ │
│  │ 142d    │ │ $1.2/d  │ │ 4/4 healthy   │ │
│  └─────────┘ └─────────┘ └───────────────┘ │
│                                             │
│  Escalations (2)                            │
│  ├─ PR #562 — stale 14d (from: git-reviewer)│
│  └─ bug.0066 — blocked 7d (from: pm)       │
│                                             │
│  Recent Activity                            │
│  ├─ task.0161 /implement → success (2h)     │
│  └─ bug.0044 /triage → escalated (CEO)      │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│  Git Reviewer Dashboard                     │
│  ┌─────────┐ ┌─────────┐ ┌───────────────┐ │
│  │ Open PRs│ │ Stale   │ │ Merged Today  │ │
│  │ 7       │ │ 2       │ │ 3             │ │
│  └─────────┘ └─────────┘ └───────────────┘ │
│                                             │
│  PR Queue                                   │
│  ├─ #562 ⚠️ CI failing (unit) — 14d stale  │
│  ├─ #570 ✅ Ready to merge — awaiting approval│
│  └─ #571 🔄 Review in progress             │
└─────────────────────────────────────────────┘
```

The dashboard reads `AgentSnapshot` files — it never reruns signal providers. This is the `PERSISTED_SNAPSHOTS` invariant from task.0162.

## Invariants

- `ROLE_IS_CONFIG`: A Role is a typed configuration constant, not a stored entity. No RolePort in crawl.
- `CONTROLLER_PARAMETERIZED`: mc-controller.ts accepts `--role <id>` and loads the matching Role constant.
- `QUEUE_FILTER_IS_WORKQUERY`: WorkQueueFilter maps directly to `WorkQuery` fields from `@cogni/work-items`.
- `PLAYBOOK_IS_SKILL`: PlaybookMap values are skill paths (e.g., `/review-implementation`). No new abstraction.
- `ONE_SCHEDULE_PER_ROLE`: Each role has exactly one schedule entry in repo-spec.yaml.
- `SNAPSHOT_PER_ROLE`: AgentSnapshot includes roleId. Each role's snapshots are independent.
- `ESCALATION_IS_NOTIFICATION`: In crawl/walk, escalation creates a notification (Discord/comment), not automatic reassignment.
- `SKILL_OWNS_OUTCOME`: The power of a role comes from its skill quality, not the Role schema. Invest in skill improvement, not schema complexity.
- `CODE_FIRST_NO_YAML`: Role definitions are TypeScript constants with Zod schemas until 3+ roles prove the shape.
- `NO_ROLE_PORT_YET`: No RoleQueryPort, no role CRUD, no role adapter until walk phase dashboard needs it.
- `TEMPORAL_SCHEDULE_AUTHORITY`: Role schedules use Temporal Schedules on `governance-tasks` queue. WorkflowId = `heartbeat:${roleId}:${timeBucket}`. `overlap: SKIP`, `catchupWindow: 0`. (spec: temporal-patterns)
- `CONTROLLER_IO_IN_ACTIVITIES`: When roles move to Temporal (walk), all controller I/O (signal observation, queue reads, snapshot writes) must be Activities. Tier evaluation and item picking are deterministic workflow code. (spec: temporal-patterns)

## Relationship to Existing Projects

| Project                           | Relationship                                                             |
| --------------------------------- | ------------------------------------------------------------------------ |
| `proj.agentic-project-management` | Provides `WorkItemPort` — roles consume it for queue filtering           |
| `proj.governance-agents`          | Provides signal infrastructure — roles consume signals via providers     |
| `proj.agent-registry`             | Provides agent discovery — roles bind to discovered agents via `agentId` |
| `proj.system-tenant-governance`   | Provides system tenant execution — roles execute as `cogni_system`       |
| `task.0162` (mission-control)     | Foundation — roles generalize the controller from task.0162              |

## Non-Goals

- **Agent-to-agent communication** — Roles don't talk to each other. Escalation is notification-based.
- **Dynamic role creation** — No runtime role creation. Roles are code constants (crawl) or config files (walk).
- **Role hierarchies** — No org chart. Escalation targets are flat (role → role), not tree-shaped.
- **Multi-tenant roles** — One set of roles per node. Multi-tenant role isolation is out of scope.
