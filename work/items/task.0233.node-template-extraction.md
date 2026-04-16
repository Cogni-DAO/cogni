---
id: task.0233
type: task
title: "Design: extract node-template from operator repo — identity split + repo-spec merge"
status: needs_design
priority: 1
rank: 3
estimate: 5
summary: "This repo (cogni-template) is evolving into an operator. Define what the true 'node-template' is — the minimal forkable app a new node gets. Merge node-spec (from task.0232 create-node output) into repo-spec schema. Clarify operator vs node identity boundaries."
outcome: "A clear separation: operator repo (this) manages nodes, node-template is the fork target for new projects. repo-spec.yaml has a `nodes[]` or `infra.dns` section that captures per-node provisioning data. New node creation outputs a repo-spec fragment that merges cleanly."
spec_refs: node-launch-spec, node-formation-spec, node-operator-contract-spec
assignees: derekg1729
credit:
project: proj.node-formation-ui
branch:
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-03-30
updated: 2026-03-30
labels: [infra, architecture, node-formation, identity]
external_refs:
---

# Design: Extract Node-Template from Operator Repo

## Context

`cogni-template` started as a single-node template. It's now becoming the **operator** — the admin platform that manages multiple nodes. But new nodes still fork this repo to get their app. We need to decide:

1. **What is the "node-template"?** The minimal subset a new node gets when forked. Not the operator scaffolding, not the admin UI, not the node-registry — just the app + packages + infra a project needs to run independently.

2. **Where does node-spec live?** The create-node wizard (task.0232) outputs a JSON fragment with `node_id`, `domain`, `dns`, `infra`. This needs to merge into `repo-spec.yaml` so the node's identity is declarative.

3. **What does this repo become?** Options:
   - **GitHub model**: This repo IS the template. Operator features live alongside. Each fork strips what it doesn't need.
   - **Split model**: Extract `node-template/` as a separate repo. This repo becomes pure operator. Nodes fork from the template repo.
   - **Monorepo model**: `apps/operator/` (admin) + `apps/node/` (fork target) in one repo. Nodes fork and delete `apps/operator/`.

## Design Questions (needs_design)

### Identity Split

- [ ] Define the boundary: which dirs/packages are "operator-only" vs "node-portable"
- [ ] How does a forked node strip operator code? `.cogni/fork-manifest.yaml`? A script? GitHub template repo exclusions?
- [ ] Does the operator track nodes via repo-spec, a DB table, or both?

### repo-spec Schema Evolution

- [ ] Add `infra.dns` section to repo-spec schema (zone_id, record_id, domain, provider)
- [ ] Add `infra.deployment` section (namespace, database_schema, cluster)
- [ ] Merge create-node output into repo-spec v0.2.0
- [ ] Backward compat: existing single-node deployments must still work

### Node-Template Shape

- [ ] Define the minimal file set for a new node:
  - `apps/operator/` (the app)
  - `packages/` (shared libraries)
  - `.cogni/repo-spec.yaml` (identity + config)
  - `infra/` (deployment manifests)
  - What else? What's excluded?
- [ ] How are shared packages updated across nodes? (the fork-sync problem)
- [ ] Reference: cogni-resy-helper (PR #11) is the first real child node — what did it need?

## Requirements

- [ ] Decision doc: operator vs node-template boundary (ADR or spec update)
- [ ] repo-spec schema v0.2.0 with `infra.dns` and `infra.deployment` sections
- [ ] create-node wizard updated to output repo-spec-compatible YAML (not just JSON)
- [ ] Migration path: current single-node deployments upgraded without breakage

## Allowed Changes

- `.cogni/repo-spec.yaml` — schema additions
- `packages/repo-spec/` — schema validation updates
- `docs/spec/node-launch.md` — operator/node boundary section
- `docs/decisions/adr/` — new ADR if needed
- `work/items/task.0233.*` — this file

## Plan

- [ ] Step 1: Audit this repo — classify every top-level dir as operator-only, node-portable, or shared
- [ ] Step 2: Study cogni-resy-helper fork — what did it keep, what did it strip?
- [ ] Step 3: Draft repo-spec v0.2.0 schema with infra sections
- [ ] Step 4: Write ADR: operator/node-template split strategy
- [ ] Step 5: Update create-node wizard to output repo-spec YAML fragment
- [ ] Step 6: Validate: fork this repo, apply node-spec, verify it runs standalone

## Validation

**Expected:** Clear ADR + updated schema. create-node outputs repo-spec YAML. Existing deployments unaffected.

## Review Checklist

- [ ] **Work Item:** `task.0233` linked in PR body
- [ ] **Spec:** FORK_FREEDOM invariant upheld — nodes must run without operator
- [ ] **Spec:** REPO_SPEC_AUTHORITY — repo-spec.yaml is single source of truth for node identity
- [ ] **Backward compat:** Existing repo-spec v0.1.x still parses

## PR / Links

- Depends on: task.0232 (dns-ops, create-node wizard)
- Blocks: task.0202 (provisionNode needs to know what repo to create)
- Reference: https://github.com/Cogni-DAO/cogni-resy-helper/pull/11
- Handoff: [handoff](../handoffs/node-setup-workflow.handoff.md)

## Attribution

-
