---
id: bug.0275
type: bug
title: "k8s migration Job fails — standalone app image lacks tsx + drizzle-kit"
status: needs_implement
priority: 2
rank: 5
estimate: 2
summary: "Argo CD PreSync migration Job can't run Drizzle migrations — Next.js standalone image strips devDeps (tsx, drizzle-kit). Currently a no-op stub. Needs dedicated migrator Dockerfile target."
outcome: "Migration Job runs real Drizzle migrations in k8s using a lightweight migrator image with tsx + drizzle-kit."
project: proj.cicd-services-gitops
assignees: []
labels: [deployment, k8s, migration, argocd]
created: 2026-04-03
updated: 2026-04-03
---

## Bug

The Argo CD PreSync migration Job (`infra/k8s/base/node-app/migration-job.yaml`) cannot run Drizzle migrations because the Next.js standalone app image does not include `tsx` or `drizzle-kit` (devDependencies stripped by standalone output).

**Current workaround:** Migration command is a no-op `echo`. DB is migrated by the Compose `db-provision` service during provisioning.

## Root Cause

The migration Job uses the same image as the app Deployment. Next.js standalone build strips devDeps. `drizzle-kit` and `tsx` are devDeps not in the image.

The Compose stack has a separate `db-migrate` service using `MIGRATOR_IMAGE` — a full workspace image. The k8s manifests have no equivalent.

## Line Items

1. Create a `migrator` stage in the app Dockerfile — includes `tsx` + `drizzle-kit` + `drizzle.config.ts` + migration files only
2. Add migrator image to CI build (`build-prod.yml`)
3. Update kustomize overlays with separate `images:` entry for `node-template-migrator`
4. Restore migration command (remove `echo` no-op)
5. Fix node Dockerfiles — poly/resy build operator, not their own app (separate issue, impacts migrator too)

## Validation

- [ ] `kubectl kustomize` renders migration Job with migrator image and `drizzle-kit migrate` command
- [ ] Fresh provision: migration Job completes successfully (not no-op)
- [ ] `pnpm check:fast` passes
