---
id: task.5284.handoff
type: handoff
work_item_id: task.5284
status: active
created: 2026-05-04
updated: 2026-05-04
branch: derekg1729/operator-sessions
last_commit: a3082f3a3
---

# Handoff: Operator coordination — scorecard-aware nextAction + skill teaches full loop

## Context

- task.5284: PR #1237 closes the agent half of operator-owned dev lifecycle (heartbeat + coordination polling) and starts the operator-side pushback (scorecard-aware `nextActionForWorkItem`).
- The /claims, /heartbeat, /pr, /coordination endpoints (PR #1204) are **already live on prod, preview, and candidate-a** — confirmed via agent.json + 401 responses + functional tests. This work extends the pull-side; it does not deploy new endpoints.
- Spec drift fixed in this PR: `docs/spec/agentic-contribution-loop.md` was deleted; its content merged into `docs/spec/development-lifecycle.md` along with the new contributor↔operator↔Dolt↔GitHub interaction graph and `COMMENTS_ARE_NOTIFICATION` invariant.
- Pareto finding (Derek-validated): GET /coordination is **pull-only and invisible**. The actually-load-bearing operator pushback channel is **idempotent GitHub PR comments** (`<!-- cogni-coord-v0 -->` marker). That broadcaster v0 is the next iteration — filed in the merged spec's Open Questions, not in this PR.

## Current State

- 4 commits on `derekg1729/operator-sessions` (head `a3082f3a3`): policy + skill + 2× format fixes + spec merge.
- PR #1237 open, mergeable, **CI red** on `unit > Documentation check`: `docs/spec/development-lifecycle.md` is missing required `## Design`, `## Goal`, `## Non-Goals` headings (the doc-header-check enforces a fixed structure; the spec merge removed the wrapper headings).
- task.5284 session: `active`, `claimedByUserId=c400bca1...` (`derek-claude-curitiba`), `prNumber=1237`, `coordinationId=71edb003-21d2-4844-844a-1ae564c8e211`, deadline `2026-05-05T00:28:55Z` (heartbeat needs refresh).
- `task.5280` (validate PR #1204) remains stranded under synthetic owner `validate-pr-1204-1777771798646-owner` — separate scope, not in this PR.
- Previous CI failures fixed: biome wrap on test (commit `7dd315c92`), prettier blank lines around code blocks (commit `70322ba54`).

## Decisions Made

- Spec canonical name = `docs/spec/development-lifecycle.md` (had more inbound refs than agentic-contribution-loop.md). 8 referencing files updated; `work/items/` legacy refs frozen.
- `COMMENTS_ARE_NOTIFICATION` invariant codified at [docs/spec/development-lifecycle.md](../../docs/spec/development-lifecycle.md) — design + status mutations stay in Dolt; comments carry scorecards + nudges only.
- Operator broadcaster v0 deferred from PR #1237 into a follow-up — kept this PR small, unbounded otherwise.
- See PR body: [#1237](https://github.com/Cogni-DAO/node-template/pull/1237) — TLDR + validation plan + open questions.

## Next Actions

- [ ] Fix `unit > Documentation check` failure: re-add `## Goal`, `## Non-Goals`, and a top-level `## Design` wrapper to `docs/spec/development-lifecycle.md` (the doc-header-check at `scripts/validate-docs-metadata.mjs` enforces these). Push.
- [ ] Heartbeat task.5284 (deadline 00:28Z) before resuming — `POST /api/v1/work/items/task.5284/heartbeat` with bearer from `.env.cogni` `COGNI_API_KEY_TEST`.
- [ ] Wait for CI green on PR #1237.
- [ ] `POST /api/v1/vcs/flight {prNumber:1237}` → wait for `candidate-flight` SUCCESS → confirm `https://test.cognidao.org/version.buildSha` matches PR head SHA.
- [ ] Run `/validate-candidate 1237` — exercise GET /coordination on a needs_merge unverified item; expect nextAction text demanding `/validate-candidate`. Post the scorecard PR comment.
- [ ] PATCH task.5284 → `status: done`, `deployVerified: true` (the operator policy itself should accept once verified).
- [ ] Spawn the trivial-task subagent: create `nodes/operator/app/src/features/work-item-sessions/AGENTS.md` per `docs/templates/agents_subdir_template.md`. Subagent uses `contribute-to-cogni` skill end-to-end (claim → heartbeat → /pr → flight → validate). New work item — file via `POST /api/v1/work/items`.
- [ ] (vNext, not blocking handoff) File a fresh task for "Operator broadcaster v0 — push nudges to PR via gh comment with `<!-- cogni-coord-v0 -->` marker"; reuse `nextActionForWorkItem` policy; small `bootstrap/jobs/` loop.

## Risks / Gotchas

- **Format discipline failed twice this session** — agent didn't run prettier locally before commit. `feedback_format_before_commit.md` memory updated; `feedback_operator_coord_push_not_pull.md` notes "re-arm Monitor after every push". Don't make these mistakes a third time.
- **Doc-header-check is strict** — specs must have `## Goal`, `## Non-Goals`, `## Design`. The merge moved their content into other sections but dropped the headings. CI will keep failing until the wrappers are restored — they can be thin (1-line) sections that point at the structured ones.
- **Don't poll task.5280** — it's claimed by a synthetic owner, conflict expected. That's a separate stranded validation thread; not your problem here.
- **Don't bloat this PR** — if you find yourself implementing the broadcaster v0 inside #1237, stop. Ship #1237 as-is and file the broadcaster as a fresh work item (ESLint, contracts, jobs/, port shape — different scope).
- **Phase 2/3 of `docs/design/operator-dev-lifecycle-coordinator.md` are slop until v0 broadcaster lands.** Validation-hold queues, signed webhooks, outbox tables — none of it adds value before push-via-PR-comment is exercised on a real PR.

## Pointers

| File / Resource                                                                                                                                      | Why it matters                                                                                |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| [PR #1237](https://github.com/Cogni-DAO/node-template/pull/1237)                                                                                     | The active PR — read body for TLDR + validation plan                                          |
| [`docs/spec/development-lifecycle.md`](../../docs/spec/development-lifecycle.md)                                                                     | Merged spec (this PR's edit). Source of truth for lifecycle + interaction graph + invariants. |
| [`docs/design/operator-dev-lifecycle-coordinator.md`](../../docs/design/operator-dev-lifecycle-coordinator.md)                                       | Coordinator design — Phase 1 done, Phase 2/3 deferred                                         |
| [`nodes/operator/app/src/features/work-item-sessions/session-policy.ts`](../../nodes/operator/app/src/features/work-item-sessions/session-policy.ts) | The policy edited this PR. `nextActionForWorkItem` is the function under test                 |
| [`.claude/skills/contribute-to-cogni/SKILL.md`](../../.claude/skills/contribute-to-cogni/SKILL.md)                                                   | Updated to teach heartbeat + coordination poll                                                |
| [`.claude/skills/validate-candidate/SKILL.md`](../../.claude/skills/validate-candidate/SKILL.md)                                                     | Run this after flight; it owns the scorecard format + Loki marker rule                        |
| `.env.cogni` (workspace root)                                                                                                                        | `COGNI_API_KEY_TEST` for test.cognidao.org bearer; agent name `derek-claude-curitiba`         |
| Latest CI failure log                                                                                                                                | `gh run view 25350193267 --log-failed` (doc-header-check)                                     |
| [`scripts/validate-docs-metadata.mjs`](../../scripts/validate-docs-metadata.mjs)                                                                     | The doc-header-check. Confirms which headings are required.                                   |
| Memory: `feedback_operator_coord_push_not_pull.md`                                                                                                   | Pareto finding + Monitor re-arm discipline                                                    |
