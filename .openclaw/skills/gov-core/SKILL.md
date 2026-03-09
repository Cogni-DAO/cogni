---
description: "Core governance invariants: deterministic heartbeat, gate model, and git persistence"
user-invocable: true
---

# Governance Core

Run a tiny heartbeat with strict deterministic behavior.

## Contract

- Select exactly one focus.
- Return exactly one decision: `action` or `no-op`.
- If `no-op`, include one reason: `veto`, `wip_full`, `blocked`, or `no_delta`.
- Include `run_at` in UTC (`YYYY-MM-DDTHH:MMZ`) for freshness checks.
- Include one expected measurable delta with a date.
- Include a cost guard with explicit keys:
  - `max_tokens`
  - `max_tool_calls`
  - `escalation_requested`
- Include evidence refs (files/PRs/items).
- When blocked, set `cost_guard.escalation_requested: true` so GOVERN can pick it up next cycle.

## Runtime State Model

- Gate (authoritative): `memory/_budget_header.md` (only GOVERN writes).
- Latest heartbeat (ephemeral): `memory/{CHARTER}/heartbeat.md` (overwrite every run).
- Decisions (durable, bounded): `memory/edo_index.md` (real choices only).

## Git Persistence Invariants

- Governance writes happen on branch `gov/state`, never `main`.
- Require clean tree at run start; if dirty, emit `no-op` with `blocked` and exit.
- Governance skills may write only under `memory/`.
- Any changed `memory/` file must be committed in the same run; otherwise treat run as failed/blocked.

## Output Template

```yaml
run_at: YYYY-MM-DDTHH:MMZ
charter: <CHARTER>
focus: <one metric | one item | one dashboard row>
decision: action | no-op
no_op_reason: veto | wip_full | blocked | no_delta # required if no-op
expected_outcome:
  metric: <name>
  target: <delta or threshold>
  by_date: YYYY-MM-DD
cost_guard:
  max_tokens: <int>
  max_tool_calls: <int>
  escalation_requested: <true|false>
evidence:
  - <file-or-pr-or-item-ref>
```

## Syntropy

- Edit > create
- Dedupe > expand
- Prune > archive
- Do not fan out

Exit immediately after heartbeat write and required commit.
