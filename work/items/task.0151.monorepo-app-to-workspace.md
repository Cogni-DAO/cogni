---
id: task.0151
type: task
title: "Monorepo re-architecture: app to apps/operator, platform/ to infra/ + scripts/"
status: done
priority: 0
rank: 1
estimate: 5
summary: Move the Next.js app from root into apps/operator/ workspace, split root tests/config into app-specific vs cross-workspace, and flatten platform/ into infra/ + scripts/
outcome: Every deployable is a proper workspace member; pnpm --filter operator works; infra config is ≤2 levels deep; pnpm check and pnpm check:full pass
spec_refs: architecture-spec, build-architecture, services-architecture
assignees: derekg1729
credit:
project: proj.cicd-services-gitops
branch: feat/gitops-foundation
pr: https://github.com/Cogni-DAO/node-template/pull/547
reviewer:
revision: 3
blocked_by:
deploy_verified: false
created: 2026-03-10
updated: 2026-03-12
labels: [architecture, monorepo, infra]
external_refs:
---

# Monorepo Re-Architecture

## Context

The Next.js app squats at root — `src/`, `tests/`, `e2e/`, root `Dockerfile`, root configs. Every other workspace member (`packages/*`, `services/*`) is a proper subdirectory citizen, but the app is "special." This prevents `pnpm --filter` targeting, graph-scoped builds, and blocks future `apps/operator/` addition.

Additionally, `platform/` is over-nested (3 levels to a compose file) and mixes unrelated concerns: CI scripts, bootstrap, OpenTofu IaC, docker-compose files, and runbooks.

## Requirements

- `apps/operator/` exists as a pnpm workspace member with `name: "web"` in its `package.json`
- `pnpm --filter operator build` works and produces the Next.js standalone output
- `pnpm --filter operator test` runs app-specific tests
- App-specific source, tests, configs, and Dockerfile live under `apps/operator/`
- Cross-workspace tests (`arch/`, `lint/`, `contract/`, `ports/`, `packages/`, `_fakes/`, `_fixtures/`, `helpers/`) remain at root `tests/`
- `e2e/` remains at root (tests the deployed stack, not one app)
- `infra/` replaces `platform/infra/` — max 2 levels to any deployment config
- `scripts/` replaces `platform/ci/scripts/` and `platform/bootstrap/`
- `docs/runbooks/` absorbs `platform/runbooks/`
- `platform/` is fully deleted
- `pnpm check` passes
- `pnpm check:full` passes
- All CI workflows (`.github/workflows/`) reference correct paths
- All AGENTS.md files updated for new paths

## Allowed Changes

- `apps/` — new directory, web workspace
- `infra/` — new directory, replaces platform/infra/
- `scripts/` — absorbs platform/ci/scripts/ and platform/bootstrap/
- `src/` — moved to apps/operator/src/
- `tests/` — split: app-specific dirs move to apps/operator/tests/, cross-workspace dirs stay
- `e2e/` — stays at root, path refs updated
- `platform/` — deleted entirely
- `docs/runbooks/` — absorbs platform/runbooks/ content
- Root config files — app-specific ones move to apps/operator/
- `pnpm-workspace.yaml` — add `apps/*`
- `package.json` — split deps: app-specific to apps/operator, workspace-level stays at root
- `.github/workflows/` — path updates only
- `.dependency-cruiser.cjs` — path updates for apps/operator/src/
- `tsconfig.json`, `tsconfig.base.json` — add apps/operator project reference, update aliases
- `vitest.workspace.ts` — add apps/operator config discovery
- All `AGENTS.md` files — path updates
- `Dockerfile` — moved to apps/operator/Dockerfile, build context adjusted
- Docker compose files — path updates for new locations
- `biome.json`, `eslint.config.mjs` — scope updates for apps/operator/

## Classification Reference

### Root configs: app-specific → move to apps/operator/

| File                          | Reason                                                  |
| ----------------------------- | ------------------------------------------------------- |
| `next.config.ts`              | Next.js build config                                    |
| `tsconfig.app.json`           | Next.js TS config (includes src/\*_/_.tsx, next plugin) |
| `next-env.d.ts`               | Next.js auto-generated types                            |
| `postcss.config.mjs`          | Tailwind CSS pipeline                                   |
| `components.json`             | shadcn/ui config                                        |
| `vitest.component.config.mts` | Component tests (testcontainers, app adapters)          |
| `vitest.stack.config.mts`     | Stack tests (HTTP routes, running server)               |
| `vitest.external.config.mts`  | External API tests                                      |
| `knip.json`                   | Dead code analysis (scans src/)                         |
| `Dockerfile`                  | App container build                                     |

