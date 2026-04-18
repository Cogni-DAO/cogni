---
id: bug.0315
type: bug
title: "deploy-infra.sh silently overrides overlay ConfigMap COGNI_NODE_ENDPOINTS with LiteLLM-flavored value — scheduler-worker crashloops on every rebuild"
status: needs_merge
priority: 1
rank: 1
estimate: 1
created: 2026-04-18
updated: 2026-04-18
summary: "scripts/ci/deploy-infra.sh wrote COGNI_NODE_ENDPOINTS (pulled from the GH-Actions env secret of the same name, which holds a LiteLLM billing-router value in UUID=URL form) into scheduler-worker-secrets. k8s envFrom later-wins meant that Secret silently overrode the overlay ConfigMap's correct named-key routing (`operator=...,poly=...,resy=...`). Since worker.ts:94 fails boot when `operator=` entry is missing, every flight that rebuilt scheduler-worker crashlooped. Latent since #713 (2026-04-03); surfaced 2026-04-18 when PR #900's shared-package diff triggered an all-targets rebuild."
outcome: "deploy-infra.sh does not write COGNI_NODE_ENDPOINTS anywhere. Overlay ConfigMap is the single source of truth for scheduler-worker routing. Flight gate (candidate-flight.yml and promote-and-deploy.yml) fails loud on in-cluster service crashloops via kubectl rollout status. Future rebuilds of scheduler-worker on any env roll cleanly, and the same class of config-override bug is structurally prevented for any future no-Ingress service."
spec_refs:
  - docs/spec/services-architecture.md
  - docs/spec/ci-cd.md
assignees: [derekg1729]
credit:
project: proj.cicd-services-gitops
initiative:
branch: fix/scheduler-worker-endpoints-override
pr: https://github.com/Cogni-DAO/node-template/pull/913
related:
  - PR #900
  - PR #913
  - "#713 (introduced the boot check)"
---

# bug.0315 — scheduler-worker endpoints override

## Evidence

Observed 2026-04-18 during pr-coordinator-v0 flight of PR #900:

- `scheduler-worker-74fc6b495f-wtxjh` in `cogni-candidate-a` CrashLoopBackOff after 5 restarts
- Fatal at `services/scheduler-worker/src/worker.ts:94`: `COGNI_NODE_ENDPOINTS must include "operator" entry for sweep activities`
- Env var unset on both new (crashing) and old (still healthy, pre-check-image) pods
- Old pod keeps serving because the new ReplicaSet never reaches Ready

## Root cause

`scripts/ci/deploy-infra.sh` line 911 (pre-fix):

```bash
COGNI_NODE_ENDPOINTS=${COGNI_NODE_ENDPOINTS:-}
```

inside the `scheduler-worker-secrets` generation block. `${COGNI_NODE_ENDPOINTS}` in that scope is the env-level GH-Actions secret, which holds the **LiteLLM billing-router value**:

```
4ff8eac1-…=http://host.docker.internal:30000/…/billing/ingest,
5ed2d64f-…=http://host.docker.internal:30100/…/billing/ingest,
f6d2a17d-…=http://host.docker.internal:30300/…/billing/ingest
```

(UUID → billing-ingest URL, no named keys). The overlay ConfigMap at `infra/k8s/overlays/<env>/scheduler-worker/kustomization.yaml` already had the correct named-key format (`operator=http://operator-node-app:3000,poly=...,resy=...`), but the Deployment's `envFrom` applies ConfigMap → Secret (later-wins), so the Secret's wrong value silently won.

`deploy-infra.sh` line 642 already acknowledged the ConfigMap was authoritative — the override at 911 contradicted the comment.

Latent since #713 (multi-node execution routing, 2026-04-03) introduced the boot check. Affected-only CI never rebuilt `scheduler-worker` in the intervening 15 days until #900's `packages/*` diff triggered a `detect-affected.sh → add_all_targets`.

## Fix (PR #913)

- Remove the override write in both `scheduler-worker-secrets` and per-node `*-node-app-secrets` generation blocks.
- Remove the now-dead SSH env passthrough in `deploy-infra.sh`'s remote invocation.
- Remove the now-dead `COGNI_NODE_ENDPOINTS: ${{ secrets.COGNI_NODE_ENDPOINTS }}` in `promote-and-deploy.yml`.
- Add `scripts/ci/wait-for-in-cluster-services.sh` — kubectl rollout status for services with no Ingress. Wire into `candidate-flight.yml` and `promote-and-deploy.yml` (after `deploy-infra` so rolling-restart-induced crashloops are caught).
- Codify the rule in `docs/spec/services-architecture.md` → "Configuration source of truth".

## Stale key cleanup

Automatic via `kubectl apply`'s three-way merge on the next `deploy-infra.sh` run per env. `apply` sees the key in last-applied-configuration + live + missing from new manifest → removes it. No manual SSH required.

## Validation

- [ ] Merge PR #913
- [ ] Dispatch `candidate-flight-infra.yml` on candidate-a → scheduler-worker rolls clean from the overlay ConfigMap
- [ ] Re-flight #900; confirm new `Wait for in-cluster services` step passes
- [ ] Next preview/prod promotion self-heals on its own `deploy-infra` run

## Lessons / follow-ups

- Name collision between LiteLLM-flavored `COGNI_NODE_ENDPOINTS` (compose env) and scheduler-worker-flavored `COGNI_NODE_ENDPOINTS` (k8s ConfigMap) is the underlying hazard. A rename (`LITELLM_NODE_BILLING_ROUTES` or similar) would eliminate the ambiguity but has broader blast radius — deferred.
- Affected-only CI protects stale images until shared-package changes trigger rebuilds, which can surface latent config drift in unrelated PRs. Worth considering a periodic "all-targets rebuild" cadence on main to catch drift earlier. Tracked separately.
