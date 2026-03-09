---
id: openclaw-govern-distributed
type: spec
title: "OpenClaw Distributed GOVERN: Deterministic runtime state model"
status: draft
spec_state: draft
trust: draft
summary: "Governance runs are charter-scoped and trigger-routed (`COMMUNITY`, `ENGINEERING`, `SUSTAINABILITY`, `GOVERN`) through one shared prompt stack. Runtime state is deterministic: GOVERN-owned gate, overwrite-latest charter heartbeats, and a tiny durable EDO index."
read_when: "Implementing governance skills, routing trigger tokens, or validating governance runtime behavior."
implements: proj.context-optimization
owner: derekg1729
created: 2026-02-14
verified: 2026-02-15
tags: [openclaw, govern, architecture, context-optimization, governance]
---

# OpenClaw Distributed GOVERN: Deterministic runtime state model

## Goal

Keep governance loops cheap, deterministic, and coherent by using a minimal runtime state model with strict ownership and git persistence rules.

## Design

## Runtime State Model (Canonical)

All governance runtime state lives under `memory/`.

1. Gate (authoritative live authorization)

- File: `memory/_budget_header.md`
- Single writer: `GOVERN`
- Required keys:
  - `allow_runs`
  - `max_tokens_per_charter_run`
  - `max_tool_calls_per_charter_run`
  - `max_brain_spawns_per_hour`
  - `budget_status` (`ok` | `warn` | `critical`)
  - `burn_rate_trend`
  - `updated_at`

2. Charter heartbeat (ephemeral latest state)

- File: `memory/{CHARTER}/heartbeat.md`
- Single writer: that charter's skill
- Overwrite each run (no append logs)
- Must include `run_at` (`YYYY-MM-DDTHH:MMZ`)

3. Decisions (durable, bounded)

- File: `memory/edo_index.md`
- Written only when there is a real choice between alternatives
- Keep bounded to open/recent entries (small index)
- Each index entry references one EDO file in `memory/EDO/<id>.md`
- EDO body format source: `services/sandbox-openclaw/gateway-workspace/memory-templates/EDO.template.md`

## Control Loop

1. Scheduler emits trigger token: `COMMUNITY`, `ENGINEERING`, `SUSTAINABILITY`, `GOVERN`.
2. SOUL router maps token directly to `/gov-*` skill without pre-routing deliberation.
3. Non-GOVERN skills read gate first.
4. If gate disallows runs (or is missing/stale), non-GOVERN skills write a no-op heartbeat and exit.
5. GOVERN reads latest heartbeats, writes gate, writes one portfolio heartbeat, and writes EDO only for real choices.

## Cold Start and Staleness Rule

Non-GOVERN skills must treat the gate as unavailable when:

- `memory/_budget_header.md` is missing, or
- `updated_at` is missing/unparseable, or
- `updated_at` is older than 2 hours.

When gate is unavailable, non-GOVERN skills write `decision: no-op`, `no_op_reason: blocked` and exit.

## Heartbeat Contract (Shared Shape)

Every heartbeat in `memory/{CHARTER}/heartbeat.md` contains:

- `run_at`: UTC timestamp (`YYYY-MM-DDTHH:MMZ`)
- `charter`: one charter id
- `focus`: one object only (metric, item, or dashboard row)
- `decision`: `action` or `no-op`
- `no_op_reason`: required when `decision: no-op` (`veto`, `wip_full`, `blocked`, `no_delta`)
- `expected_outcome`: one measurable delta + date
- `cost_guard`:
  - `max_tokens`
  - `max_tool_calls`
  - `escalation_requested`
- `evidence`: refs only

## Git Persistence Contract

Applies to all governance skills.

- Governance writes run on branch `gov/state`.
- Never write governance state on `main`.
- Require clean tree at run start; dirty tree => blocked no-op.
- Governance runtime writes are limited to `memory/`.
- Any changed `memory/` file must be committed in the same run.

## Role Ownership

- Humans own charter strategy content (`work/charters/*.md` priorities/projects/scores).
- `SUSTAINABILITY`: reports and recommends only; does not write `allow_runs`.
- `GOVERN`: sole owner of live authorization gate (`memory/_budget_header.md`).
- `COMMUNITY` and `ENGINEERING`: consume gate + emit charter heartbeat.

## Skill-Level Behavior

Non-GOVERN (`COMMUNITY`, `ENGINEERING`, `SUSTAINABILITY`):

1. Apply `gov-core` invariants.
2. Read gate from `memory/_budget_header.md`.
3. If missing/stale => overwrite `memory/{CHARTER}/heartbeat.md` with blocked no-op and exit.
4. If `allow_runs: false` => overwrite heartbeat with veto no-op and exit.
5. Read `work/charters/{CHARTER}.md`.
6. Produce one heartbeat via `gov-core`.
7. Overwrite `memory/{CHARTER}/heartbeat.md`.
8. Commit changed `memory/` files.

`GOVERN`:

1. Apply `gov-core` invariants.
2. Read `work/charters/GOVERN.md` + latest charter heartbeats.
3. Overwrite `memory/_budget_header.md`.
4. Produce one portfolio heartbeat via `gov-core`.
5. Overwrite `memory/GOVERN/heartbeat.md`.
6. For real choices only: create/update `memory/EDO/<id>.md` from `memory/EDO/_template.md`, then update `memory/edo_index.md`.
7. Commit changed `memory/` files.

## Core Invariants

- `ROUTE_BY_TRIGGER`: direct token-to-skill routing.
- `ONE_DECISION_PER_RUN`: exactly one decision per run.
- `GOVERN_OWNS_GATE`: only GOVERN writes `memory/_budget_header.md`.
- `HEARTBEAT_OVERWRITE_LATEST`: charter heartbeat is latest-state, overwrite each run.
- `RUN_AT_REQUIRED`: each heartbeat includes `run_at`.
- `COLD_START_BLOCKS_NON_GOVERN`: missing/stale gate means blocked no-op.
- `EDO_REAL_CHOICE_ONLY`: persist decisions only for real alternatives.
- `GIT_COMMIT_OR_FAIL`: changed runtime state must be committed in-run.

## File Pointers

- `.openclaw/skills/gov-core/SKILL.md` — canonical governance invariants
- `.openclaw/skills/gov-community/SKILL.md`
- `.openclaw/skills/gov-engineering/SKILL.md`
- `.openclaw/skills/gov-sustainability/SKILL.md`
- `.openclaw/skills/gov-govern/SKILL.md`
- `services/sandbox-openclaw/gateway-workspace/SOUL.md` — trigger router
- `services/sandbox-openclaw/gateway-workspace/memory-templates/` — bootstrap templates for runtime `memory/` state files
- `services/sandbox-openclaw/gateway-workspace/memory-templates/EDO.template.md` — canonical Event-Decision-Outcome template

## Non-Goals

- Append-only governance journals
- Table-driven capability selection in governance wrappers
- Duplicating runtime state schema across multiple docs
