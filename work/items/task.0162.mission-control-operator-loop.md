---
id: task.0162
type: task
title: "Mission Control: controller-first operator loop with typed snapshot model"
status: needs_implement
priority: 0
rank: 1
estimate: 3
summary: "Redesign mission-control as a deterministic TS controller (not skill-first). Controller runs observe→gate→pick→snapshot, persists AgentSnapshot to disk. Agent only wakes for bounded dispatch. Four typed pieces: AgentDefinition, SignalProvider[], MissionPolicy, AgentSnapshot."
outcome: "Each hourly run: mc-controller.ts gathers signals (health + work items), applies MissionPolicy (tier gating + finish-before-starting), persists AgentSnapshot to JSON, outputs DispatchEnvelope. SKILL.md is <20 lines — reads envelope, dispatches brain, reports. Dashboard (future) reads snapshots, never reruns scripts."
spec_refs:
  - development-lifecycle
assignees:
  - derekg1729
credit:
project: proj.system-tenant-governance
branch: feat/mission-control-clean
pr: https://github.com/Cogni-DAO/node-template/pull/562
reviewer:
revision: 8
blocked_by:
deploy_verified: false
created: 2026-03-10
updated: 2026-03-13
testing: "Untested — requires gateway container runtime (OpenClaw + Grafana + Base RPC). Validate in staging."
labels: [governance, heartbeat, operator, mission-control]
external_refs:
  - docs/research/autonomous-agent-operator-loops.md
---

# Mission Control: Controller-First Operator Loop

## Context

HEARTBEAT fires hourly via Temporal → OpenClaw gateway. The first implementation (revision 1–7) was skill-first: SKILL.md orchestrated calls to mc-status.sh and mc-pick.ts. The LLM still ran the controller logic (executing scripts, reading output, deciding flow).

**Problem:** The center of gravity is wrong. Observe/gate/pick/report are deterministic policy — they belong in a TS controller, not in a prompt. The LLM should only wake for bounded execution dispatch.

**Existing infra we reuse (not rebuild):**

| Capability                            | Where                                                                                  |
| ------------------------------------- | -------------------------------------------------------------------------------------- |
| Health metrics (cost, tokens, errors) | `queries.sh` (Grafana Prometheus + Loki)                                               |
| Credit balance                        | `/api/v1/governance/status` → `systemCredits`                                          |
| Work item query/filter/sort           | `@cogni/work-items` package (`MarkdownWorkItemAdapter`)                                |
| Status → /command dispatch            | development-lifecycle spec                                                             |
| Git sync                              | `/git-sync` skill                                                                      |
| Brain delegation                      | SOUL.md researcher→brain model                                                         |
| Lifecycle skills                      | `/triage`, `/design`, `/implement`, `/closeout`, `/review-implementation`, `/research` |
| Runtime caps                          | OpenClaw config: `timeoutSeconds: 540`, `subagents.maxConcurrent: 3`                   |

## Design

### Outcome

A deterministic TS controller (`mc-controller.ts`) runs the full observe→gate→pick→snapshot loop. It persists an `AgentSnapshot` to disk after every run. The agent receives a pre-computed `DispatchEnvelope` — it never gathers signals, computes runway, or picks work items. Dashboard (walk phase) reads persisted snapshots.

### Approach

**Controller-first architecture.** The controller is the center of gravity. Four typed pieces replace the previous monolithic skill:

```
AgentDefinition    — who (identity, model, workDir)
SignalProvider[]    — observe (health, work queue — each returns typed data)
MissionPolicy      — gate (tier thresholds, allowed statuses per tier, finish-before-starting weights)
AgentSnapshot      — persist (signals + pick + outcome, written after every run)
```

The controller orchestrates: gather signals → apply policy → pick item → persist snapshot → output envelope.

**Reuses:** `@cogni/work-items` MarkdownWorkItemAdapter (existing port), `queries.sh` helpers (existing bash), `/api/v1/governance/status` (existing API).

**Rejected alternatives:**

- "Keep SKILL.md as orchestrator" — skill-first. LLM runs controller logic that should be deterministic code.
- "AgentProfile god object" — mixes identity, signals, policy, presentation. Split into four typed pieces.
- "Dashboard reruns status scripts on page load" — expensive, non-deterministic. Persist snapshots, read projections.
- "YAML config for agents" — premature. Code-first TS types + Zod until 2–3 agents prove the shape.
- "Full API + UI in this PR" — scope creep. Crawl = controller + types + snapshot persistence. Walk = API contract + port + panel.

### Typed Pieces

#### AgentDefinition

```typescript
const AgentDefinitionSchema = z.object({
  id: z.string(), // "ceo"
  name: z.string(), // "Cogni CEO"
  workDir: z.string(), // "/repo/current"
  model: z.string(), // "cogni/deepseek-v3.2"
});
```

