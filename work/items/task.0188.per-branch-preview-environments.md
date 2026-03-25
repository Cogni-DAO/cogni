---
id: task.0188
type: task
title: "Per-branch preview environments (~5 simultaneous) for AI dev-lifecycle agents"
status: needs_design
priority: 1
rank: 3
estimate: 5
summary: "Agents ship a PR, get a live URL, run E2E checks, and inspect failures — no human SSH babysitting. Argo CD ApplicationSet creates/destroys preview envs per PR."
outcome: "Push to feature branch → live preview at branch-slug.preview.domain within 5 min → AI agent validates against running stack → namespace pruned on PR close. ~5 concurrent previews on single-node k3s."
spec_refs:
assignees: []
credit:
project: proj.cicd-services-gitops
branch:
pr:
reviewer:
revision: 0
blocked_by: task.0149
deploy_verified: false
created: 2026-03-19
updated: 2026-03-19
labels: [deployment, infra, gitops, dx]
external_refs:
---

# Per-Branch Preview Environments

## Problem

Single `staging` preview environment. Feature branches are only validated in CI (static tests + stack tests). No live preview until merge to staging. AI agents creating PRs have no way to validate behavior against a running stack.

## Deliverables

1. **Auto-create a preview app per PR** — Argo CD ApplicationSet with `pullRequest` generator. Wildcard DNS (`*.preview.domain`) + k8s Ingress. Preview URL posted to PR comment.
2. **Share heavy infra, only spin up what changed** — Temporal, LiteLLM, Postgres shared across previews (namespaced by branch). Only app + scheduler-worker get per-branch pods. That's how ~5 concurrent previews fit on single-node k3s without lighting money on fire.
3. **Cleanup on PR close** — TTL-based namespace pruning (PR close or 48h inactivity). No orphaned resources.

## Validation

- [ ] Push to feature branch → preview namespace created within 5 minutes
- [ ] Preview URL accessible and returns healthy response
- [ ] AI agent can hit preview API and run behavioral checks
- [ ] PR close → namespace cleaned up
- [ ] 5 concurrent previews stable on single-node k3s

## Depends On

- task.0149 (k3s cluster provisioned + Argo CD installed)
