---
id: task.0376.handoff
type: handoff
work_item_id: task.0376
status: active
created: 2026-04-26
updated: 2026-04-26
branch: feat/task.0376-preview-prod-matrix
last_commit: fa6b4c404b2be6d7ce9c5c85f5be4358e4a2586b
---

# Handoff: task.0376 + active preview/production outage

## Context

- task.0372 shipped per-node candidate-flight matrix on `candidate-a` (PR #1060, merged). task.0376 ports the same primitive to `preview` + `production` (PR #1062, in review).
- `proj.cicd-services-gitops.md` has a `## Cutover State (2026-04-25)` block that should be the cold-reload anchor for the whole CICD chain.
- An **active outage** surfaced mid-cutover: `cogni-preview` + `cogni-production` node-app pods are `0/1 Ready` because `EVM_RPC_URL` returns Alchemy 429 ("Monthly capacity exceeded"). It is **not** caused by 0372/0376 — `MISSING_RUNTIME_SECRET` in the readyz log is a misnomer for any EVM connectivity failure.
- Two devs misread the outage cause earlier in the session — first as Alchemy generally, then as CICD fallout. Ground truth came from pod logs on `production-vm-ip` (84.32.110.202) and `preview-vm-ip` (84.32.110.92).
- Drift on the **preview VM** (extra `cogni-canary` + `cogni-production` namespaces with stale Apps) is real but **not** the cause of the user-facing outage. Cleanup is non-blocking.

## Current State

- **PR #1062 (task.0376)**: 8 commits ahead of `main`, MERGEABLE, fa6b4c404. Reviewer concerns logged in commit history. **Not yet merged.**
- **Outage**: preview pods Running but readyz 503; production pods same. Operator/poly/resy node-apps affected, scheduler-worker fine.
- **Restore plan agreed with Derek** (no SSH, no per-VM hand fixes):
  1. `gh secret set EVM_RPC_URL --env preview` (and `--env production`) from Derek's local `.env`.
  2. `gh workflow run promote-and-deploy.yml --ref main -f environment=preview -f source_sha=$PREVIEW_SHA -f build_sha=$PREVIEW_SHA -f skip_infra=false` — same source/build SHA = no image change, just secret rotation via `deploy-infra.sh`.
  3. Repeat for production. Production is manual workflow_dispatch by design (bug.0361).
- **`--ref main`, NOT 1062's branch** — main has the proven whole-slot promote-and-deploy.yml; 1062 rewrites it. Don't combine emergency restore with workflow refactor.
- **Drift on preview VM**: stale `cogni-canary` + `cogni-production` namespaces hosting non-functional Apps. Address after outage closes.

## Decisions Made

- task.0372 split: candidate-a in PR #1060 (merged); preview/prod in PR #1062 (`feat/task.0376-preview-prod-matrix`). Done to keep each cutover dogfood-validatable.
- bug.0378 concurrency-guard on `reconcile-appset` landed in PR #1060 commit `85299e796`.
- Three follow-ups filed in PR #1061 (docs-only): `task.0375` (Argo destination + retire SSH+kubectl, blocked on 0376), `bug.0377` (release-pin matcher scope), `bug.0379` (flight↔verify cross-PR race).
- Outage diagnosis: Alchemy monthly cap exhausted on the EVM_RPC_URL key shared by preview + production envs. Not CICD-caused.
- `require-pinned-release-prs-to-main.yml` is **load-bearing** for `release/*` PR pinning — do NOT purge; bug.0377 narrows the matcher only.

## Next Actions

- [ ] Run the restore plan above against preview, then production. Watch via `gh run watch`. Pods should reach `1/1 Ready` within ~5 min of the run completing.
- [ ] If pods stay 503 after rotation, the rotated key is also throttled — escalate to Derek for a fresh provider.
- [ ] Review PR #1062 against task.0376's `outcome:` only — no inventing extra requirements. Confirm: per-node AppSets, matrix promote-k8s, `reconcile-appset` job on promote-and-deploy, lease scripts deleted, AppSet name stability (`preview-{{.name}}` etc.), aggregator concurrency group + rebase-retry.
- [ ] Before approving #1062: confirm `flight-preview.yml` `aggregate-preview` owns lock/unlock semantics (AGGREGATOR_OWNS_LEASE invariant) and that `release.yml` is byte-unchanged.
- [ ] **Don't** absorb the preview-VM drift cleanup into #1062. File `bug.0380` (AppSet drift class — manual `kubectl apply` survives revert) and address after #1062 lands. Cleanup script goes under `scripts/ops/`, captured in git, not ad-hoc SSH.
- [ ] Once #1062 merges, dispatch a preview promotion (any merge to main fires it) to validate the new shape end-to-end. Then dispatch a production promotion manually.
- [ ] Update `proj.cicd-services-gitops.md` `## Cutover State` block on each merge event.

## Risks / Gotchas

- **`promote-and-deploy.yml` is 932 lines pre-refactor**; #1062 rewrites it heavily. Highest risk in the chain. `--ref main` is the safe lever for the outage restore — do not dispatch with `--ref feat/task.0376-preview-prod-matrix`.
- **Application name stability** is the silent killer of AppSet flips. PR #1062's per-node template `preview-{{.name}}` produces names byte-identical to what's already on preview's Argo from earlier dev iterations — Argo updates in place. Verify before merge. The same trap took task.0372 (preserveResourcesOnDeletion CRD-reject).
- **Don't SSH unless 99% confident a cleanup is required.** Derek explicitly: stop ad-hoc SSH; use `deploy-infra.sh` and the workflow lever. Read-only SSH for diagnosis only.
- **Production promotion is manual workflow_dispatch** (bug.0361). Don't expect it to auto-fire from a main merge.
- **The Cutover State block** in `proj.cicd-services-gitops.md` is the cold-reload anchor. Keep it current; otherwise the next agent (or you on a fresh session) re-derives state from chat scrollback.

## Pointers

| File / Resource                                                         | Why it matters                                                                                            |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| [PR #1062](https://github.com/Cogni-DAO/node-template/pull/1062)        | task.0376 implementation — primary review target                                                          |
| [PR #1061](https://github.com/Cogni-DAO/node-template/pull/1061)        | Docs-only follow-ups (task.0375 + bug.0377 + bug.0379 + Cutover State)                                    |
| `work/items/task.0376.preview-production-matrix-cutover.md`             | Outcome contract — review #1062 against THIS, not invented requirements                                   |
| `work/items/task.0372.candidate-flight-matrix-cutover.md`               | Proven primitive, design history, dogfood evidence on candidate-a                                         |
| `work/projects/proj.cicd-services-gitops.md` `## Cutover State`         | Cold-reload anchor                                                                                        |
| `.github/workflows/promote-and-deploy.yml`                              | Restore-plan workflow (use `--ref main` for outage; #1062 rewrites it)                                    |
| `scripts/ci/deploy-infra.sh`                                            | The reusable secret/compose push lever — what the restore plan depends on                                 |
| `scripts/ci/wait-for-argocd.sh`                                         | task.0372 added per-invocation `/tmp` race fix; rollout-status gate is bug.0326's invariant               |
| `infra/k8s/argocd/{candidate-a,preview,production}-applicationset.yaml` | Candidate-a: per-node post-#1060. Preview/prod: per-node in #1062 (whole-slot on main currently)          |
| `.local/{candidate-a,preview,production}-vm-{key,ip}`                   | Read-only SSH credentials for emergency diagnosis. Candidate-a is `test-vm-{key,ip}`.                     |
| `docs/spec/ci-cd.md`                                                    | Pipeline contract; #1062 adds `BRANCH_HEAD_IS_LEASE` + `LANE_ISOLATION` axioms                            |
| `.claude/skills/devops-expert/SKILL.md`                                 | Anti-pattern list, including "silent-success on no-op runs" and "Argo Healthy ≠ rollout proof" (bug.0326) |
| `work/handoffs/archive/task.0376/` (if more handoffs come)              | Future: archive old handoffs here when refreshing                                                         |