Static identity. One per agent. For crawl, hardcoded for CEO agent.

#### SignalResult (output of each signal provider)

```typescript
const HealthSignalSchema = z.object({
  kind: z.literal("health"),
  cost24hUsd: z.number(),
  cost7dUsd: z.number(),
  burnRateUsdPerDay: z.number(),
  creditsUsd: z.number(),
  treasuryUsd: z.number(),
  runwayDays: z.number(),
  errors24h: z.number(),
  firingAlerts: z.number(),
  timestamp: z.string().datetime(),
});

const WorkQueueSignalSchema = z.object({
  kind: z.literal("work_queue"),
  totalActionable: z.number(),
  byStatus: z.record(z.string(), z.number()),
  topItem: DispatchEnvelopeSchema.nullable(),
});

const SignalResultSchema = z.discriminatedUnion("kind", [
  HealthSignalSchema,
  WorkQueueSignalSchema,
]);
```

Each signal provider returns one `SignalResult`. mc-status.sh provides `health`. mc-pick logic provides `work_queue`.

#### MissionPolicy

```typescript
const MissionPolicySchema = z.object({
  tierThresholds: z.object({
    greenMinRunwayDays: z.number(), // 30
    yellowMinRunwayDays: z.number(), // 7
  }),
  statusWeights: z.record(z.string(), z.number()),
  yellowAllowedStatuses: z.array(z.string()),
  statusToSkill: z.record(z.string(), z.string()),
});
```

Deterministic rules. For crawl, a single hardcoded `CEO_POLICY` constant. Walk phase: `MissionPolicyProvider` interface.

#### AgentSnapshot

```typescript
const AgentSnapshotSchema = z.object({
  agentId: z.string(),
  runId: z.string(), // ISO timestamp or UUID
  tier: z.enum(["GREEN", "YELLOW", "RED"]),
  signals: z.array(SignalResultSchema),
  dispatch: DispatchEnvelopeSchema.nullable(),
  outcome: z.enum(["dispatched", "no_op", "error"]).nullable(),
  error: z.string().nullable(),
  timestamp: z.string().datetime(),
});
```

Persisted to `.openclaw/state/mission-control/snapshots/<runId>.json` after every run. Dashboard reads these files — never reruns scripts.

#### DispatchEnvelope

```typescript
const DispatchEnvelopeSchema = z.object({
  itemId: z.string(),
  status: z.string(),
  skill: z.string(),
  priority: z.number(),
  rank: z.number(),
});
```

What the agent receives. One item, one skill. The agent's only job is to execute it.

### Controller Flow (mc-controller.ts)

```
1. OBSERVE  — run mc-status.sh → parse HealthSignal
             — run work-items query → compute WorkQueueSignal
2. GATE     — derive tier from HealthSignal + MissionPolicy thresholds
             — if RED → dispatch = null
             — if YELLOW → filter to yellowAllowedStatuses
3. PICK     — sort by statusWeight DESC, priority ASC, rank ASC
             — top item → DispatchEnvelope (or null)
4. SNAPSHOT — build AgentSnapshot, write to disk
5. OUTPUT   — print DispatchEnvelope JSON to stdout (agent reads this)
```

The controller is a single `npx tsx mc-controller.ts` call. It replaces the previous pattern of SKILL.md calling mc-status.sh then mc-pick.ts sequentially.

### SKILL.md (ultra-thin — <20 lines)

The agent prompt becomes trivially simple:

```markdown
# /mission-control

> Hourly operator loop. Receives pre-computed dispatch envelope.

## 1. SYNC

Run /git-sync. Continue regardless of outcome.

## 2. EXECUTE

Run: `npx tsx /repo/current/.openclaw/skills/mission-control/mc-controller.ts`

Read the JSON output. If `dispatch` is null → skip to step 3.
Otherwise: spawn brain subagent `/<skill> <itemId>`. One item. One skill. No scope creep.
If brain fails → do NOT retry. Next run re-evaluates.

## 3. REPORT

Post one message to Discord:
<tier_emoji> $X.XX/24h | Xd runway | N errors
/<skill> on <itemId> — OR — no-op: <reason>

EXIT.
```

The LLM makes zero decisions about what to work on. It dispatches what the controller chose and reports.

### Degradation Ladder

Enforced in controller (deterministic), not in prompt.

| Tier     | Condition                  | Allowed actions                                             |
| -------- | -------------------------- | ----------------------------------------------------------- |
| `GREEN`  | runway > 30d               | Full lifecycle: any skill                                   |
| `YELLOW` | 7d ≤ runway ≤ 30d          | Finish in-flight: needs_merge, needs_closeout, needs_triage |
| `RED`    | runway < 7d OR credits ≤ 0 | Report only. No dispatch.                                   |

### Crawl / Walk / Run

**Crawl (this PR):**

