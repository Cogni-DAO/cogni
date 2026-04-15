---
id: bug.0312
type: bug
title: "Purge canary and staging legacy naming from docs, workflows, and scorecards; document the e2e CI/CD flow"
status: needs_design
priority: 1
rank: 2
estimate: 3
created: 2026-04-14
updated: 2026-04-15
revision: 2
summary: "docs/spec/ci-cd.md (PR #851, 0e1395871) established the trunk-based model — candidate-a for pre-merge flight, preview + production for post-merge promotion, no canary environment. But the runtime workflows, 11 docs, 26 work items, and the live promote-and-deploy.yml all still use `canary` as the env name for what should be candidate-a (pre-merge) or preview (post-merge); 28 docs still reference the retired `staging` code branch. The drift blocks every future observability, deploy, and onboarding task from being spec-aligned."
outcome: "One coherent naming across spec, workflows, scorecards, guides, and Loki/Prometheus labels: `candidate-a` for pre-merge flight slots, `preview` for post-merge validation, `production` for production. No `canary` environment. No `staging` code branch references. One canonical e2e CI/CD diagram in docs/spec/ci-cd.md that matches what the workflows actually do, with legacy terms retired or marked explicitly as historical."
spec_refs:
  - docs/spec/ci-cd.md
  - docs/spec/cd-pipeline-e2e.md
  - docs/spec/node-ci-cd-contract.md
assignees: []
credit:
project: proj.cicd-services-gitops
initiative:
branch:
related:
  - PR #851
  - PR #859
  - PR #869
  - PR #870
  - PR #874
---

# bug.0312 — Purge canary/staging legacy naming; document the e2e CI/CD flow

## Partial Progress (PR #874, 2026-04-15)

PR #874 addressed the acute runtime symptoms that were blocking the preview lane end-to-end — it does NOT close this bug, but it unblocks Phase 2 and Phase 2.5 verification. What it landed:

- Squash-merge resolver fix in `flight-preview.yml` (`pr-{N}-{prHeadSHA}` image lookup via `gh api pulls/{N}`) — every post-merge auto-dispatch had been aborting at "no pr-\* images" since PR #870 landed.
- `scripts/ci/wait-for-argocd.sh` now waits on `status.sync.revision == deploy-branch SHA` + `Healthy`, with an active `kubectl patch` sync trigger after 30s of no progress. The old `sync.status == Synced` path timed out at 15 min every time because EndpointSlices drift continuously.
- `promote-and-deploy.yml` lock/unlock-preview jobs check out `main` so `set-preview-review-state.sh` is always present regardless of the `source_sha` being deployed.
- New "Reconcile ArgoCD ApplicationSet" step in both `promote-and-deploy.yml` and `candidate-flight.yml` — scp + `kubectl apply -f` of the env's AppSet YAML before wait-for-argocd, so future template drift (like the `deploy/staging → deploy/preview` rename that wedged preview for a week) self-heals on every CD run.
- `promote-and-deploy.yml` dropped canary from `workflow_dispatch` inputs/options/case, the concurrency fallback, and the dead `workflow_run` trigger. `infra/k8s/argocd/kustomization.yaml` dropped `canary-applicationset.yaml` and the file was deleted. `scripts/setup/provision-test-vm.sh` dropped the `canary)` case and gained a `candidate-*)` glob so candidate-b/c/… slots spin up without script edits.

Live VM fix applied same session (not part of the PR): `cogni-preview` ApplicationSet on 84.32.110.92 was patched from `deploy/staging` → `deploy/preview`. Preview apps now show `sync.revision` matching the deploy/preview tip.

