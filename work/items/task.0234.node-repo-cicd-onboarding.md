---
id: task.0234
type: task
title: "Design: node repo creation + CI/CD onboarding pipeline"
status: needs_design
priority: 1
rank: 4
estimate: 5
summary: "Automate the git lifecycle for new nodes: create repo from template (GitHub API), configure CI/CD, wire subdomain to deployment, register node with operator. Decide submodule vs fork vs GitHub template strategy."
outcome: "create-node wizard creates a GitHub repo, configures CI secrets, triggers first deploy, and the node is accessible at its subdomain. Operator repo tracks the node via repo-spec or registry."
spec_refs: node-launch-spec, node-ci-cd-contract-spec, node-operator-contract-spec
assignees: derekg1729
credit:
project: proj.node-formation-ui
branch:
pr:
reviewer:
revision: 0
blocked_by: task.0233
deploy_verified: false
created: 2026-03-30
updated: 2026-03-30
labels: [infra, cicd, git, node-formation]
external_refs:
  - https://github.com/Cogni-DAO/cogni-resy-helper/pull/11
---

# Design: Node Repo Creation + CI/CD Onboarding Pipeline

## Context

After task.0232 creates DNS and task.0233 defines the node-template boundary, we need the git plumbing: creating the actual repo, wiring CI/CD, and connecting it to the operator.

### Key decision: how does a node repo relate to the operator?

| Strategy                          | Pros                                              | Cons                                                   |
| --------------------------------- | ------------------------------------------------- | ------------------------------------------------------ |
| **GitHub Template repo**          | Clean fork, independent history, GitHub-native    | Fork-sync is manual, drift accumulates                 |
| **Git submodule**                 | Shared code stays in sync, operator can reference | Complex git workflow, submodule UX is painful          |
| **Monorepo with scoped apps**     | Single repo, shared CI, no sync problem           | All nodes share one repo — permission/isolation issues |
| **GitHub fork + upstream remote** | Can pull upstream changes, independent commits    | Fork network visible, PR noise, not a template         |

Reference: cogni-resy-helper (PR #11) is a real child node — study its structure.

## Design Questions (needs_design)

### Repo Creation

- [ ] GitHub Template vs fork vs `gh repo create --clone`?
- [ ] What secrets does the new repo need? (CLOUDFLARE*\*, DB creds, PRIVY*\*, INTERNAL_OPS_TOKEN)
- [ ] How are secrets provisioned? (GitHub API `PUT /repos/{owner}/{repo}/actions/secrets`)
- [ ] Who owns the repo? Cogni-DAO org? Founder's org?

### CI/CD for the Node

- [ ] Does each node get its own GitHub Actions workflows? Or does operator CI manage all nodes?
- [ ] Preview deploys: PR → subdomain (e.g., `pr-42.resy-helper.nodes.cognidao.org`) — uses dns-ops
- [ ] Production deploy: merge to main → deploy to node's namespace
- [ ] How does the node's CI know its subdomain/namespace? (repo-spec.yaml)

### Operator ↔ Node Relationship

- [ ] How does the operator discover/track node repos? Options:
  - Node registry DB table (`operator_node_registrations`)
  - GitHub org scan (all repos with `.cogni/repo-spec.yaml`)
  - Explicit enrollment API (`POST /api/federation/enroll`)
- [ ] Does operator need write access to node repos? (for git-review-daemon, automated PRs)
- [ ] How does operator push template updates to nodes? (Dependabot-style PRs? Manual?)

### Scope Spaces

- [ ] Each node gets a `scope_key` in repo-spec — this is its identity in the ledger
- [ ] Activity sources in repo-spec point to the node's own repo
- [ ] Attribution pipeline scoped per node (no cross-node leakage)

## Requirements

- [ ] Decision doc: repo creation strategy (template vs fork vs monorepo)
- [ ] Automated repo creation script/API (GitHub API)
- [ ] CI/CD template for node repos (GitHub Actions workflows)
- [ ] Secret provisioning automation
- [ ] Operator node registry updated on repo creation
- [ ] Preview deploy DNS automation (dns-ops integration with CI)

## Allowed Changes

- `packages/dns-ops/` — CI integration helpers
- `scripts/` — create-node-repo automation
- `infra/cd/` — node CI/CD templates
- `.github/workflows/` — template workflows for node repos
- `docs/spec/node-ci-cd-contract.md` — updates for multi-node
- `work/items/task.0234.*` — this file

## Plan

- [ ] Step 1: Study cogni-resy-helper structure — what works, what's missing
- [ ] Step 2: Decide repo creation strategy (ADR)
- [ ] Step 3: Build `create-node-repo.ts` script (GitHub API: create from template, set secrets)
- [ ] Step 4: Create CI/CD workflow template for node repos
- [ ] Step 5: Wire preview deploy DNS into node CI (dns-ops upsert/remove on PR open/close)
- [ ] Step 6: Test full flow: create-node → create-repo → first deploy → subdomain live
- [ ] Step 7: Register node in operator (DB or repo-spec update)

## Validation

**Expected:** `create-node.ts <slug>` → DNS live + repo created + CI configured + first deploy triggered. Founder visits `<slug>.nodes.cognidao.org` and sees their app.

## Review Checklist

- [ ] **Work Item:** `task.0234` linked in PR body
- [ ] **Spec:** NODE_OWNS_REPO — node repo is sovereign, operator has read access only (unless explicitly granted)
- [ ] **Spec:** FORK_FREEDOM — node can disconnect from operator and keep running
- [ ] **Security:** Secrets provisioned via API, never in repo, never in logs

## PR / Links

- Depends on: task.0233 (node-template boundary), task.0232 (dns-ops)
- Blocks: task.0202 Activity 2 (createRepoFromTemplate)
- Reference: https://github.com/Cogni-DAO/cogni-resy-helper/pull/11

## Attribution

-
