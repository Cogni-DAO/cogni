---
id: task.0325
type: task
title: Atlas + GitOps migrations (future upgrade, deferred)
status: needs_design
priority: 3
rank: 80
estimate: 5
summary: Adopt Atlas (atlasgo.io) for declarative schema management + GitOps-native migrations via the AtlasMigration CRD and Argo CD integration. Deferred — current scale does not warrant the added tooling complexity.
outcome: Declarative schema with `atlas migrate diff` replacing drizzle-kit generate; destructive-change linting at PR time; AtlasMigration CRs replacing PreSync Jobs; per-node composite_schema composition. Picks up where task.0324's minimal split leaves off.
spec_refs:
  - databases-spec
  - ci-cd-spec
assignees: derekg1729
credit:
project: proj.database-ops
branch:
pr:
reviewer:
revision: 0
blocked_by: [task.0324]
deploy_verified: false
created: 2026-04-18
updated: 2026-04-18
labels: [db, cicd, atlas, future]
external_refs:
  - https://atlasgo.io/guides/orms/drizzle/getting-started
  - https://atlasgo.io/guides/orms/drizzle/existing-project
  - https://atlasgo.io/atlas-schema/projects
  - https://atlasgo.io/guides/deploying/k8s-argo
  - https://atlasgo.io/blog/2022/10/27/multi-tenant-support
---

# Atlas + GitOps migrations (deferred)

## Why this is deferred

task.0324 solves the immediate problem (cross-node schema leak, shared migration numbering) with a minimal drizzle-kit split — no new tooling. Atlas adds declarative schema diffing, destructive-change linting, and an Argo-native migration CRD, but the value is forward-looking rather than fixing what's broken today.

**Pick this up when any of:**

