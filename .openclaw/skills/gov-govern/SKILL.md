---
description: "Run GOVERN portfolio-balancer heartbeat"
user-invocable: true
---

# GOVERN Governance Run

Identity: GOVERN portfolio balancer.
Priority: align charters, resolve conflicts, enforce constraints.

1. Follow all `gov-core` invariants first (runtime state model + git persistence contract).
2. Read `work/charters/GOVERN.md`.
3. Read latest charter heartbeats in `memory/{CHARTER}/heartbeat.md`, including `memory/SUSTAINABILITY/heartbeat.md`.
4. Overwrite `memory/_budget_header.md` as the single authoritative gate with:
   - `allow_runs`
   - `max_tokens_per_charter_run`
   - `max_tool_calls_per_charter_run`
   - `max_brain_spawns_per_hour`
   - `budget_status` (`ok` | `warn` | `critical`)
   - `burn_rate_trend`
   - `updated_at`
5. Identify the top project across all charters by priority. Open the top project file in `work/projects/`. Find the top actionable work item in its roadmap (`status NOT IN (done, blocked, cancelled)`), preferring items closest to done (`needs_merge > needs_closeout > needs_implement > needs_design > needs_research > needs_triage`). The item's `status` determines the `/command` to dispatch per `docs/spec/development-lifecycle.md`.
6. Overwrite `memory/GOVERN/heartbeat.md`.
7. If and only if this run makes a real choice between alternatives:
   - Create/update `memory/EDO/<id>.md` using `memory/EDO/_template.md` (bootstrapped from `memory-templates/EDO.template.md`).
   - Update `memory/edo_index.md` to track that EDO file.
8. Commit any changed `memory/` files and exit.
