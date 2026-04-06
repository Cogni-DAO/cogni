---
id: story.0263
type: story
title: "Doltgres Node Lifecycle — clone/pull from remotes, repo-spec linking, permission model"
status: needs_design
priority: 2
rank: 3
estimate: 5
summary: "Replace local-only Doltgres provisioning with a git-like lifecycle: nodes clone knowledge from a remote (DoltHub or self-hosted), pull updates, and push validated contributions. Requires linking knowledge repos in repo-spec.yaml and a permission model for read/write/push access."
outcome: "New node setup clones knowledge from a public/private Dolt remote instead of running seed SQL. Knowledge updates flow between operator and nodes via pull/push. repo-spec.yaml declares which knowledge repo a node tracks."
spec_refs:
  - knowledge-data-plane-spec
assignees: derekg1729
project: proj.poly-prediction-bot
created: 2026-04-02
updated: 2026-04-02
---

# Doltgres Node Lifecycle — Clone, Pull, Push

> Spec: [knowledge-data-plane](../../docs/spec/knowledge-data-plane.md) | Depends on: task.0231 (done), story.0248 (branching CI/CD)

## Context

Today, `db:provision:doltgres` creates empty databases and applies schema + seed via SQL. This is a bootstrap-only workflow — there's no way to inherit existing knowledge from an operator or pull updates.

Dolt is git for data. The natural lifecycle is:

1. **Operator publishes** a knowledge repo (DoltHub or self-hosted remote)
2. **Node clones** the repo during setup (instead of CREATE DATABASE + seed SQL)
3. **Node pulls** updates from operator (new base knowledge, strategy updates)
4. **Node pushes** validated contributions back (optional, gated)

This requires:

- repo-spec.yaml declaring which knowledge remote a node tracks
- Permission model: who can read, clone, pull, push
- Dev workflow: `pnpm dev:setup` clones instead of provisions (when remote is configured)

## Design Questions

- [ ] Where do knowledge remotes live? DoltHub (public), self-hosted Dolt remote, or both?
- [ ] How does repo-spec.yaml reference the knowledge remote? New `knowledge.remote` field?
- [ ] Permission model: public repos (anyone clones), private repos (token-gated), contribution push (x402?)
- [ ] Dev workflow: local-only (current) vs clone-from-remote — how to switch?
- [ ] How does this interact with story.0248 (branching CI/CD)? Branches are local, main syncs with remote?

## Sketch

```yaml
# .cogni/repo-spec.yaml (proposed addition)
knowledge:
  remote: "https://dolthub.com/cogni-dao/knowledge-base" # or self-hosted
  branch: main
  auto_pull: true # pull on startup
```

```
Node Setup (future):
  1. Read repo-spec.yaml → knowledge.remote
  2. If remote set: dolt_clone(remote) → knowledge_{node_name}
  3. If no remote: CREATE DATABASE + seed SQL (current behavior, fallback)

Node Update:
  1. dolt_pull('origin', 'main') → merge operator updates into local
  2. Conflicts: operator wins (or manual resolution)

Node Contribution:
  1. Agent writes knowledge + commits locally
  2. Promotion gate validates (outcome-backed, statistically significant)
  3. dolt_push('origin', 'contributions/{node_id}') → operator reviews
```

## Validation

```bash
pnpm dev:setup        # clones from remote when configured, seeds when not
pnpm dev:stack        # app starts with cloned knowledge
```

## Non-Goals

- Cross-node direct knowledge sharing (always goes through operator remote)
- Real-time sync (pull is explicit, not streaming)
- Dolt SQL server federation (single server per node)