- Contributor count grows to ~3+ regularly touching schema (collision pressure on shared core migrations warrants tooling-level deduplication)
- Destructive-change prevention at PR time becomes a priority (dropping a column, renaming a table without a two-step migration — Atlas has 50+ analyzers)
- "Core change propagates to every node" starts happening weekly instead of monthly (Atlas's composite_schema eliminates the cp-to-every-node step)
- Argo PreSync Jobs become a reliability problem (AtlasMigration CRD has first-class sync-wave integration)

Until then, task.0324's minimal split is the correct shape.

## Spike evidence (collected 2026-04-18)

Research done at task.0324 r2 time. Preserved below so we don't re-spike later.

### Atlas + Drizzle is an official partnership (Jan 2025)

[atlasgo.io/guides/orms/drizzle](https://atlasgo.io/guides/orms/drizzle) — dedicated section, `drizzle-kit export` command built jointly for this use case. Integration page shows getting-started, existing-project, multi-tenant, Kubernetes, and CI/CD guides.

### Q1 — How Atlas handles three DBs with differing schemas

**`for_each` tenant primitive is WRONG for us.** From [atlasgo.io/blog/2022/10/27/multi-tenant-support](https://atlasgo.io/blog/2022/10/27/multi-tenant-support):

```hcl
env "local" {
  for_each = toset(var.tenants)
  url      = urlsetpath(var.url, each.value)
  migration { dir = "file://migrations" }   # ONE dir for all tenants → assumes identical schemas
}
```

Designed for SaaS-per-tenant (homogeneous). Not our shape.

**`composite_schema` is the right primitive.** From [atlasgo.io/atlas-schema/projects](https://atlasgo.io/atlas-schema/projects):

> "the composition of multiple Atlas schemas into a unified schema graph … useful when projects schemas are split across various sources such as HCL, SQL, or application ORMs."

Proposed per-node `env` block:

```hcl
data "external_schema" "core" {
  program = ["pnpm", "drizzle-kit", "export",
             "--dialect", "postgresql",
             "--schema", "./packages/db-schema/src"]
}
data "external_schema" "poly_local" {
  program = ["pnpm", "drizzle-kit", "export",
             "--dialect", "postgresql",
             "--schema", "./nodes/poly/app/schema"]
}
data "composite_schema" "poly_full" {
  schema "public" { from = data.external_schema.core.url }
  schema "public" { from = data.external_schema.poly_local.url }
}
env "poly" {
  src        = data.composite_schema.poly_full.url
  dev        = "docker://postgres/16/dev"
  migration { dir = "file://atlas/poly/migrations" }
}
```

**Unverified assumption:** Drizzle `external_schema` composes cleanly INSIDE `composite_schema`. The composite_schema example in Atlas docs uses SQLAlchemy/Ent/HCL/SQL (Drizzle not shown). Both mechanisms use `external_schema`, so it should work — but this is inference, not verbatim. Phase A validation below is the gate.

**Fallback if it fails:** three independent per-node Atlas projects with duplicated core HCL. Still simpler than the bespoke wrapper from task.0324 r1, but loses the composition win. At that point, honest question: is the Argo CRD + lint story worth the HCL duplication right now, or defer again?

### Q2 — Atlas Operator + Argo CD

Official guide exists: [atlasgo.io/guides/deploying/k8s-argo](https://atlasgo.io/guides/deploying/k8s-argo). Clean ownership split:

- Argo owns manifests in git, reconciles via sync waves
- Atlas Operator owns `AtlasMigration` CR execution
- Recommended wave order: DB resources → migrations → app

**Mandatory gotcha (from docs):**

> "Argo CD has built-in health assessment for standard Kubernetes types, such as Deployment and ReplicaSet, but it does not have a built-in health check for custom resources such as AtlasMigration."

Fix: one-time Lua health check in `argocd-cm`:

```yaml
resource.customizations.health.db.atlasgo.io_AtlasMigration: |
  hs = {}
  if obj.status ~= nil and obj.status.conditions ~= nil then
    for _, c in ipairs(obj.status.conditions) do
      if c.type == "Ready" and c.status == "True" then
        hs.status = "Healthy"; hs.message = c.message; return hs
      end
    end
  end
  hs.status = "Progressing"; hs.message = "Waiting for migration"; return hs
```

**Without this, app-pod sync wave races migration completion.** Silent race — the kind of bug that bites 10% of deploys in a way that's hard to reproduce. Non-optional if we adopt the Operator.

**k3s specifically:** not documented. No known incompatibility, but also no explicit validation. Our candidate-a k3s is vanilla; no anticipated issue, but unvalidated until we try.

### Q3 — Atlas binary in CI

Negligible friction:

- `arigaio/atlas:latest-extended-alpine` is ~78 MB
- Single Go binary, speaks Postgres wire protocol natively (no driver-baking)
- Install: `curl -sSf https://atlasgo.sh | sh`, `brew install ariga/tap/atlas`, or `docker pull arigaio/atlas`

Atlas replaces `drizzle-kit migrate` only. We still need Node + drizzle-kit for `drizzle-kit export` (emits the schema Atlas reads). Migrator image becomes multi-stage: Node stage for export, Atlas binary copied in.

### Bootstrap path for existing Drizzle DBs

[atlasgo.io/guides/orms/drizzle/existing-project](https://atlasgo.io/guides/orms/drizzle/existing-project) walks this exact scenario:

1. `pnpm drizzle-kit generate` — emit current Drizzle SQL as baseline
2. `pnpm drizzle-kit migrate` against throwaway local Postgres to establish ground truth
3. `atlas migrate diff --env <node>` — Atlas generates its own migration file
4. `atlas migrate apply --env <node> --url <db-url> --baseline <timestamp>` — `--baseline` tells Atlas the DB is already at this version; no replay
5. `atlas migrate status --env <node> --url <db-url>` — verify
6. `atlas schema diff --env <node> --from "file://atlas/migrations" --to <db-url> --exclude "atlas_schema_revisions"` — confirm zero drift

Atlas maintains its own `atlas_schema_revisions` table. Legacy `__drizzle_migrations` stays in place as rollback artifact; drop in follow-up once confident.

This `--baseline <ts>` flag is the killer feature that the bespoke plan (task.0324 r1) would have hand-rolled as ~300 LOC of copy-forward logic. One flag vs a subsystem.

## Tradeoff matrix (reproduced for future decision)

| Dimension                    | Atlas                                 | drizzle-kit minimal split (task.0324 r3, current) |
| ---------------------------- | ------------------------------------- | ------------------------------------------------- |
| Lines we own                 | ~200 HCL + Dockerfile patch           | ~30 LOC of per-node drizzle configs               |
| Baseline adoption            | `--baseline <ts>` flag                | Not needed — `__drizzle_migrations` already valid |
| Schema composition           | `composite_schema` (declarative)      | Per-node schema re-exports core + local           |
| Drift detection              | `atlas schema diff` out of box        | Not in scope                                      |
| Destructive-change linting   | 50+ analyzers out of box              | Not in scope                                      |
| Argo CD integration          | Official guide + CRD                  | Standard PreSync Job                              |
| Argo health check            | Lua snippet (mandatory, load-bearing) | Standard Job (free)                               |
| Team familiarity             | Zero                                  | Drizzle (existing)                                |
| Binary in image              | +78 MB Go binary                      | None                                              |
| Setup cost                   | ~4–5d                                 | ~1–2d                                             |
| Cost when core table changes | Automatic (composite_schema)          | `cp` to every node's migrations dir               |
| k3s validation               | Unvalidated                           | Already runs                                      |

Atlas earns its keep when the "cost when core table changes" column becomes a real ongoing tax. At one-dev scale with infrequent core changes, it isn't. At multi-contributor scale with weekly core changes, it is.

## Proposed phased adoption (for future activation)

### Phase A — composite_schema validation (gate, ~2d)

Goal: prove the unverified assumption from Q1 before investing further.

- [ ] Install Atlas locally. Write minimal `atlas.hcl` with `env "poly"` only.
- [ ] Snapshot candidate-a's `cogni_poly` locally (`pg_dump | psql cogni_poly_test`).
- [ ] Write `composite_schema` unioning `@cogni/db-schema` + `nodes/poly/app/schema/`.
- [ ] Run `atlas migrate diff --env poly initial_baseline` → expect one SQL file unioning core + poly-local tables.
- [ ] Run `atlas migrate apply --env poly --url <snapshot-url> --baseline <ts>` → expect 0 DDL executed, `atlas_schema_revisions` populated.
- [ ] Run `atlas schema diff --env poly --from "file://atlas/poly/migrations" --to <snapshot-url> --exclude "atlas_schema_revisions"` → expect no changes.

**If any step fails:** fallback is three independent per-node Atlas projects (duplicated core HCL). At that point re-decide whether the Argo CRD + lint win is worth the HCL duplication, or whether to defer Atlas for another cycle.

**If all steps pass:** proceed to Phase B.

### Phase B — candidate-a rollout (~2d)

- [ ] Install Atlas Operator on candidate-a k3s (Helm chart `oci://ghcr.io/ariga/charts/atlas-operator`).
- [ ] Apply Argo CD Lua health check ConfigMap patch to candidate-a.
- [ ] Extend `atlas.hcl` with operator + resy envs.
- [ ] Baseline operator + resy DBs on candidate-a (snapshot-first, same approach as Phase A Step 4).
- [ ] Replace per-node `migration-job.yaml` PreSync hooks with `AtlasMigration` CRs.
- [ ] Full candidate-a now uses Atlas for all three nodes; legacy PreSync Jobs deleted.

### Phase C — CI integration (~1d)

- [ ] Migrator image becomes multi-stage Dockerfile: Node stage (drizzle-kit export) + `arigaio/atlas` base.
- [ ] `scripts/ci/compute_migrator_fingerprint.sh` inputs: `packages/db-schema/src/**`, `nodes/*/app/schema/**`, `atlas/**`, `package.json`, `pnpm-lock.yaml`.
- [ ] `scripts/ci/detect-affected.sh` `add_target migrator` trigger extended to same paths.
- [ ] `pnpm db:*` scripts replaced with `atlas migrate apply --env <node>`, `atlas migrate diff --env <node>`, `atlas migrate status --env <node>`.

### Phase D — Preview + Prod rollout (~1.5d)

- [ ] Install Atlas Operator + Argo Lua patch on preview k3s. Baseline preview DBs.
- [ ] Prod cutover — same three-state DB inspection gate from task.0324 Step 9.
- [ ] Monitor first prod promote-and-deploy cycle.

### Phase E — Cleanup

- [ ] Drop legacy `__drizzle_migrations` tables after 30 days stable.
- [ ] Remove drizzle-kit `db:migrate` invocations from scripts (Atlas owns all migrations now).

## Decision log / context to preserve

### Reviewer framings worth keeping

**External review (Codex, 2026-04-18):** Atlas + Drizzle integration is paved. composite_schema is documented. AtlasMigration CRD + Argo Lua health check is the target. "This isn't an unknown integration — it's a paved path with about a dozen guide pages."

**External review (2026-04-18, after Atlas was proposed):** "The fallback is the tell. The dev's backup plan if composite_schema doesn't work cleanly with Drizzle external_schema: three independent Atlas projects with duplicated core HCL. At that point, what did Atlas buy you right now vs. later? … Atlas is what I'd do when about to onboard contributors who'll touch schema. You're at the edge of that transition, so either call is defensible. Just make sure you're signing up for strategic investment with eyes open."

**User direction (2026-04-18):** scope-cut task.0324 to the minimal split; preserve Atlas intel as future task. Current priority is "get us to a working per-node db schemas + migration" not declarative-schema strategic upgrade.

## Validation

Deferred — validation criteria will be set when this task is activated. Phase A of the proposed adoption plan already specifies the concrete gate:

**Exercise:** prove `composite_schema` + Drizzle `external_schema` composes cleanly on a `pg_dump` snapshot of candidate-a's `cogni_poly`. Concretely — the spike must produce a valid Atlas migration file unioning `@cogni/db-schema` + poly-local; the `--baseline` apply must complete without altering tables; `atlas schema diff` must report zero drift.

**Observability:** Atlas Operator pod logs captured by Alloy → Loki (namespace `atlas-operator-system`). Argo surfaces `AtlasMigration` CR state in UI once the Lua health check is applied.

**Ship criteria:** all three deployed DBs (operator, poly, resy) on candidate-a report Synced after one promote-and-deploy cycle with `AtlasMigration` CRs replacing PreSync Jobs. Zero unplanned DROPs.

## Review Checklist (for future activation PR)

- [ ] **Trigger justified:** contributor pressure OR destructive-change linting need OR weekly core changes — document which
- [ ] **Phase A gate:** composite_schema + Drizzle external_schema proven on snapshot BEFORE operator install
- [ ] **Argo Lua health check:** applied BEFORE any AtlasMigration CR syncs
- [ ] **Bootstrap tested on snapshot:** never `--baseline` a live DB without snapshot rehearsal
- [ ] **task.0324 still holds:** per-node schema dirs already separated; Atlas composes on top
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Blocks on: **task.0324** (per-node schema split must land first — Atlas composes per-node; no point adopting before split exists)
- Project: [proj.database-ops.md](../projects/proj.database-ops.md)
- Related: task.0260 (monorepo CI), task.0315 (poly copy-trade — test case)

## Attribution

-
