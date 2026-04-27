---
id: spec.node-ci-cd-contract
type: spec
title: Node CI/CD Contract
status: active
trust: reviewed
summary: CI/CD sovereignty invariants, merge gate checks, workflow entrypoints, and file ownership classification
read_when: Modifying CI workflows, adding checks to merge gate, or planning multi-node CI extraction
implements: []
owner: cogni-dev
created: 2025-12-22
verified: 2026-04-27
tags:
  - ci-cd
  - deployment
---

# Node CI/CD Contract

## Context

Node sovereignty is non-negotiable. CI must run from repo with zero operator dependencies. This spec defines what checks are required, which files are node-owned vs rails-eligible, and the ownership split between orchestration and policy.

## Goal

Define the CI/CD invariants, merge gate, and file ownership boundaries that ensure every node can run its full pipeline independently.

## Non-Goals

- Reusable workflow extraction (see [proj.ci-cd-reusable](../../work/projects/proj.ci-cd-reusable.md))
- Jenkins migration (gated on Dolt CI/CD requirements)

---

## Core Invariants

1. **FORK_FREEDOM**: CI runs without secrets; CD (build/deploy) is gated and skippable on forks.

2. **POLICY_STAYS_LOCAL**: ESLint/depcruise/prettier/tsconfig never centralized.

3. **LOCAL_GATE_PARITY**: `pnpm check` runs same assertions as CI, different execution (sequential vs parallel).

4. **NO_RUNTIME_FETCHES**: Workflows never fetch config from outside repo.

5. **SCRIPTS_ARE_THE_API**: Workflows orchestrate by calling named pnpm scripts; no inline command duplication. Targets logic _duplicated across ≥2 workflows_ — that must live in `scripts/` to prevent drift. Gate-specific inline policy that is small, unique to one workflow, and pinned by a meta-test is allowed; the `single-node-scope` job in `ci.yaml` is the canonical example.

6. **BUILD_ONCE_PROMOTE_DIGEST**: Images build on canary. Staging and production deploy the exact same digests. No per-environment rebuilds.

7. **SINGLE_RESPONSIBILITY**: Each workflow file owns one concern (build, promote+deploy, E2E+release). No monoliths.

8. **SINGLE_DOMAIN_HARD_FAIL**: PRs may touch exactly one node's domain. Each non-operator node owns `nodes/<X>/`; the operator node owns `nodes/operator/` plus everything else in the repo (infra, packages, .github, docs, work, scripts, root configs) as one domain. Cross-domain PRs are rejected by the `single-node-scope` job in `ci.yaml`. Bounded ride-along whitelist: `pnpm-lock.yaml` (mechanical side-effect of node-level `package.json` changes) and `work/items/**` (per-task work items; ride-along until task tracking moves to Dolt) may ride a single non-operator node PR. See `## Single-Domain Scope` below.

---

## Single-Domain Scope

Every path in the repo belongs to **exactly one node domain**. A PR may touch exactly one domain. This invariant is enforced statically by the `single-node-scope` job in `ci.yaml` (task.0381) and routed at runtime by the operator's reviewer via `extractOwningNode` in `@cogni/repo-spec` (task.0382). Both implementations consume the same set of fixtures and must agree.

### Domains

```
4 disjoint domains. PR scope = exactly 1 column.

  ┌─────────────────────────────────────────────────────────────┐
  │  poly         resy         node-template       operator     │
  │  ────         ────         ─────────────       ────────     │
  │  nodes/poly/  nodes/resy/  nodes/node-tmpl/    nodes/opr/   │
  │                                                  ∪          │
  │                                                EVERYTHING   │
  │                                                ELSE         │
  │                                                (packages/,  │
  │                                                 infra/,     │
  │                                                 .github/,   │
  │                                                 docs/, …)   │
  └─────────────────────────────────────────────────────────────┘
```

The operator node's domain is broader because the operator IS the control plane — it owns the substrate every other node consumes. But it is still **one** domain, not an exemption.

### Rule

```
domain(path) = X         if path matches  nodes/<X>/**  for X ∈ {poly, resy, node-template}
             = operator   otherwise   (i.e., nodes/operator/** OR anywhere outside nodes/)

PR passes iff |distinct domains touched| ≤ 1, with the bounded ride-along whitelist below.
```

The set of non-operator domains is derived from the `nodes/*` directory listing minus `operator` — meta-tested in `tests/ci-invariants/single-node-scope-meta.spec.ts`. The repo-spec `nodes` registry must mirror the same set (enforced at the resolver boundary; meta-test asserts both directions). Adding `nodes/<X>/` requires updating the workflow filter list AND the registry — both meta-tests fire until they agree.

