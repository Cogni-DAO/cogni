---
id: guide.create-service-review
type: guide
title: Create-Service Guide — Accuracy Review
status: draft
trust: draft
summary: Audit of docs/guides/create-service.md against the live repository state as of 2026-04-20. Flags drift between documented steps and actual scripts, configs, and reference implementations.
read_when: Before following create-service.md to add a new service, or when updating create-service.md.
owner: derekg1729
created: 2026-04-20
verified: 2026-04-20
tags: [docs, audit, services]
---

# Create-Service Guide — Accuracy Review

> Reviewed against tree at commit `1a27f7564` (main) on 2026-04-20. Spot-checked `services/scheduler-worker/` as the reference implementation.

## TLDR

`docs/guides/create-service.md` is **mostly accurate** but has **3 structural drifts** and **2 minor omissions** worth fixing before the next agent follows it. The Dockerfile section is out of date (uses a verbose per-package `COPY` pattern where the reference implementation now uses `COPY --parents`). The step-9a CI wiring claim overstates what's needed — `resolve-pr-build-images.sh` no longer has per-target cases.

## Scorecard

| Section                    | Claim                                                      | Reality                                                                 | Drift             |
| -------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------- | ----------------- |
| 1. Workspace Setup         | `services/*` in `pnpm-workspace.yaml`                      | ✅ present at line 15                                                   | none              |
| 2. TypeScript Config       | Service has standalone `tsconfig.json`, not extending root | ✅ `services/scheduler-worker/tsconfig.json` is standalone              | none              |
| 2. biome override          | "Add to `biome/base.json` noDefaultExport override"        | ✅ `biome/base.json` lines 141 + 164 both include `services/**/*.ts`    | none              |
| 2. tsup Model B            | `bundle: false`, format `esm`                              | ✅ matches `services/scheduler-worker/tsup.config.ts` exactly           | none              |
| 2. ESM `.js` imports rule  | Required when `bundle: false`                              | ✅ true                                                                 | none              |
| 4. Health endpoints        | Raw `node:http`, no framework                              | ✅ matches scheduler-worker                                             | none              |
| 4. `/livez` + `/readyz` contract | Liveness always 200, readiness 200/503                | ✅ matches                                                              | none              |
| 6. Dockerfile example      | Per-package `COPY packages/<dep>/` lines                   | ⚠️ reference uses `COPY --parents packages/*/package.json ./` syntax   | **stale example** |
| 6. Builder `RUN pnpm install` flags | `--frozen-lockfile --filter @cogni/<name>-service...` | ✅ matches                                                         | none              |
| 6. Runtime `USER worker` + 1001 | non-root, uid 1001                                    | ✅ matches                                                              | none              |
| 6. No HEALTHCHECK          | Forbidden in Dockerfile                                    | ✅ matches (scheduler-worker Dockerfile has none)                       | none              |
| 8. dep-cruiser rule        | Block `services/<name>/` → `src/`                          | ✅ enforced globally in `.dependency-cruiser.cjs`                       | none              |
| 8. arch probe              | `__arch_probes__/illegal-src-import.ts`                    | ✅ `services/scheduler-worker/__arch_probes__/illegal-src-import.ts`    | none              |
| 9a. `detect-affected.sh`   | Add `ALL_TARGETS` + case pattern                           | ✅ line 173: `services/scheduler-worker/*` → `add_target scheduler-worker` | none          |
| 9a. `build-and-push-images.sh` | `resolve_tag` + `build_target` cases                   | ✅ line 186+ has the scheduler-worker build command                     | none              |
| 9a. `resolve-pr-build-images.sh` | "Same `resolve_tag` case (must mirror the build script)" | ❌ **no per-target cases** — script iterates `ALL_TARGETS` and calls shared `image_tag_for_target` | **false instruction** |
| 9a. `build-multi-node.yml` | Add to dispatch fallback matrix                            | ✅ accurate but worded as "currently dispatched by hand" which matches  | none              |
| 9b. Catalog entry          | `infra/catalog/<name>.yaml` with `name/type/port/dockerfile` | ✅ matches `infra/catalog/scheduler-worker.yaml` exactly              | none              |
| 9b. k8s base               | `infra/k8s/base/<name>/`                                   | ✅ `infra/k8s/base/scheduler-worker/` exists                            | none              |
| 9b. Per-env ApplicationSet | Picks up catalog entry at runtime                          | ✅ true                                                                 | none              |
| 9b. `wait-for-argocd.sh`   | Add service to `APPS=(...)` when critical                  | ✅ true                                                                 | none              |
| 10. Production replicas    | "every app runs `replicas: 1`"                             | needs verification; fair warning either way                             | minor             |
| 11. `environments.md` doc  | Must update                                                | ⚠️ guide does not mention `services-architecture.md` table update as a must-do in step 11 body (it's in the bullet list; reader-miss risk) | minor cosmetic |
| Troubleshooting: pino `Dynamic require` | Caused by Model A bundling                    | ✅ correct root cause                                                   | none              |

## Structural drifts to fix in create-service.md

### 1. Dockerfile `COPY` example is pre-`--parents` syntax

**Location:** Step 6, the full Dockerfile code block.

**Claim:** Individual `COPY packages/<dep1>/package.json packages/<dep1>/` lines, one per package, explicitly enumerated.

**Reality:** `services/scheduler-worker/Dockerfile` now uses Docker Buildkit's `--parents` flag:

```dockerfile
# syntax=docker/dockerfile:1.7-labs
...
COPY --parents packages/*/package.json ./
COPY --parents nodes/*/app/package.json ./
COPY --parents nodes/*/packages/*/package.json ./
COPY --parents services/scheduler-worker/package.json ./
```

**Fix:** Replace the Step 6 Dockerfile example with the `--parents`-based form. Add the `# syntax=docker/dockerfile:1.7-labs` header note and a one-liner explaining that `--parents` is required for this syntax. Keep the per-package form as a fallback only if Buildkit isn't available (which it always is in this repo).

**Why it matters:** An agent copy-pasting the current example will produce a verbose, harder-to-maintain Dockerfile that diverges from the living reference. Next person to add a workspace package then has to update every service's Dockerfile by hand.

### 2. Step 9a overstates `resolve-pr-build-images.sh` work

**Location:** Step 9a, third bullet: "Add a digest resolver in `scripts/ci/resolve-pr-build-images.sh` — Same `resolve_tag` case (must mirror the build script)."

**Reality:** `resolve-pr-build-images.sh` lines 66-93 no longer branch per target. It iterates `ALL_TARGETS` and calls a shared helper `image_tag_for_target` (defined in `scripts/ci/_lib/` or similar). Adding a service to `ALL_TARGETS` in `detect-affected.sh` is sufficient; no edit to `resolve-pr-build-images.sh` is required.

**Fix:** Delete that bullet, or replace with: "No per-target edits required — the resolver iterates `ALL_TARGETS` and uses a shared tag helper."

**Why it matters:** Agents waste time adding a redundant case that isn't read, and may introduce dead code.

### 3. Reference to `resolve_tag case (must mirror the build script)` is brittle going forward

**Location:** Same bullet as #2.

**Reality:** Even in `build-and-push-images.sh` the `resolve_tag` convention is at risk of being collapsed into the shared helper. This is churn bait.

**Fix:** Instead of enumerating which scripts need edits, point to `scripts/ci/detect-affected.sh` `ALL_TARGETS` as the **single registration point** and note that the other scripts consume it. One source of truth = one edit for the next agent.

## Minor omissions

- **Step 4 worker readiness invariant** says readiness must gate the claim loop but doesn't show how. Linking out to a short example in `services/scheduler-worker/src/main.ts` would help. (This is a "read the reference" cost, small.)
- **Step 5 graceful shutdown** doesn't mention the timeout constant (`drainWithTimeout(30_000)`) being aligned with k8s `terminationGracePeriodSeconds`. A 30s Node-side drain against a 30s k8s grace means SIGKILL lands exactly when drain finishes. Bump the example to `25_000` or call out the coupling.

## Suggested follow-up work

- Open a small PR against `docs/guides/create-service.md` applying fixes #1–#3 above. (~30 lines of diff.)
- Add a `verified:` date stamp to the create-service.md frontmatter on each pass so readers know when it was last audited.
- Consider a test that grepes `resolve-pr-build-images.sh` for the literal string "case" under `resolve_tag()` and fails if someone reintroduces per-target branching — keeps the guide from drifting back.

## What is notably missing (scope-level)

The create-service guide correctly scopes itself to _services_ (no DAO, no scope fence, no governance charters) and points to `services-architecture.md`. If you are creating a **node** (DAO + wallet + charters + subdomain), that guide is insufficient — see [new-node-formation.md](./new-node-formation.md).

## Related

- [Create Service Guide](./create-service.md) — the guide under review
- [New Node Formation](./new-node-formation.md) — complementary guide for nodes
- [Services Architecture Spec](../spec/services-architecture.md) — service invariants
- [DevOps Expert Skill](../../.claude/skills/devops-expert/SKILL.md) — arsenal inventory used to cross-check this review
