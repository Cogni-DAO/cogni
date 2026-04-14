---
id: bug.0312
type: bug
title: "Purge canary and staging legacy naming from docs, workflows, and scorecards; document the e2e CI/CD flow"
status: needs_design
priority: 1
rank: 2
estimate: 3
created: 2026-04-14
updated: 2026-04-14
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
---

# bug.0312 — Purge canary/staging legacy naming; document the e2e CI/CD flow

## Evidence

### 1. Spec ground truth (as of 2026-04-09)

`docs/spec/ci-cd.md` (PR #851, `0e1395871`) is the authoritative target for the trunk-based CI/CD model. Direct quotes:

- Axiom 3: _"Pre-merge safety happens in candidate or flight slots. Do not call those lanes `canary`."_
- Main Lane: _"The term `canary` must not be reused for pre-merge acceptance."_
- Environment Model: _"This spec does not require a `canary` environment."_
- Legacy to retire: _"long-lived `staging` or `canary` code-branch semantics; branch-based environment inference in workflow logic; prompts, skills, AGENTS files, or workflow docs that steer agents toward `origin/staging` or PRs into non-`main` branches."_

### 2. Runtime drift (workflows still say canary)

`.github/workflows/promote-and-deploy.yml`:

- `workflow_dispatch.inputs.environment.default: canary`
- `case "$BRANCH" in main) ENV=canary ;;` (line ~63) — branch-name inference for env routing, explicitly forbidden by ci-cd.md Workflow Design Target #2.
- `deploy_branch=deploy/canary` on the main path.
- Concurrency group: `promote-deploy-canary`.

`.github/workflows/promote-merged-pr.yml`:

- Workflow name: `Promote Merged PR to Canary`.
- `gh workflow run promote-and-deploy.yml ... -f environment=canary` (line ~147) — every merged PR lands as env=canary.

Both of these fire on every merge to main, so every downstream artifact (GitHub environment name, Loki `env` label, k8s namespace, `DEPLOY_ENVIRONMENT` runtime env var, deploy branch) inherits `canary` until this rename lands.

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

### Phase 2 — workflow rename

1. `.github/workflows/promote-and-deploy.yml`:
   - `default: canary` → `default: <new>`
   - Case stmt `main) ENV=canary` → `main) ENV=<new>`
   - `deploy/canary` → `deploy/<new>` for the branch ref
   - Concurrency group `promote-deploy-canary` → `promote-deploy-<new>`
2. `.github/workflows/promote-merged-pr.yml`:
   - Name `Promote Merged PR to Canary` → `Promote Merged PR to <new>`
   - Dispatch `-f environment=canary` → `-f environment=<new>`
   - Fallback dispatch `build-multi-node.yml` (no env change needed)
3. Rename the GitHub environment in repo settings: `canary` → `<new>` (preserves all secrets/vars).
4. Rename the deploy branch: `deploy/canary` → `deploy/<new>` (requires coordination with Argo CD ApplicationSet generators).
5. `infra/compose/runtime/configs/alloy-config.metrics.alloy` L50 — update the env allowlist regex.

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