The dorny step must set `predicate-quantifier: 'every'` so the operator filter's `**` + `!nodes/<X>/**` negations actually subtract; under the default `some` quantifier the rules are OR'd and the negations are dead, which silently misclassifies every non-operator-node-only PR as that node + operator. Pinned by `single-node-scope-meta.spec.ts`.

### Ride-along exceptions

If `|S| = 2`, `operator ∈ S`, and **every** path matched by the operator filter is in the ride-along whitelist, the operator paths inherit the other domain and the PR passes.

Whitelist (must mirror `RIDE_ALONG_PATTERNS` in `tests/ci-invariants/classify.ts` and the inline `run:` block in `ci.yaml#single-node-scope`):

| Pattern          | Why                                                                                  | Long-term fix                                                             |
| ---------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| `pnpm-lock.yaml` | Mechanical side-effect of node-level `package.json` intent — not intent itself.      | Per-node lockfiles via pnpm `shared-workspace-lockfile=false`.            |
| `work/items/**`  | Per-task work items + auto-regenerated `_index.md`; high merge-conflict churn today. | Move task tracking to Dolt; `work/items/` empties out and exits the list. |

Each entry has an explicit long-term fix that ends the ride-along. The whitelist is a v0 unblock, not a permanent carve-out — adding to it weakens the gate, so do so deliberately and pair the addition with the exit plan that drains the entry.

**Operator paths NOT in the whitelist (specs, .github, packages, infra, scripts, root configs) do not ride along.** They are intent. A `poly` PR that needs an operator-spec change is two PRs, not one — that's the design.

### Why Reading A (operator-is-a-domain) over Reading B (operator-is-an-exemption)

The early flood of "node X needs operator change Y" PRs is the **substrate-request signal**, not noise. Each rejection by the gate is a row in operator's prioritization queue ("which seams are load-bearing? which need first-class APIs?"). Weakening the gate to absorb the friction loses that signal — operator never learns which substrates contributors actually push on. Same framing as the noisy-neighbor / attribution thesis: the boundary is where the test happens, not where the test is suppressed.

Sovereignty contracts only hold when the false-positive cost is accepted. Carving "reasonable exceptions" for the common case is the standard failure mode — within a year the boundary is theater. The ride-along whitelist is bounded specifically because each entry covers mechanical side-effects or transitional storage that is migrating out (work items → Dolt), not intent that belongs in operator's domain.

### Rejected — Reading B (operator-is-an-exemption)

`nodes/operator/**` and `packages/**`, `.github/**`, etc. classify as "infra" that rides along any single sovereign node. Rejected because **operator paths are intent, not side-effect; intent doesn't ride along.** A `poly` PR that needs an operator change is two PRs, not one — that's the design.

### Diagnostic contract — when the gate fires

Cross-domain rejections must do half the contributor's work in the failure annotation:

1. **Name the conflicting domains** explicitly (e.g., `poly + operator`, not just "scope error").
2. **Name the operator-territory paths** that triggered the operator domain match, when operator is one of the conflicting domains. The contributor needs to know which file they touched is "operator's intent."
3. **Suggest the split**: "file an operator PR with `<paths>` first; rebase your `<other-domain>` PR on it."
4. **Link the substrate-request convention** so the rejected change becomes a roadmap input rather than dropped friction. (Convention TBD; until it lands, link this spec section.)

Each gate firing is a feedback loop, not a barrier. Future: rejections logged structurally (Loki, work-item, attribution surface) so operator's roadmap-building agent reads the queue.

---

## Design

### Merge Gate (Required for PR Merge)

| Check                                  | Local            | CI                    |
| -------------------------------------- | ---------------- | --------------------- |
| `pnpm typecheck`                       | yes              | static job            |
| `pnpm lint`                            | yes              | static job            |
| `pnpm format:check`                    | yes              | unit job              |
| `pnpm test:ci` (unit/contract/meta)    | yes              | unit job              |
| `pnpm arch:check`                      | yes              | unit job              |
| `pnpm test:component`                  | yes              | component job         |
| `pnpm test:stack:docker`               | no (needs infra) | stack-test job        |
| **SINGLE_DOMAIN_HARD_FAIL** (PR scope) | no               | single-node-scope job |

**Optional** (not blocking): coverage upload, SonarCloud scan.

### Workflow Entrypoints

