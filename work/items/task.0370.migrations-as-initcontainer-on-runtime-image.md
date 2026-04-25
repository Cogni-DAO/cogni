---
id: task.0370
type: task
title: "Rebase every node's migrator stage on its runtime image"
status: needs_review
revision: 4
priority: 1
rank: 1
estimate: 1
summary: "Universal per-node pattern: every node's Dockerfile migrator stage moves from `FROM base` to `FROM runner` and runs a ~15-line `migrate.mjs` using drizzle-orm's already-prod-dep programmatic migrator. Migrator image layers share 99.9% of content with the runtime image k3s already pulled for the app; per-flight image-pull drops from ~3m45s/node to ~1s. Keeps Argo PreSync hook, keeps one-Job-per-sync, keeps credential separation, zero replica-race surface. Addresses bug.0368."
outcome: "Every deployed node (operator, resy, poly, any future node-next-X) inherits `FROM runner AS migrator`. candidate-flight verify-candidate wait drops from 4–9min to ~30-60s per affected node. Migrator image < 5MB unique layers on top of runtime. No spec rewrite required."
spec_refs:
  - docs/spec/databases.md
assignees: []
credit:
project: proj.database-ops
branch: fix/candidate-flight-migrator-image-pull
bugs:
  - bug.0368
created: 2026-04-24
updated: 2026-04-24
---

# Task: rebase migrator stage on runtime image

## One idea

Current migrator Dockerfile stage: `FROM base AS migrator` + `COPY --from=builder /app/node_modules ./node_modules` → unique ~400MB blob per node per flight, k3s pulls it cold every time.

New: `FROM runner AS migrator` + `COPY migrate.mjs + migrations/` → 1–5MB unique delta on top of the runtime image k3s already has cached. First-ever flight still pays the runtime pull; every subsequent flight reuses it.

Preserves:

- Argo PreSync hook model (one Job per sync, no replica race)
- Credential separation (migrator image runs in its own pod with its own secret binding)
- Forward-compatible-migrations obligation (unchanged)
- `drizzle-orm` as the already-trusted migration library (programmatic migrator — same underlying code drizzle-kit uses)

Drops:

- drizzle-kit + tsx + pnpm from the migrator image (not needed at runtime; `drizzle-orm/postgres-js/migrator` is the production programmatic API)
- ~480MB of dev node_modules in the migrator image
- `scripts/ci/compute_migrator_fingerprint.sh` becomes lower-value (content-addressing still fine; cache hit rate just improved dramatically). Keep it.

## Why this is smaller than the earlier initContainer proposal (revision 1/2)

Reviewer called out three concerns with the initContainer path:

1. **Replica races** — initContainer runs per pod; 3 replicas = 3 concurrent migrators. This task's Job approach: 1 migrator per sync, unchanged.
2. **Runtime image gains migration tooling + DB privilege** — minor, but non-zero attack-surface expansion. This task: runtime image is untouched; only migrator stage is rebased.
3. **Drift from "migrations out of deploy path entirely"** — the top-0.1% endgame is CI-gated migrations + declarative schema via Atlas. This task doesn't move us toward or away from that endgame; it's a local optimization that buys the team ~3–8 min per flight, now, and leaves the architecture untouched for when Atlas is the right move.

## Code changes (exact)

### 1. Per-node `migrate.mjs` (3 new files)

`nodes/{operator,poly,resy}/app/src/adapters/server/db/migrate.mjs` — ~15 lines each. Uses only `drizzle-orm` + `postgres` (both already prod deps). Resolves migrations dir relative to the script's own location so it works regardless of CWD.

### 2. Per-node Dockerfile — migrator stage (3 files touched)

**Before (operator; poly and resy symmetric):**

```dockerfile
FROM base AS migrator
WORKDIR /app
COPY --from=builder /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/nodes/operator/drizzle.config.ts ./nodes/operator/drizzle.config.ts
COPY --from=builder /app/packages/db-schema/src ./packages/db-schema/src
COPY --from=builder /app/nodes/operator/app/src/shared/db ./nodes/operator/app/src/shared/db
COPY --from=builder /app/nodes/operator/app/src/adapters/server/db/migrations ./nodes/operator/app/src/adapters/server/db/migrations
CMD ["pnpm", "db:migrate:operator:container"]
FROM node:22-alpine AS runner
...
```