Still open (this bug's remaining scope):

- **Phase 2 remaining**: `deploy/canary` branch deletion; GitHub environment rename `canary → candidate-a` (zero secrets on candidate-a env, blocks pre-merge deploy-infra).
- **Phase 2.5 verification**: rows 1–3 + 7 of the handoff matrix still unverified (candidate-a Compose reconcile + Grafana evidence) — blocked on candidate-a secrets parity, not code.
- **Phase 3**: docs + scorecard canary/staging purge across the 11 docs + 26 work items + `alloy-loki-setup.md` LogQL examples.
- **Phase 4**: canonical e2e CI/CD diagram section in `docs/spec/ci-cd.md`.
- **Phase 5**: skills + workflow prompts + agent guidance pass.
- **Observability `env` label**: Loki label values still show `["ci"]` only — no VM compose alloy has shipped under `env=preview` or `env=candidate-a` since PR #869 widened the pod-log filter. Will exercise once the chain deploys cleanly end-to-end.

## Evidence

### 1. Spec ground truth (as of 2026-04-09)

`docs/spec/ci-cd.md` (PR #851, `0e1395871`) is the authoritative target for the trunk-based CI/CD model. Direct quotes:

- Axiom 3: _"Pre-merge safety happens in candidate or flight slots. Do not call those lanes `canary`."_
- Main Lane: _"The term `canary` must not be reused for pre-merge acceptance."_
- Environment Model: _"This spec does not require a `canary` environment."_
- Legacy to retire: _"long-lived `staging` or `canary` code-branch semantics; branch-based environment inference in workflow logic; prompts, skills, AGENTS files, or workflow docs that steer agents toward `origin/staging` or PRs into non-`main` branches."_

### 2. Runtime drift (post-PR #870 delta)

PR #870 (task.0293) landed 2026-04-14 and closed most of the post-merge workflow drift:

- ✅ `promote-merged-pr.yml` deleted → renamed to `.github/workflows/flight-preview.yml` (originally `flight-merged-pr-to-preview.yml`, shortened in same PR)
- ✅ `promote-and-deploy.yml` `case "$BRANCH" in main) ENV=canary` arm deleted — workflow_run trigger now fails loudly with a clear message
- ✅ `scripts/ci/promote-to-preview.sh` → renamed to `scripts/ci/flight-preview.sh` (it's a gate + dispatcher, not a promoter)
- ✅ New three-value lease (`unlocked | dispatching | reviewing`) on `deploy/preview:.promote-state/` with deterministic concurrency safety
- ✅ Auto-unlock on deploy failure (any non-success result)
- ✅ `docs/spec/ci-cd.md` gained a **Preview Review Lock** subsection documenting the contract
- ✅ `docs/spec/cd-pipeline-e2e.md` §4.1, §4.4, §12.1, §12.5, Appendix A refreshed to name real workflows

**Remaining runtime drift** (non-blocking for #870, blocker for this bug):

- `.github/workflows/promote-and-deploy.yml`:
  - `workflow_dispatch.inputs.environment.default: canary` (should be `preview`)
  - `options: [canary, preview, production]` (drop `canary`)
  - `description: "Target environment (canary, preview, production)"`
  - `concurrency.group: promote-${{ ... || 'canary' }}` fallback
  - `case "$ENV" in canary) ...` arm — dead path, no one should dispatch it
  - Dead `on.workflow_run.workflows: ["Build Multi-Node"]` trigger (fails loudly, but the trigger block itself should go)
- `infra/compose/runtime/configs/alloy-config.metrics.alloy` L50 env allowlist regex — fixed in this PR (`canary → candidate-a`)
- Other active docs (enumerated in Phase 3 below)

### 3. Scale of the staleness

- `\bcanary\b` in **11 docs**, **26 work items**
- `\bstaging\b` in **28 docs**

Most staging mentions are in historical postmortems, handoffs, and archived docs — those should stay historical, not be rewritten. The canary mentions, by contrast, are mostly in active specs, guides, and the CI/CD scorecard, where they actively reinforce the legacy model.

### 4. Concrete drift markers

- `work/projects/proj.cicd-services-gitops.md` Environment Status table header: `Canary (84.32.109.160) | Preview (84.32.110.92)` — the 84.32.109.160 VM is the candidate-a VM per the alloy-loki-setup guide, but the scoreboard still labels it "Canary".
- `docs/guides/alloy-loki-setup.md` LogQL query examples use `env="canary"` — technically runtime-correct today (because `DEPLOY_ENVIRONMENT=canary` is what the workflow passes), but spec-misaligned. Every future guide example will copy this.
- `infra/compose/runtime/configs/alloy-config.metrics.alloy` L50: `regex = "^(local|canary|preview|production)$"` — hard-coded env allowlist in the discovery.relabel filter. Renaming DEPLOY_ENVIRONMENT without updating this regex drops all metrics.
- `candidate-flight.yml` uses `SLOT: candidate-a` and `OVERLAY_ENV: candidate-a` correctly (good) — but the env is still named after the slot in a way that's ambiguous vs. post-merge canary.

## Root cause

The spec was rewritten in PR #851 (Apr 9, 2026) faster than the runtime could be migrated. Later PRs (#859 "main → canary promotion via PR image re-tag") continued using the legacy `canary` env name because renaming it would have cascaded into every GitHub environment, every secret scope, every deploy branch name, every Loki label, and every agent skill simultaneously. The safe path was to keep shipping with `canary` as the runtime env and retire it in a dedicated cleanup PR — which has not yet been filed. This bug tracks that PR.

## Fix

### Phase 1 — audit and lock the target

1. Confirm the target naming one last time with the spec owner:
   - `candidate-a` — pre-merge flight slot (via `candidate-flight.yml`)
   - `preview` — first post-merge promotion lane (via `promote-and-deploy.yml`)
   - `production` — final promotion lane
   - **`canary` as an environment name is retired.**
2. Decide the post-merge first-stop target: does every merged PR land directly on `preview`, or is there an intermediate post-merge lane? If intermediate, pick a non-canary name (e.g., `post-merge-validate`, `edge`, `trunk-soak`). ci-cd.md's Main Lane section implies `preview` IS the first required post-merge lane, so probably no intermediate lane.
3. Decide the fate of the `canary` VM + GitHub environment + Loki label + k8s namespace:
   - Option A: rename in place — `canary` → the new name across GitHub environments, secrets, Loki labels, VM hostnames, namespace (`cogni-canary` → `cogni-preview` or `cogni-candidate-a`).
   - Option B: add new environment alongside, migrate workflows one at a time, retire `canary` last.
   - Option A is faster and matches "build once, retire once"; Option B is less risky but stretches the migration across weeks.

### Phase 2 — remaining workflow cleanup (post-#870)

Most of the rename landed in PR #870 (task.0293). What's left:

1. `.github/workflows/promote-and-deploy.yml`:
   - `workflow_dispatch.inputs.environment.default: canary` → `default: preview`
   - `options: [canary, preview, production]` → `[preview, production]` (remove `canary` option; manual-dispatch to a dead env is a footgun)
   - Description string mentioning canary
   - `concurrency.group: promote-${{ ... || 'canary' }}` dead-fallback → drop the `|| 'canary'`
   - `case "$ENV" in canary) OVERLAY=canary; DEPLOY_BRANCH=deploy/canary ;;` arm — delete entire canary case (nothing dispatches `env=canary`)
   - `on.workflow_run.workflows: ["Build Multi-Node"]` trigger — delete (fallback path was killed in #870, trigger is now dead code that exits 1 if ever fired)
2. `.github/workflows/build-multi-node.yml` — audit: still lives as a dispatch-only fallback. Decide whether to keep or retire in favor of `pr-build.yml` only.
3. **GitHub environment rename** (`canary` → `candidate-a`): repo settings → Environments → rename. Preserves secrets/vars. Callers: `candidate-flight.yml` already uses `environment: candidate-a` so that PROBABLY already exists; confirm and drop the old `canary` environment.
4. **Deploy branch retire** (`deploy/canary`): after the GitHub environment rename and after confirming no workflow references it, `git push origin :deploy/canary` (delete remote) and clean up Argo CD ApplicationSet generators that list it.
5. `infra/compose/runtime/configs/alloy-config.metrics.alloy` env allowlist regex — fixed in PR #869 commits.

### Phase 2.5 — close the candidate-a Compose deploy gap (HIGH PRIORITY)

**Current state:** `candidate-flight.yml` only rsyncs `infra/k8s/base/`, `infra/catalog/`, and `infra/k8s/overlays/candidate-a/` to `deploy/candidate-a`, then lets Argo CD reconcile. It does **not** run `scripts/ci/deploy-infra.sh` against the candidate-a VM. Consequences:

- Compose service changes under `infra/compose/**` (alloy config, litellm, temporal, caddy, postgres, redis) cannot be validated pre-merge on candidate-a
- The candidate-a VM's compose state is frozen at whatever `scripts/setup/provision-test-vm.sh` wrote at provision time
- A PR that breaks `alloy-config.metrics.alloy` (or any compose service) is first exercised live on the preview VM after merge — if it wedges, preview goes red and `unlock-preview-on-failure` fires, but the bad code is already on main
- Pre-merge validation lane for infra PRs does not exist

**Fix options:**

**Option A — Extend `candidate-flight.yml` with a deploy-infra step.** Add a new step after "Commit and push deploy/candidate-a" and before "Wait for candidate readiness" that runs `scripts/ci/deploy-infra.sh` against the candidate-a VM. Requires:

- candidate-a GitHub environment already has `VM_HOST` and `SSH_DEPLOY_KEY` (from provision). Confirm.
- All ~30 compose-deploy env vars (`DATABASE_URL`, `LITELLM_MASTER_KEY`, `OPENROUTER_API_KEY`, etc.) must be on the `candidate-a` environment. Many already are (provision step wrote them).
- `scripts/ci/deploy-infra.sh` is idempotent; running it against candidate-a is the same shape as against preview.
- Adds ~5 min to every candidate flight (compose up/down + health check).

Blast-radius analysis: if the new step fails, `release-candidate-slot.sh` still fires on failure, the lease is released, the PR author gets a red candidate-flight status. Same failure semantics as today.

Code shape:

```yaml
- name: Deploy infra to candidate-a VM
  if: steps.acquire.outcome == 'success' && steps.acquire.outputs.slot_busy != 'true'
  env:
    VM_HOST: ${{ secrets.VM_HOST }}
    DOMAIN: ${{ vars.DOMAIN }}
    DEPLOY_ENVIRONMENT: candidate-a
    APP_ENV: production
    # ...full env block mirrored from promote-and-deploy.yml:deploy-infra...
  run: |
    mkdir -p ~/.ssh && chmod 700 ~/.ssh
    echo "${{ secrets.SSH_DEPLOY_KEY }}" | tr -d '\r' > ~/.ssh/deploy_key
    chmod 600 ~/.ssh/deploy_key
    ssh-keyscan -T 10 -H "$VM_HOST" >> ~/.ssh/known_hosts 2>/dev/null || true
    bash app-src/scripts/ci/deploy-infra.sh
```

**Option B — Extract `deploy-infra` to a reusable workflow.** Create `.github/workflows/_deploy-infra.yml` with `on: workflow_call`, move the 60-line env block + SSH setup + `deploy-infra.sh` invocation into it, then have both `candidate-flight.yml` and `promote-and-deploy.yml` call it with `secrets: inherit`. Cleaner long-term, ~1hr refactor, but duplication in current state is bounded so Option A is the faster v0 path.

**Option C — Path-gated manual dispatch.** Detect if a PR touches `infra/compose/**` and fail hard with "flight this PR manually to deploy infra" — but that still requires the step to exist, so it collapses back to Option A or B.

**Recommended:** **Option A** now (fast, unblocks the lane, matches existing duplication cost); **Option B** as a follow-up refactor once the call sites stabilize.

**Acceptance for Phase 2.5:**

- [ ] `candidate-flight.yml` runs `deploy-infra.sh` against candidate-a after acquiring the slot
- [ ] A PR that changes `infra/compose/runtime/configs/alloy-config.metrics.alloy` can be flighted into candidate-a and the alloy config on the candidate-a VM reflects the PR's change before merge
- [ ] `smoke-candidate.sh` catches any regression from the compose change
- [ ] Candidate-a Environment Status row in the project scorecard reads "Compose infra healthy ✅ (CI-reconciled)" instead of "(frozen at provision)"

### Phase 3 — docs and scorecard purge

Rewrite (not delete) these to match the new spec:

**P0 (scoreboards and active guides):**

- `work/projects/proj.cicd-services-gitops.md` — Environment Status table header; all narrative prose that says "canary pipeline" or "canary → preview"; row titles.
- `docs/guides/alloy-loki-setup.md` — LogQL query examples; env label references.
- `docs/guides/multi-node-deploy.md` — operational guide.
- `docs/guides/agent-api-validation.md` — operational examples.

**P1 (spec surface):**

- `docs/spec/cd-pipeline-e2e.md` — 967-line doc touched by PR #851; audit for straggler canary references.
- `docs/spec/node-ci-cd-contract.md` — CI/CD sovereignty invariants referenced from ci-cd.md.
- `docs/spec/observability-requirements.md` — observability domain; will cascade.
- `docs/spec/ci-cd.md` — already the ground truth, but quick pass to catch any inconsistency.

**P2 (runbooks and supporting docs):**

- `docs/runbooks/DEPLOYMENT_ARCHITECTURE.md` — infrastructure details; linked from ci-cd.md.
- `docs/runbooks/INFRASTRUCTURE_SETUP.md` — bootstrap flow references.
- `docs/runbooks/CICD_CONFLICT_RECOVERY.md` — marked as "historical" already; verify.
- `docs/runbooks/SECRET_ROTATION.md` — may mention canary GitHub environment.

**Leave alone (historical / archive):**

- `docs/spec/cd-pipeline-e2e-legacy-canary.md` — intentional legacy marker per `docs/spec/ci-cd.md` L199.
- `docs/postmortems/*` — historical record.
- `docs/archive/*` — archived.
- 26 historical work items referencing canary (task.0281, task.0286, task.0292, task.0293, etc.) — they built the legacy model; rewriting them misrepresents history. Leave.

### Phase 4 — canonical e2e CI/CD diagram

Add one Mermaid diagram to `docs/spec/ci-cd.md` under a new `## End-to-End Flow (as-built)` section that traces a feature PR from creation to production deploy. Must include exactly what happens:

```
open PR
  → pr-build.yml builds pr-{N}-{sha} images
  → (manual) candidate-flight.yml dispatched → rsyncs deploy/candidate-a,
    Argo CD syncs, smoke checks run
  → PR merge to main
  → promote-merged-pr.yml → re-tags pr-{N}-{sha} as preview-{sha}
    → dispatches promote-and-deploy.yml env=<post-merge-lane>
  → promote-and-deploy.yml:
      promote-k8s  → rsync base/catalog, promote digests, push deploy/<env>
      deploy-infra → SSH VM, rsync infra/compose, docker compose up -d
      verify       → readyz + TLS checks
      e2e          → Playwright smoke
      promote-to-preview (if e2e green and env is the first post-merge lane)
  → preview deploy-infra run
  → production (manual release.yml)
```

Two current gaps that the diagram should explicitly flag:

1. **candidate-flight does NOT run deploy-infra.** It only rsyncs k8s state to `deploy/candidate-a` — compose service changes (alloy config, litellm, temporal, etc.) never reach the candidate-a VM via candidate-flight. They only land via the post-merge promote-and-deploy path. This is a **validation gap**: compose-only infra changes cannot be pre-merge validated today.
2. **No production promotion in the automated pipeline** (proj row #8). `release.yml` is policy-gated manual dispatch.

### Phase 5 — skills, workflow prompts, and agent guidance

Grep all `.claude/skills/`, `.agent/workflows/`, `.cursor/commands/`, `.gemini/commands/` for `canary` and `staging`; update any that steer agents toward the legacy names. PR #859 did a pass on these files but didn't rename canary itself because the runtime still uses it.

## Acceptance

- [ ] `grep -r "canary" docs/guides docs/spec work/projects` returns zero hits (except in `cd-pipeline-e2e-legacy-canary.md` and `ci-cd.md` legacy-retire section).
- [ ] `grep -r "staging" docs/guides docs/spec work/projects` returns zero hits outside historical/archive paths.
- [ ] `gh workflow view promote-and-deploy.yml` shows no `canary` in inputs, case stmts, or env routing.
- [ ] `gh api /repos/.../environments` shows no environment named `canary`.
- [ ] Loki query `{env="canary"}` returns no new samples after the cutover date (historical samples remain for retention window).
- [ ] `docs/spec/ci-cd.md` contains a `## End-to-End Flow (as-built)` section with a mermaid diagram that traces PR → merge → preview → production, naming the exact workflow files and jobs at each step, and flagging the two gaps above.
- [ ] `work/projects/proj.cicd-services-gitops.md` Environment Status table uses the new naming.
- [ ] `infra/compose/runtime/configs/alloy-config.metrics.alloy` env allowlist regex matches the new naming.
- [ ] Post-cleanup CI run produces Loki logs under the new env label on the actual VMs.

## Validation

- **exercise:** Merge a trivial no-op PR after this cleanup lands. Verify in Grafana Cloud that new logs appear under the new env label (e.g. `{env="preview"}` or `{env="candidate-a"}`) and zero new logs appear under `{env="canary"}`.
- **observability:** `kubectl -n cogni-<new-env>` exists on the VM; `kubectl -n cogni-canary` either does not exist or has been explicitly renamed.

## Notes

- This is a **coordinated rename** that touches GitHub repo settings (environments), the CI runtime, 10+ docs, and observability labels simultaneously. It should land as a single PR or a tightly-sequenced PR chain, NOT as a gradual cleanup over multiple PRs — staged renames will leave the system in a mixed state that is worse than the current consistent-legacy state.
- This bug surfaced while rescoping PR #869 (feat/alloy-control-plane-ingest). PR #869's LogQL query examples in `docs/guides/alloy-loki-setup.md` still use `env="canary"` because it's runtime-correct today — a note should be added to PR #869 pointing at this bug as the follow-up.
- PR #851 should be re-read before implementation starts — it renamed many agent-guidance files already, so the remaining canary/staging references are the ones that were explicitly blocked by "workflow still uses canary as the env name."
