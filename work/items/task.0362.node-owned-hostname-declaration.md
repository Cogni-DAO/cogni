---
id: task.0362
type: task
title: "Node-owned hostname declaration for verify + ingress"
status: needs_design
priority: 3
rank: 3
estimate: 2
summary: "Replace string-split hostname inference (`${node}-${DOMAIN}` with apex/subdomain branching) with a node-owned, declarative hostname mapping so verify scripts and Argo manifests share one source of truth."
outcome: "Adding a new node requires one line in that node's overlay/ApplicationSet — not edits to verify-buildsha.sh, verify-deployment.sh, and Ingress manifests in three separate places. Verify scripts read the hostname from the same place Ingress does."
spec_refs:
  - ci-cd-spec
assignees: []
credit:
owner: derekg1729
created: 2026-04-24
updated: 2026-04-24
project: proj.cicd-services-gitops
---

# task.0362 — Node-owned hostname declaration

## Context

Today, three places infer node hostnames from `DOMAIN`:

1. `scripts/ci/verify-buildsha.sh` — patched in bug.0367 / PR #1027 with apex-vs-subdomain branching.
2. `scripts/ci/verify-deployment.sh` — patched in bug.0367 followup / PR #1028.
3. Ingress hosts in each node's `infra/k8s/overlays/<env>/<node>/` manifest.

The (1) + (2) patches work but are hacky: the hostname convention differs between apex (`poly.cognidao.org`) and subdomain (`poly-preview.cognidao.org`) DOMAINs, forcing shell to reason about DNS shape.

## Proposed direction

One of:

- **Per-node overlay field.** Add `hostname` to each `infra/k8s/overlays/<env>/<node>/kustomization.yaml` (or a sibling config) that Ingress reads and verify scripts read. No shell string-splits.
- **ApplicationSet-driven.** Declare hostnames in the `<env>-applicationset.yaml` template and expose them via a generated JSON manifest the verify scripts can `jq` at.
- **Single DNS convention.** Add DNS + Ingress for `poly.cognidao.org` (dot) in all envs — then verify scripts can always dot-join regardless of DOMAIN shape. Larger DNS blast radius.

Design tradeoffs: deliverability across preview/prod, how new nodes get added by external contributors, how the convention degrades when a node is not Ingress-exposed (scheduler-worker).

## Acceptance

- `scripts/ci/verify-buildsha.sh` and `scripts/ci/verify-deployment.sh` read hostnames from the declarative source (no apex/subdomain branching).
- Adding a new node's hostname is a single-file change under `infra/` — no verify-script edits.
- Per-env DNS uniformity (`poly.<env>.cognidao.org` or equivalent) documented in `ci-cd-spec`.

## Validation

exercise: Add a new mock node's hostname in one file under `infra/`; run `promote-and-deploy.yml` against preview and production; `verify` + `verify-deploy` pick up the new node without any `scripts/ci/verify-*.sh` edits.
observability: Both verify jobs exit 0 for the mock node at both envs. Grep shows zero references to `${node}-${DOMAIN}` / `${node}.${DOMAIN}` string-splits in `scripts/ci/`.