| File                     | Type | Secrets            | Trigger                                  | Concern                                           |
| ------------------------ | ---- | ------------------ | ---------------------------------------- | ------------------------------------------------- |
| `ci.yaml`                | CI   | No                 | PR; push canary/staging/main             | typecheck, lint, unit, component, stack-test      |
| `build-multi-node.yml`   | CD   | Yes (GHCR)         | push canary                              | Build + push images                               |
| `promote-and-deploy.yml` | CD   | Yes (SSH, secrets) | workflow_run on build; workflow_dispatch | Promote overlays + deploy infra + verify          |
| `e2e.yml`                | CD   | Yes (PAT)          | workflow_run on promote-and-deploy       | E2E smoke + canary→staging promotion + release PR |
| `build-prod.yml`         | CD   | Yes (GHCR)         | push main                                | Build production images (legacy)                  |
| `deploy-production.yml`  | CD   | Yes (SSH, secrets) | workflow_run on build-prod               | Deploy to production (legacy)                     |

### Local Gates

| Command               | Script                        | Purpose                                                                  |
| --------------------- | ----------------------------- | ------------------------------------------------------------------------ |
| `pnpm check:fast`     | `scripts/check-fast.sh`       | Strict iteration gate (pre-push): verify-only, fails on any drift        |
| `pnpm check:fast:fix` | `scripts/check-fast.sh --fix` | Auto-fix variant: rewrites lint/format, fails if drift persists          |
| `pnpm check`          | `scripts/check-all.sh`        | Pre-commit gate: typecheck + lint + format + unit/contract + docs + arch |
| `pnpm check:full`     | `scripts/check-full.sh`       | CI parity: Docker build + stack + all test suites (~20 min)              |

### File Ownership Classification

**Node-Owned (Never Centralize):**

| Path                           | Why                         |
| ------------------------------ | --------------------------- |
| `.dependency-cruiser.cjs`      | Hex architecture boundaries |
| `eslint.config.mjs`, `eslint/` | UI/chain governance rules   |
| `biome.json`, `biome/`         | Lint rules                  |
| `.prettierrc`                  | Formatting                  |
| `tsconfig*.json`               | Path aliases                |
| `scripts/check-*.sh`           | Local gate definitions      |
| `nodes/*/app/Dockerfile`       | Image definition            |

**Rails-Eligible (future extraction candidates):**

| Path                                 | Purpose               |
| ------------------------------------ | --------------------- |
| `.github/actions/loki-ci-telemetry/` | CI telemetry capture  |
| `.github/actions/loki-push/`         | Loki push             |
| `scripts/ci/build.sh`                | Docker build          |
| `scripts/ci/push.sh`                 | GHCR push             |
| `scripts/ci/test-image.sh`           | Image liveness test   |
| `scripts/ci/promote-k8s-image.sh`    | Overlay digest update |
| `scripts/ci/deploy-infra.sh`         | Compose infra deploy  |

**Ownership split:** Nodes own scripts and policy configs. Kit owns invocation conventions (when to call, how to parallelize, what to cache).

### Key Decisions

#### 1. Why Canary-First

Canary replaces staging as the primary integration branch. Benefits: multi-node testing from day one, k8s/Argo deployment model, build-once-promote-digest. Staging receives promoted digests, not fresh builds.

#### 2. Why In-Repo Seam First

Extracting to external repo too early causes version pinning overhead, false abstraction boundaries, and reduced iteration speed.

#### 3. Why Policy Stays Node-Owned

Centralizing lint/depcruise configs causes fork friction, policy fights, and loss of sovereignty. Rails kit provides orchestration defaults, not policy mandates.

### File Pointers

| File                                       | Purpose                                                                               |
| ------------------------------------------ | ------------------------------------------------------------------------------------- |
| `.github/workflows/ci.yaml`                | CI entrypoint                                                                         |
| `.github/workflows/build-multi-node.yml`   | Image build                                                                           |
| `.github/workflows/promote-and-deploy.yml` | Promote + deploy + verify                                                             |
| `.github/workflows/e2e.yml`                | E2E + promotion chain                                                                 |
| `scripts/check-fast.sh`                    | `pnpm check:fast` implementation                                                      |
| `scripts/check-all.sh`                     | `pnpm check` implementation                                                           |
| `scripts/check-full.sh`                    | `pnpm check:full` implementation                                                      |
| `tests/ci-invariants/`                     | Static pins on workflow shape, action SHA-pins, single-node-scope classifier fixtures |

## Acceptance Checks

**Automated:**

- `pnpm check` — local gate parity with CI
- Fork PRs pass CI without secrets

**Manual:**

1. Verify `ci.yaml` calls only pnpm scripts (no inline commands)
2. Verify CD workflows skip gracefully when secrets are missing (fork mode)
3. Verify canary E2E success triggers staging promotion without manual intervention

## Related

- [ci-cd.md](./ci-cd.md) — CI/CD pipeline specification
- [check-full.md](./check-full.md) — check:full CI-parity gate
- [Project: Reusable CI/CD Rails](../../work/projects/proj.ci-cd-reusable.md)