**After — move migrator AFTER runner, rebase on runner:**

```dockerfile
FROM node:22-alpine AS runner
... (unchanged)
CMD ["node", "nodes/operator/app/server.js"]

# Migrator — ships migrations + migrate.mjs on top of the runtime image so k3s
# reuses the already-pulled runner layers. See bug.0368 / task.0370.
FROM runner AS migrator
USER root
WORKDIR /app
COPY --from=builder --chown=nextjs:nodejs /app/nodes/operator/app/src/adapters/server/db/migrations /app/migrations
COPY --from=builder --chown=nextjs:nodejs /app/nodes/operator/app/src/adapters/server/db/migrate.mjs /app/migrate.mjs
USER nextjs
CMD ["node", "/app/migrate.mjs", "/app/migrations"]
```

### 3. `next.config.ts` per node — force-trace `drizzle-orm/postgres-js/migrator`

`drizzle-orm` and `postgres` are already in `serverExternalPackages`. nft-tracing may prune the `postgres-js/migrator` subpath because the app itself only imports `drizzle-orm/postgres-js` (driver), never the migrator. Explicitly include the subpath + its types:

```ts
outputFileTracingIncludes: {
  "/**": [
    "../../../node_modules/drizzle-orm/postgres-js/migrator.js",
  ],
},
```

Added alongside the existing `outputFileTracingExcludes`.

### 4. No manifest changes

`infra/k8s/base/node-app/migration-job.yaml` — untouched. Argo PreSync hook + Job + DATABASE_URL secret binding all unchanged. The `images:` digest in each overlay keeps pointing at `ghcr.io/cogni-dao/cogni-template-migrate:<sha>`; CI keeps building a migrator image per node; promote flow unchanged. The ONLY thing that changes is what's IN the migrator image.

### 5. No CI script changes

`scripts/ci/lib/image-tags.sh` — untouched. `compute_migrator_fingerprint.sh` — untouched (content-addressed cache still works; just hits more often).

## Invariants

- **FORWARD_COMPAT_MIGRATIONS** (same as today) — every migration must be compatible with the prior app version. With Job + PreSync hook, Argo waits for Job completion before rolling new app pods; between Job completion and old-pod termination there is still a brief window where the old pod hits the new schema. `DROP COLUMN` / non-default `NOT NULL` during that window = partial outage. Unchanged by this task.
- **IDEMPOTENT_MIGRATIONS** — drizzle-orm programmatic migrator reads `drizzle.__drizzle_migrations` journal, applies only new rows. Safe on re-run.
- **EXPLICIT_DATABASE_URL** — `migrate.mjs` reads `DATABASE_URL` from env and exits 2 if missing.
- **ONE_JOB_PER_SYNC** — Argo PreSync hook runs exactly one migrator pod per sync per node. No replica race.
- **CREDENTIAL_SEPARATION** — migrator image still runs in a Job with its own secret ref (same as today); runtime image is untouched.

## Validation

exercise: push this branch → pr-build.yml rebuilds operator/poly/resy runtime + migrator images → dispatch `gh workflow run candidate-flight.yml --ref fix/candidate-flight-migrator-image-pull -f pr=<this-PR-number>`.

observability:

- First flight after this merges: migrator image pull wait = ~30–60s (pays the one-time runtime pull delta for the new code paths). Acceptable baseline.
- Second flight (and every subsequent flight): `verify-candidate > Wait for ArgoCD sync` ≤ ~60s because migrator image layers are entirely cached. Previous baseline: 4–9 min.
- `kubectl -n cogni-candidate-a get pods -l app.kubernetes.io/component=migration` — hook Jobs still present (unchanged).
- Pod log (Loki selector `{namespace="cogni-candidate-a", container="migrate"}`) shows a single line per Job: `✅ <node> migrations applied in Xms`.
- `/version.buildSha` on candidate-a-{operator,poly,resy} matches flown SHA within 2 min of dispatch.
- Failure case: break a migration SQL file. Job fails; Argo sync Failed; app rollout blocked. `/readyz` from old pods keeps serving. Revert, re-flight; recovers.