- `types.ts` — all Zod schemas + inferred TS types (AgentDefinition, signals, policy, snapshot, envelope)
- `mc-controller.ts` — single entry point, hardcoded CEO agent definition + policy
- `mc-status.sh` — kept as-is (health signal provider, called by controller via `execSync`)
- `SKILL.md` — thinned to <20 lines (reads controller output, dispatches, reports)
- Snapshots written to disk as JSON files

**Walk (future):**

- Extract `SignalProvider` interface — `{ kind: string; gather(agent: AgentDefinition): Promise<SignalResult> }`
- Extract `MissionPolicyProvider` interface
- API contract: `mission-control.snapshot.v1.contract.ts` — `AgentMissionControlPort { listAgents(); getSnapshot(agentId); listRuns(agentId, limit); getQueue(agentId); }`
- `AgentOverviewPanel(snapshot)` UI component with generic `SignalCard[]`
- Move pick logic to `@cogni/work-items` package as `WorkItemPicker`

**Run (future):**

- mc-status.sh → mc-status.ts (full TS signal provider)
- Pluggable signal providers (per-agent configuration)
- Cross-agent orchestration
- YAML config (only after 2+ agents prove the shape)

### Files

**Modify:**

- `.openclaw/skills/mission-control/types.ts` — **new**: Zod schemas + TS types for all four pieces + envelope
- `.openclaw/skills/mission-control/mc-controller.ts` — **new**: deterministic controller (observe→gate→pick→snapshot→output)
- `.openclaw/skills/mission-control/mc-status.sh` — keep as-is (health signal provider)
- `.openclaw/skills/mission-control/mc-pick.ts` — **delete**: logic absorbed into mc-controller.ts
- `.openclaw/skills/mission-control/SKILL.md` — thin to <20 lines (just dispatch + report)

**Unchanged:**

- `services/sandbox-openclaw/gateway-workspace/SOUL.md` — already routes HEARTBEAT → /mission-control
- `.openclaw/skills/deployment-health/queries.sh` — mc-status.sh sources its helpers
- `packages/work-items/` — controller consumes existing API
- `biome.json` — already includes `.openclaw/**/*`

### Invariants

<!-- CODE REVIEW CRITERIA -->

- [ ] CONTROLLER_FIRST: mc-controller.ts runs observe→gate→pick→snapshot→output. Agent only dispatches.
- [ ] TYPED_PIECES: Four separate types (AgentDefinition, SignalResult, MissionPolicy, AgentSnapshot) — no god object.
- [ ] PERSISTED_SNAPSHOTS: Every run writes AgentSnapshot JSON to disk. No live recomputation for reads.
- [ ] ZOD_AT_BOUNDARIES: All types have Zod schemas. Controller validates mc-status.sh output before use.
- [ ] DETERMINISTIC_SELECTION: Work item selection via @cogni/work-items port, not markdown parsing.
- [ ] THIN_PROMPT: SKILL.md is <20 lines. Agent receives pre-computed envelope, makes zero decisions.
- [ ] DEGRADATION_LADDER: Controller enforces tier (GREEN=all, YELLOW=finish+triage, RED=null).
- [ ] FINISH_BEFORE_STARTING: status weight needs_merge(6) > needs_closeout(5) > ... > needs_triage(1).
- [ ] HEARTBEAT_ROUTES_TO_MISSION_CONTROL: SOUL.md routes HEARTBEAT → /mission-control.
- [ ] NO_SHADOW_STATE: No WIP.md, no budget file writes. Snapshots are the only state.
- [ ] ONE_FOCUS: Exactly 1 work item per run.
- [ ] COST_DISCIPLINE: Only dispatch (brain subagent) is expensive. Everything else is deterministic TS/bash.
- [ ] NO_RETRY: Brain failure → report + exit. Next run re-evaluates fresh.
- [ ] SHELL_SAFE: mc-status.sh validates external inputs via jq (not raw string interpolation).
- [ ] NO_YAML: Code-first TS types + Zod. No YAML config until walk phase.

## Validation

- [ ] mc-controller.ts gathers HealthSignal from mc-status.sh (validates JSON with Zod)
- [ ] mc-controller.ts gathers WorkQueueSignal from @cogni/work-items adapter
- [ ] mc-controller.ts applies tier gating correctly (GREEN=all, YELLOW=filtered, RED=null)
- [ ] mc-controller.ts persists AgentSnapshot to disk after every run
- [ ] mc-controller.ts outputs DispatchEnvelope JSON to stdout (or null)
- [ ] SKILL.md reads envelope and dispatches single brain subagent
- [ ] Finish-before-starting: needs_merge item picked over needs_implement
- [ ] Degradation: RED tier → snapshot written with dispatch=null, no brain spawned
- [ ] Snapshot files accumulate (one per run), readable by future dashboard API
- [ ] No retry on brain failure — single attempt per run
