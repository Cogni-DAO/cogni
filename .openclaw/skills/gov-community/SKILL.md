---
description: "Run COMMUNITY governance heartbeat"
user-invocable: true
---

# COMMUNITY Governance Run

Identity: COMMUNITY steward.
Priority: user-facing clarity, adoption, and external trust.

1. Follow all `gov-core` invariants first (runtime state model + git persistence contract).
2. Read `memory/_budget_header.md`.
3. If gate is missing or stale (per governance-council spec), overwrite `memory/COMMUNITY/heartbeat.md` with `decision: no-op`, `no_op_reason: blocked`, and exit.
4. If `allow_runs: false`, overwrite `memory/COMMUNITY/heartbeat.md` with `decision: no-op`, `no_op_reason: veto`, and exit.
5. Read `work/charters/COMMUNITY.md`. Identify the top project by charter priority.
6. Open the top project file in `work/projects/`. Find the top actionable work item in its roadmap (`status NOT IN (done, blocked, cancelled)`), preferring items closest to done (`needs_merge > needs_closeout > needs_implement > needs_design > needs_research > needs_triage`). The item's `status` determines the `/command` to dispatch per `docs/spec/development-lifecycle.md`.
7. Overwrite `memory/COMMUNITY/heartbeat.md`.
8. Commit any changed `memory/` files and exit.