### Root configs: cross-workspace → stay at root

`pnpm-workspace.yaml`, `package.json` (workspace scripts/deps), `tsconfig.json`, `tsconfig.base.json`, `tsconfig.eslint.json`, `tsconfig.scripts.json`, `vitest.config.mts`, `vitest.workspace.ts`, `biome.json`, `eslint.config.mjs`, `.prettierrc`, `.prettierignore`, `commitlint.config.cjs`, `.dependency-cruiser.cjs`, `drizzle.config.ts`, `playwright.config.ts` (e2e/ stays at root — config belongs with its test dir), `.editorconfig`, `.gitignore`, `sonar-project.properties`

### Tests: app-specific → move to apps/operator/tests/

| Dir                | Reason                                            |
| ------------------ | ------------------------------------------------- |
| `tests/unit/`      | Imports `@/core`, `@/features` (app domain logic) |
| `tests/component/` | Tests app adapters with testcontainers            |
| `tests/stack/`     | Tests app HTTP routes against running server      |
| `tests/external/`  | Tests app integration with external APIs          |
| `tests/meta/`      | App policy enforcement (e.g. public route checks) |

### Tests: cross-workspace → stay at root tests/

| Dir                | Reason                                                         |
| ------------------ | -------------------------------------------------------------- |
| `tests/arch/`      | Dependency graph validation across entire codebase             |
| `tests/lint/`      | Architecture boundary enforcement (src/, packages/, services/) |
| `tests/packages/`  | Package integration tests                                      |
| `tests/_fakes/`    | Shared test utilities                                          |
| `tests/_fixtures/` | Shared test data                                               |
| `tests/helpers/`   | Shared test helpers                                            |

**Reclassified as app-specific** (import `@/` app code):

| Dir               | Original classification | Actual                                       |
| ----------------- | ----------------------- | -------------------------------------------- |
| `tests/contract/` | Cross-workspace         | Imports `@/` facades/adapters → app-specific |
| `tests/ports/`    | Cross-workspace         | Imports `@/ports`, `@/shared` → app-specific |

**Tech debt:** `stack/` and `external/` tests conceptually test the full running system but import `@/` app code for test utilities. Future cleanup: extract shared test helpers to root `tests/helpers/`, move contracts to `packages/`, then stack/external can move back to root. See proj.cicd-services-gitops.

## Plan

### Checkpoint 1: Move app to apps/operator/

- [ ] Create `apps/operator/package.json` with `name: "web"` — move app-specific deps (next, react, tailwind, nextauth, @radix-ui/\*, @assistant-ui/\*, wagmi, viem, etc.) from root
- [ ] Update `pnpm-workspace.yaml`: add `apps/*` to workspace list
- [ ] `git mv src/ apps/operator/src/`
- [ ] `git mv public/ apps/operator/public/`
- [ ] `git mv Dockerfile apps/operator/Dockerfile` — update build context, COPY paths
- [ ] Move app-specific configs to `apps/operator/`: `next.config.ts`, `tsconfig.app.json`, `next-env.d.ts`, `postcss.config.mjs`, `components.json`, `knip.json`
- [ ] Move app-specific vitest configs: `vitest.component.config.mts`, `vitest.stack.config.mts`, `vitest.external.config.mts`
- [ ] Move app-specific test dirs: `tests/unit/` → `apps/operator/tests/unit/`, same for `component/`, `stack/`, `external/`, `meta/`
- [ ] Update `tsconfig.base.json` path aliases: `@/*` → `apps/operator/src/*`, etc.
- [ ] Add `apps/operator/tsconfig.json` extending root base, include `src/**/*`
- [ ] Update root `tsconfig.json` project references: add `apps/operator`
- [ ] Update `vitest.workspace.ts` to discover `apps/operator/vitest.*.config.mts`
- [ ] Update `.dependency-cruiser.cjs` paths: `src/` → `apps/operator/src/`
- [ ] Update `eslint.config.mjs` and `biome.json` scopes for `apps/operator/`
- [ ] Update root `package.json` scripts: `dev`, `build`, `start` → delegate to `pnpm --filter operator`
- [ ] Update all `.github/workflows/*.yml` paths (Dockerfile path, src/ references, test commands)
- [ ] Update all docker-compose files referencing root Dockerfile or src/
- [ ] Update `drizzle.config.ts` migration output path
- [ ] Run `pnpm install` to rebuild lockfile with new workspace topology
- [ ] `pnpm check` — fix all lint/type/format errors from path changes
- [ ] Verify `pnpm --filter operator build` produces standalone output