## Universality

The rule is **every deployed node's Dockerfile has `FROM runner AS migrator` with the standard shape** (migrations + migrate.mjs COPY, CMD = `node /app/migrate.mjs /app/migrations`). Adding a new `node-next-X` inherits it by convention — copy the 14-line stanza, update the path prefix, done.

This PR lands the pattern for **operator** and **resy**. Poly follows the same rule but requires a dual-target split because its migrator image is shared between two Jobs (Postgres `migrate-node-app` and Doltgres `migrate-poly-doltgres`, which needs the dolt_commit stamp). That split is task.0372 — not a deviation from the universal rule, just additional CI plumbing (new `poly-doltgres-migrator` target in `lib/image-tags.sh` + a second Dockerfile migrator stage + 4 overlay edits).

## Poly: single image, two scripts (rev 4)

Rev 3 scoped poly out. Rev 4 folds it in because "both" was wrong scope — the universal pattern demands all three nodes adopt it, not two.

Poly's constraint: its migrator image is shared between `migrate-node-app` Job (Postgres) and `migrate-poly-doltgres` Job (Doltgres with a trailing `dolt_commit` stamp). Rev-3 thinking was a dual-target CI surface split (~10 files of `lib/image-tags.sh` + `build-and-push-images.sh` + promote-chain plumbing). Rev 4 uses a much smaller surface:

- **One poly migrator image**, `FROM runner AS migrator`, carrying both `migrate.mjs` (Postgres, default CMD) and `migrate-doltgres.mjs` (Doltgres, reached via Job `command:` override in `infra/k8s/base/poly-doltgres/doltgres-migration-job.yaml`).
- Both scripts use `drizzle-orm/postgres-js/migrator` — identical code path. `migrate-doltgres.mjs` adds a single trailing `SELECT dolt_commit('-Am', 'migration: drizzle-orm batch')` to stamp DDL into `dolt_log` (same behavior as today's `pnpm db:migrate:poly:doltgres:container` trailing-commit step).
- Doltgres compatibility: the programmatic migrator is the _same_ function drizzle-kit calls internally. Existing production Doltgres migrations (via drizzle-kit CLI) already exercise this path. The only new thing in this PR is invoking it directly instead of via the CLI wrapper.
- Zero new CI targets, zero `lib/image-tags.sh` edits, zero overlay edits.

## Runtime image bloat — bug.0369 (separate)

`docker history mig-operator` reveals the runtime image is ~920 MB with ~285 MB (31%) being `@openai/codex` SDK + platform-binary workaround (bug.0224). The codex weight is pre-existing, not introduced by task.0370. Layer-share still works: migrator adds ~2 MB on top of runner, k3s pulls the shared layers once. But the runner's own first-pull cost remains ~920 MB per node per promote, which is still a lot. File `bug.0369.runtime-image-codex-bloat` as follow-up — out of scope here.

- Atlas / declarative schema / CI-gated migrations — the endgame per /review feedback. Tracked in task.0325. Not blocked by or touched by this task.
- Credential narrowing to `app_migrator` role — proj.database-ops P1 credential convergence. Unaffected.
- Destructive-SQL CI lint for FORWARD_COMPAT_MIGRATIONS — follow-up task.0371. Good hygiene; not load-bearing on this task's correctness.
- `wait-for-argocd.sh` kick logic — hook-Job babysitting still needed while Argo hooks remain. Leave as-is.

## Links

- bug.0368 — diagnosis + evidence
- /review — external senior engineer review that crystallized the "rebase on runner" path (vs the earlier initContainer proposal, which had replica-race + runtime-tooling concerns)
- task.0325 — Atlas + GitOps migrations (endgame, separate track)
