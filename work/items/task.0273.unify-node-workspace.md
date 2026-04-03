---
id: task.0273
type: task
title: "Unify workspace: move operator to nodes/operator/app"
status: needs_implement
priority: 1
rank: 5
estimate: 3
summary: "Move apps/operator/ to nodes/operator/app/ so all node apps follow one directory convention. Enables single Dockerfile template, single CI matrix, uniform Argo CD targets."
outcome: "All node apps live under nodes/{name}/app/. One glob, one Dockerfile pattern, one deploy target shape. The deploy dev (Argo CD) gets uniform inputs."
spec_refs:
  - spec.node-app-shell
  - docs/spec/packages-architecture.md
assignees: derekg1729
credit:
project: proj.operator-plane
branch: feat/node-workspace-unify
pr:
reviewer:
revision: 1
blocked_by: []
deploy_verified: false
created: 2026-04-02
updated: 2026-04-02

labels: [refactor, architecture, nodes, infra]
external_refs:
---

# Unify workspace: move operator to nodes/operator/app

## Context

Operator is the only node app living outside `nodes/`. It sits at `apps/operator/` while all other nodes are at `nodes/{name}/app/`. This creates:

- Different `outputFileTracingRoot` paths in next.config.ts
- Different workspace globs in pnpm-workspace.yaml
- Different Docker build contexts and Dockerfile paths
- Different CI configuration
- A special case the deploy dev (Argo CD) must handle separately

Operator has only 8 unique files vs node-template (DAO setup flow + VCS adapter). Everything else is shared platform code. The "operator plane" is a role distinction, not a code structure distinction.

## Reference audit

`grep -rl "apps/operator"` finds references in 4 categories:

| Category                         | Count     | Action                                             |
| -------------------------------- | --------- | -------------------------------------------------- |
| Config/build (must fix)          | 24 files  | sed replace `apps/operator` → `nodes/operator/app` |
| Docs/specs (update refs)         | 19 files  | sed replace in prose                               |
| Work items/handoffs (historical) | 81 files  | Leave as-is — historical records                   |
| Tests (arch probes, lint)        | ~30 files | sed replace paths                                  |

## Plan

### 1. Move the directory

- [ ] `mkdir -p nodes/operator && git mv apps/operator nodes/operator/app`
- [ ] Create `nodes/operator/.cogni/repo-spec.yaml` (copy from node-template, update node identity)

### 2. Fix operator-internal paths

- [ ] `nodes/operator/app/next.config.ts`: `outputFileTracingRoot` `"../../"` → `"../../../"`
- [ ] `nodes/operator/app/Dockerfile`: COPY/WORKDIR paths (monorepo root offset changes)
- [ ] `nodes/operator/app/package.json`: verify name field resolves

### 3. Workspace + TypeScript wiring (24 files)

- [ ] `pnpm-workspace.yaml`: remove `apps/*` glob
- [ ] `tsconfig.json`: update references path
- [ ] `tsconfig.base.json`: `@/*` paths `apps/operator/src/*` → `nodes/operator/app/src/*`
- [ ] `drizzle.config.ts`: schema path
- [ ] `vitest.workspace.ts`: operator include pattern
- [ ] `package.json` (root): workspace scripts referencing operator

### 4. Lint + arch enforcement (12 files)

- [ ] `.dependency-cruiser.cjs`: all operator path patterns
- [ ] `biome.json`, `biome/app.json`, `biome/base.json`: operator overrides
- [ ] `eslint.config.mjs`, `eslint/chain-governance.config.mjs`, `eslint/ui-governance.config.mjs`
- [ ] `tests/arch/*.spec.ts`: operator path in test subjects (~12 files)
- [ ] `tests/lint/**/*.spec.ts`: operator path in lint subjects (~14 files)

### 5. Docker + CI + scripts (8 files)

- [ ] `.github/workflows/ci.yaml`: build context, filter paths
- [ ] `infra/compose/runtime/docker-compose.yml`: app service build context
- [ ] `infra/compose/runtime/docker-compose.dev.yml`: app service build context
- [ ] `infra/catalog/operator.yaml`: path references
- [ ] `scripts/check-all.sh`, `scripts/check-fast.sh`, `scripts/ci/build.sh`, `scripts/ci/compute_migrator_fingerprint.sh`
- [ ] `scripts/check-root-layout.ts`

### 6. Docs (19 files — update live references only)

- [ ] `CLAUDE.md`
- [ ] `docs/spec/architecture.md`, `docs/spec/node-app-shell.md`, `docs/spec/build-architecture.md`
- [ ] `docs/guides/multi-node-dev.md`, `docs/guides/full-stack-testing.md`
- [ ] Other specs with `apps/operator` references (~13 files)
- [ ] Create `nodes/operator/AGENTS.md`
- [ ] Remove empty `apps/` directory or keep for future non-node apps

### 7. Validate

- [ ] `pnpm install`
- [ ] `pnpm packages:build`
- [ ] `pnpm check:fast`
- [ ] `pnpm --filter operator build`
- [ ] `pnpm check:docs`

### 8. Post-merge

- [ ] Notify Argo CD dev: operator deploy target path changed
- [ ] Verify `pnpm dev` still works (operator on port 3000)

## Validation

```bash
pnpm install
pnpm packages:build
pnpm check:fast
pnpm --filter operator build
pnpm check:docs
```

## Notes

- This subsumes task.0248 Phase 4 (workspace restructure). The original Phase 4 planned `nodes/*/app/` → `nodes/*/apps/web/` rename — that's deferred; current `app/` convention is fine for deploy.
- Adapter drift between operator and node-template is from parallel development, not intentional. Will naturally collapse as nodes share more code.
- The `apps/` directory may still be needed for future non-node apps (marketing site, docs site). If so, keep the glob but leave it empty for now.