### Checkpoint 2: Flatten platform/ → infra/ + scripts/

- [ ] `mkdir -p infra/tofu/cherry infra/tofu/akash infra/compose infra/cd scripts/ci scripts/bootstrap`
- [ ] `git mv platform/infra/providers/cherry/* infra/tofu/cherry/` (preserve provider split)
- [ ] `git mv platform/infra/providers/akash/* infra/tofu/akash/` (if exists)
- [ ] `git mv platform/infra/services/runtime/* infra/compose/runtime/` (docker-compose.dev.yml, docker-compose.yml, configs/, postgres-init/)
- [ ] `git mv platform/infra/services/edge/docker-compose.yml infra/compose/edge/docker-compose.yml`
- [ ] `git mv platform/infra/services/sandbox-proxy/* infra/compose/` (if exists)
- [ ] `git mv platform/ci/scripts/* scripts/ci/`
- [ ] `git mv platform/bootstrap/* scripts/bootstrap/`
- [ ] `git mv platform/runbooks/* docs/runbooks/`
- [ ] `git mv platform/infra/files/scripts/* scripts/` (wait-for-health.sh, etc.)
- [ ] Delete `platform/` entirely
- [ ] Update all `.github/workflows/*.yml` referencing `platform/ci/scripts/` → `scripts/ci/`
- [ ] Update all docker-compose `-f` flags referencing `platform/infra/services/` → `infra/compose/`
- [ ] Update `package.json` scripts referencing platform/ paths
- [ ] Update OpenTofu state/config if paths are baked into state files
- [ ] Update all AGENTS.md files referencing platform/ paths
- [ ] Update `docs/spec/architecture.md` directory listing
- [ ] `pnpm check` passes

**Target infra/ structure:**

```
infra/
├── tofu/           # IaC — VM provisioning (OpenTofu)
│   ├── cherry/     # Cherry Servers provider
│   └── akash/      # Akash provider (future)
├── compose/        # Docker Compose stacks (dev, runtime, edge)
└── cd/             # Kustomize bases + overlays (future, task.0148 target)
```

**Note:** `infra/cd/` is an empty placeholder — task.0148 (in cogni-template-gitops) will populate it with Kustomize manifests. CI scripts (`scripts/ci/`) and CD manifests (`infra/cd/`) are peer concerns grouped under their respective trees: scripts for build-time tooling, infra for deployment-time config.

### Checkpoint 3: Final validation

- [ ] `pnpm check:full` passes (full CI-parity: Docker build + stack launch + all test suites)
- [ ] `pnpm --filter operator build` succeeds
- [ ] `pnpm --filter operator test` runs app-specific tests only
- [ ] `pnpm test` at root runs cross-workspace tests
- [ ] `pnpm dev:stack` starts dev server + infrastructure
- [ ] All AGENTS.md files reference correct paths (`pnpm check:docs`)
- [ ] Root `tests/` contains only cross-workspace dirs: `arch/`, `lint/`, `packages/`, `_fakes/`, `_fixtures/`, `helpers/`
- [ ] `apps/operator/tests/` contains app-specific dirs: `unit/`, `component/`, `stack/`, `external/`, `meta/`, `contract/`, `ports/`
- [ ] No file references `platform/` anywhere in the codebase

## Validation

**Checkpoint 1 gate:**

```bash
pnpm check
pnpm --filter operator build
pnpm --filter operator test
```

**Checkpoint 2 gate:**

```bash
pnpm check
grep -r 'platform/' .github/workflows/ scripts/ infra/ apps/ packages/ services/ docs/ --include='*.yml' --include='*.yaml' --include='*.ts' --include='*.mts' --include='*.sh' --include='*.md' | grep -v node_modules | grep -v '.git/'
# Expected: no matches
```

**Final gate:**

```bash
pnpm check:full
```

**Expected:** All commands pass with zero errors.

## Review Checklist

- [ ] **Work Item:** `task.0151` linked in PR body
- [ ] **Spec:** architecture-spec directory listing updated for new structure
- [ ] **Tests:** All existing tests pass from new locations; no test coverage regression
- [ ] **Reviewer:** assigned and approved
- [ ] **CI:** All GitHub Actions workflows pass on the PR branch

## Review Feedback

### R1 — Checkpoint 1 Review (2026-03-10)

**Blocking (fixed in 3ef92e8c):**

1. ~~`biome/app.json`: `noRestrictedImports` client guard dropped~~ — Fixed
2. ~~`scripts/ci/AGENTS.md` and `scripts/bootstrap/AGENTS.md` layer mismatch~~ — Fixed (`layer: "scripts"`)

