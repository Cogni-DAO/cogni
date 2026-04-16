---
id: handoff.multi-node-cicd
type: handoff
title: "Multi-Node CI/CD Session — Build + Promote + Verify Pipeline"
created: 2026-04-03
---

# Handoff: Multi-Node CI/CD Session

## What shipped

**Pipeline proven green:** Push to `integration/multi-node` → builds 5 images (operator, poly, resy, migrator, scheduler-worker) → promotes k8s overlay digests → Argo CD syncs → verify job confirms all 3 nodes healthy.

### Commits on `integration/multi-node`

| SHA       | What                                                                                                    |
| --------- | ------------------------------------------------------------------------------------------------------- |
| `5426dcb` | CI/CD workflows: build-multi-node.yml, promote-k8s-staging.yml, verify-deployment.yml                   |
| `533b4ef` | Fix GHCR canonical name (cogni-template, not node-template redirect)                                    |
| `21868a6` | Remove imagetools inspect (use build-push-action digest output)                                         |
| `ee71bdc` | Inline promote + verify into build workflow (workflow_run needs default branch)                         |
| `160c0e8` | Promote overlay commit (automated by CI)                                                                |
| `595ebd1` | Pass migrator digest to poly/resy promote                                                               |
| `c48b0cc` | Bug/task filings (bug.0276, task.0277, task.0278)                                                       |
| Plus      | Merged #708 (port fixes), cherry-picked #709 (migrator activation), sonar fix, component test discovery |

### Also shipped (earlier in session)

- `docs/spec/preview-deployments.md` — Preview Controller design (Tier 2)
- `proj.cicd-services-gitops` P2 rewritten (Argo → Preview Controller)
- `task.0188` rewritten (imperative preview approach)
- `setup-secrets.ts` updated with canary environment
- `docs/guides/multi-node-deploy.md` — deployment walkthrough

## Canary Status (2026-04-04T03:20Z)

| Component                     | Status       | Notes                                                                   |
| ----------------------------- | ------------ | ----------------------------------------------------------------------- |
| operator (test.cognidao.org)  | ✅ GREEN     | /readyz 200, sign-in works, AI chat works                               |
| poly (poly-test.cognidao.org) | ⚠️ PARTIAL   | /readyz 200, sign-in works, AI chat 500 — LiteLLM unreachable           |
| resy (resy-test.cognidao.org) | ⚠️ PARTIAL   | /readyz 200, sign-in works, AI chat 500 — LiteLLM unreachable           |
| scheduler-worker              | ✅ Running   | Temporal connected                                                      |
| Treasury widget               | ❌ 500       | EVM_RPC_URL not in k8s secret (operator only has it from .env.operator) |
| Grafana logs                  | ❌ Not wired | Compose Alloy has creds but k8s pods have no log shipping               |

### Remaining blockers for full green

1. **Poly/resy LiteLLM** — ConfigMap has `LITELLM_BASE_URL=http://poly-litellm-external:4000` but there's only one shared LiteLLM on Compose. The k8s ExternalService for poly-litellm doesn't exist. Fix: either point all nodes at the same LiteLLM service or create per-node ExternalServices.

2. **Treasury EVM_RPC_URL** — the k8s secret doesn't have it. The provision script sets it but the readyz probe skips EVM check (paymentRailsActive=false for nodes without payments_in in repo-spec). Treasury API route still needs it.

3. **Grafana k8s pod logs** — Alloy DaemonSet or similar needed for k8s log shipping. Compose services ship logs but k8s pods don't.

### Previously broken (now fixed)

- ~~bug.0276 — App client-side crash~~ — Fixed: .cogni/repo-spec.yaml baked into Docker images
- ~~readyz 500~~ — Fixed: EVM check skipped when payment rails inactive
- ~~Poly/resy migrations~~ — Fixed: exit-0 skip removed, correct migrator digest
- ~~Per-node repo-spec~~ — Fixed: Dockerfiles copy node-specific .cogni/
- ~~Provision script re-run lockout~~ — Fixed: key reuse + known_hosts cleanup

## GitHub Environment: canary

Created and configured:

- `VM_HOST`: 84.32.109.222
- `SSH_DEPLOY_KEY`: from `.local/test-vm-key`
- `DOMAIN` (variable): test.cognidao.org

## Top 3 agents to spawn

### Agent 1: Fix bug.0276 — COGNI_REPO_ROOT crash (P0, ~30 min)

**Goal:** Make the app boot cleanly without git-sync sidecar.

**Files to change:**

- `nodes/node-template/app/src/shared/config/repoSpec.server.ts` — make validation non-fatal, return null/undefined when repo path is invalid
- `nodes/node-template/app/src/bootstrap/capabilities/repo.ts` — skip repo capability registration when repoSpec is null
- All node copies (operator, poly, resy) inherit from node-template

**Verify:** Build image locally, run without COGNI_REPO_PATH, confirm /readyz returns 200 and homepage renders.

### Agent 2: Deployment validation skill — task.0277 (P0, ~2 hours)

**Goal:** Replace the naive /readyz curl in CI verify with a proper deployment validation that catches client-side crashes, missing system accounts, and broken billing pipelines.

**Start from:** `.claude/skills/deploy-node/SKILL.md` section 6 (just updated with 5-tier validation checklist). Wire Grafana MCP for log queries. Wire Temporal CLI for system run checks.

### Agent 3: Git manager skill + permissions — task.0278 (P1, ~1 hour)

**Goal:** Replace `ACTIONS_AUTOMATION_BOT_PAT` with GitHub App installation token. Add skill for AI agents to create branches, PRs, merge, and manage the integration flow.

**Start from:** Existing `GH_REVIEW_APP_ID` + `GH_REVIEW_APP_PRIVATE_KEY_BASE64` pattern already in the repo. Extend the GitHub App permissions to include contents:write + pull-requests:write.

## Lessons learned

1. **`workflow_run` triggers only fire from the default branch.** Our promote/verify workflows didn't fire because they only existed on `integration/multi-node`, not `staging`. Fix: inline into the build workflow for non-default branches.
2. **`github.repository` returns the redirect name** (`node-template`), not the canonical GHCR package name (`cogni-template`). Hardcode the canonical name.
3. **`docker buildx imagetools inspect --format` breaks on OCI indexes.** Use `build-push-action` digest outputs directly.
4. **Kustomize `images:` with duplicate `name:` fields** — the second entry silently overwrites the first. Use distinct base image names for app vs migrator.
5. **Health probes passing ≠ app working.** /readyz 200 while the client JS crashes. Need deeper validation (Tier 3+).
