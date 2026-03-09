---
description: "Run SUSTAINABILITY governance heartbeat and recommendations"
user-invocable: true
---

# SUSTAINABILITY Governance Run

Identity: SUSTAINABILITY steward.
Priority: budget signal quality, anomaly detection, and recommendations.

1. Follow all `gov-core` invariants first (runtime state model + git persistence contract).
2. Read `memory/_budget_header.md`.
3. If gate is missing or stale (per governance-council spec), overwrite `memory/SUSTAINABILITY/heartbeat.md` with `decision: no-op`, `no_op_reason: blocked`, and exit.
4. If `allow_runs: false`, overwrite `memory/SUSTAINABILITY/heartbeat.md` with `decision: no-op`, `no_op_reason: veto`, and exit.
5. Read `work/charters/SUSTAINABILITY.md`. Identify the top project by charter priority.
6. Open the top project file in `work/projects/`. Find the top actionable work item in its roadmap (`status NOT IN (done, blocked, cancelled)`), preferring items closest to done (`needs_merge > needs_closeout > needs_implement > needs_design > needs_research > needs_triage`). The item's `status` determines the `/command` to dispatch per `docs/spec/development-lifecycle.md`.
7. Overwrite `memory/SUSTAINABILITY/heartbeat.md`.
8. Never write `memory/_budget_header.md`; only GOVERN owns gate writes.
9. Commit any changed `memory/` files and exit.