**Non-blocking (Checkpoint 3 scope):**

- `tsconfig.base.json` `@tests/*` alias points to root `tests/*` — incorrect for app tests importing `@tests/_fakes` (now at `apps/operator/tests/_fakes`). Vitest runtime alias papers over this.
- Root `tests/setup.ts` imports `@/instrumentation` (app code) — pre-existing, consider extracting to shared test utility.
- Root deps (`cron-parser`, `pino`, `postgres`, `prom-client`) may be unnecessary at root.
- ~30+ AGENTS.md files under `apps/operator/` have broken relative links.

### R2 — Checkpoint 2 Review (2026-03-10)

**Blocking (must fix):**

1. **Docker compose `context:` off-by-one** — Compose files moved from 4 levels deep (`platform/infra/services/runtime/`) to 3 levels deep (`infra/compose/runtime/`), but `context: ../../../..` was NOT decremented. Resolves one level ABOVE repo root. **Breaks all Docker builds.**
   - `infra/compose/runtime/docker-compose.dev.yml:12,250,456` — change `../../../..` → `../../..`
   - `infra/compose/runtime/docker-compose.yml:13` — change `../../../..` → `../../..`

2. **Volume mount off-by-one** — Same root cause.
   - `infra/compose/runtime/docker-compose.dev.yml:585-586` — `../../../../services/sandbox-openclaw/` → `../../../services/sandbox-openclaw/`

3. **`.gitignore` stale SSH key path** — Lines 98-99 still reference `platform/infra/providers/cherry/base/keys/*`. SSH private keys at new path `infra/tofu/cherry/base/keys/` are **unprotected by gitignore**.
   - Fix: `platform/infra/providers/cherry/base/keys/*` → `infra/tofu/cherry/base/keys/*`
   - Fix: `!platform/infra/providers/cherry/base/keys/*.pub` → `!infra/tofu/cherry/base/keys/*.pub`

**Verification:** After fixes, run `docker compose -f infra/compose/runtime/docker-compose.dev.yml config` to validate all paths resolve.

**Non-blocking (Checkpoint 3 scope):**

- `infra/AGENTS.md` stale pointers: `providers/cherry/` → `tofu/cherry/`, remove `files/` reference
- `infra/tofu/cherry/AGENTS.md:57` stale `../../files/scripts/` reference
- `infra/compose/sandbox-proxy/AGENTS.md` all relative links off by one level + stale `src/` path on L17
- `infra/compose/runtime/configs/AGENTS.md:18` link off by one level
- `scripts/check-root-layout.ts` still allows `platform` in root entries (L61, L118) — remove stale entry

### R3 — Full Branch Review (2026-03-11)

**Blocking (must fix — CI will fail):**

1. **`scripts/ci/build.sh:89,100`** — Both `docker build ... .` use default `./Dockerfile` which no longer exists. Add `-f apps/operator/Dockerfile` to both commands.

2. **`scripts/ci/compute_migrator_fingerprint.sh:15-16,19`** — Three stale paths: `src/shared/db` → `apps/operator/src/shared/db`, `src/adapters/server/db/migrations` → `apps/operator/src/adapters/server/db/migrations`, `Dockerfile` → `apps/operator/Dockerfile`. Script exits 1 on every run.

3. **`.github/workflows/ci.yaml:362,380`** — `docker/build-push-action` steps for app and migrator use `context: .` but no `file:` parameter. Docker defaults to `./Dockerfile` (missing). Add `file: ./apps/operator/Dockerfile` to both.

4. **`tests/arch/entrypoints-boundaries.spec.ts:25`** — Regex `^(src\/[^/]+)` won't match `apps/operator/src/...` probe paths. Fix: `/^(apps\/web\/src\/[^/]+)/`.

**Non-blocking:**

- `infra/compose/runtime/docker-compose.yml:428,486-487` — Production compose has stale `./sandbox-proxy/` and `./openclaw/` volume mounts (pre-existing on staging, not a regression). Dev compose has correct paths.
- `biome/base.json:120` — `apps/operator/src/infra/**` doesn't exist (was `src/infra/**` on staging, also phantom). Harmless override.
- `.dockerignore:53` — `src/**/__arch_probes__` should be `apps/operator/src/**/__arch_probes__`. Minor context size issue.

## PR / Links

- https://github.com/Cogni-DAO/node-template/pull/547
- Handoff: [handoff](../handoffs/task.0151.handoff.md)

## Attribution

-
