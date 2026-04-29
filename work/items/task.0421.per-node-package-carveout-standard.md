---
id: task.0421
type: task
title: "Per-node package carve-out standard — `nodes/<X>/packages/*` ownership rules + first carve-out (poly)"
status: needs_design
priority: 1
rank: 2
estimate: 5
summary: "Define and apply the `nodes/<X>/packages/*` ownership standard so node-specific packages stop living at root and PRs touching only one node classify cleanly under `single-node-scope`. Today `packages/market-provider`, `packages/poly-wallet`, the 13 `poly.*.contract.ts` files inside shared `packages/node-contracts/`, and `scripts/experiments/approve-polymarket-allowances.ts` are all poly-only in practice but root-located, so any poly PR that touches them counts as `[poly, operator]` and trips the gate (e.g. PR #1118 / run #25082460609). This task: (1) write the standard — what belongs at root vs `nodes/<X>/packages/`, naming, tsconfig path-alias rules, drive-by removal of stale cross-node deps; (2) execute the poly carve-out as the reference implementation; (3) document the same shape for `nodes/node-template/packages/*` (already has `knowledge`, codify the rule). Per-node dep-cruiser is explicitly out of scope — tracked in task.0422."
outcome: "After merge: (1) `docs/spec/node-ci-cd-contract.md` has a 'node-owned packages' section with the rule + naming + tsconfig pattern; (2) `nodes/poly/packages/` contains `market-provider`, `poly-wallet`, `node-contracts` (poly subset of contracts); (3) `scripts/experiments/approve-polymarket-allowances.ts` lives under `nodes/poly/scripts/experiments/`; (4) stale `@cogni/market-provider` deps removed from `nodes/{operator,resy,node-template}/app/package.json`; (5) a follow-up poly-only PR (any small change under `nodes/poly/**`) classifies as `['poly']` on `single-node-scope` and passes. Sister pattern: task.0411 (per-node `temporal-workflows`)."
spec_refs:
  - docs/spec/node-ci-cd-contract.md
  - docs/spec/node-operator-contract.md
assignees: derekg1729
credit:
project: proj.cicd-services-gitops
branch:
pr:
reviewer:
revision: 0
blocked_by: []
deploy_verified: false
created: 2026-04-28
updated: 2026-04-28
labels: [cicd, node-boundary, packages, refactor, monorepo]
external_refs:
  - https://github.com/Cogni-DAO/node-template/actions/runs/25082460609/job/73490473681?pr=1118
---

# Per-node package carve-out standard

## Why

The `single-node-scope` gate (`tests/ci-invariants/classify.ts`) maps `nodes/<X>/**` → `X`, everything else → `operator`. That gate is doing its job — the actual problem is that **poly-flavored code currently lives at root**, so a single-purpose poly PR is forced to span two domains:

```
PR #1118 OPERATOR_FILES (per CI run):
  packages/market-provider/**           ← only poly/app uses this in code
  packages/poly-wallet/**                ← strictly poly
  packages/node-contracts/src/poly.*.ts  ← 13 poly-specific contracts in a shared pkg
  scripts/experiments/approve-polymarket-allowances.ts
  .dependency-cruiser.cjs                ← only poly-named rules churned
```

`@cogni/market-provider` is declared in all four `nodes/*/app/package.json` files but only `nodes/poly/app/**` imports it — three of those declarations are stale. That stale-dep problem is the secondary cleanup riding on this task.

This is queue #2 of [`operator-dev-manager`](.claude/skills/operator-dev-manager/SKILL.md): _node-owned package placement_.

## Scope (1 PR)

**Standard (write):**

- New section in `docs/spec/node-ci-cd-contract.md`: "Node-owned packages."
- **Rule:** a package is node-owned iff its only in-repo importer is `nodes/<X>/app` or `nodes/<X>/graphs`. Node-owned packages live at `nodes/<X>/packages/<bare-name>/`. Cross-node packages live at root `packages/`.
- **Naming convention** (verified 2026-04-28 against existing `nodes/poly/packages/{ai-tools,db-schema,doltgres-schema,knowledge}`): folder is the bare name (`wallet`, `market-provider`, …), package name is `@cogni/<node>-<bare-name>` (`@cogni/poly-wallet`, `@cogni/poly-market-provider`, …). The `@cogni/<node>-…` prefix is the standard — the folder path doesn't replace it; together they make node ownership unambiguous in both grep and registry views.
- **Workspace plumbing:** `pnpm-workspace.yaml` already globs `nodes/*/packages/*`. No tsconfig path-alias edits needed; pnpm symlinks resolve `@cogni/*` automatically.
- **Drive-by rule:** when carving out, delete the dependency from any `package.json` that doesn't actually import it.

**Execute (poly carve-out — the reference impl).** Done in 4 batches; each batch ends with `pnpm check:fast` green and a commit. Update the per-batch checkboxes below as we go so progress is visible at a glance.

### Batch 1 — `@cogni/poly-wallet` (smallest; name already conforms)

The package is already named `@cogni/poly-wallet`; this batch is purely a folder move + rule path updates. No importer churn.

- [x] `git mv packages/poly-wallet nodes/poly/packages/wallet` — folder bare-name `wallet`, package keeps name `@cogni/poly-wallet`
- [x] `package.json` / `tsup.config.ts` / `tsconfig.json` use relative paths — no edits needed after the move
- [x] Root `.dependency-cruiser.cjs` has no `packages/poly-wallet` rules — nothing to update
- [x] `tsconfig.json`: dropped `./packages/poly-wallet` reference, added `./nodes/poly/packages/wallet`
- [x] `biome/base.json`: `packages/poly-wallet/tsup.config.ts` → `nodes/poly/packages/wallet/tsup.config.ts`
- [x] Doc-comment in `nodes/poly/app/src/app/api/v1/poly/wallet/enable-trading/route.ts` updated (only path-string outside the package itself)
- [x] `pnpm install` → `pnpm packages:build` green (all 34 incl. new path declared) → `@cogni/poly-wallet typecheck` + `@cogni/poly-app typecheck` clean
- [ ] Commit: `refactor(poly): carve poly-wallet into nodes/poly/packages/wallet`

### Batch 2 — `@cogni/market-provider` → `@cogni/poly-market-provider` (rename + 53 importers)

- [ ] `git mv packages/market-provider nodes/poly/packages/market-provider`
- [ ] In `nodes/poly/packages/market-provider/package.json`: rename `"name": "@cogni/market-provider"` → `"@cogni/poly-market-provider"`
- [ ] Find-replace `@cogni/market-provider` → `@cogni/poly-market-provider` across all 53 importers (all under `nodes/poly/**` per audit)
- [ ] Drop stale `@cogni/market-provider` from `nodes/{operator,resy,node-template}/app/package.json`
- [ ] Update `nodes/poly/app/package.json`: dep entry name updated
- [ ] Update root `.dependency-cruiser.cjs`: replace `packages/market-provider` paths
- [ ] Update root `tsconfig.json` / `turbo.json` if they reference the old name
- [ ] `pnpm install` → targeted: `pnpm --filter @cogni/poly-market-provider test typecheck` + `pnpm --filter @cogni/poly-app typecheck` (all 53 importers live there)
- [ ] Commit: `refactor(poly): rename @cogni/market-provider → @cogni/poly-market-provider, move under nodes/poly/packages/`

### Batch 3 — Carve out `@cogni/poly-node-contracts` (13 contracts, ~26 importers)

The 13 `poly.*.ts` contracts in shared `packages/node-contracts/src/` need their own node-scoped package so future poly contract changes don't trip the operator domain.

- [ ] Scaffold `nodes/poly/packages/node-contracts/` mirroring `packages/node-contracts/` shape (`package.json` name `@cogni/poly-node-contracts`, `tsconfig.json`, `src/`, exports map, build wiring)
- [ ] `git mv packages/node-contracts/src/poly.*.ts nodes/poly/packages/node-contracts/src/` (×13 files)
- [ ] Update shared `packages/node-contracts/src/index.ts`: drop the 13 poly re-exports
- [ ] Update `nodes/poly/packages/node-contracts/src/index.ts`: re-export the 13 contracts
- [ ] Find-replace in poly importers: `from '@cogni/node-contracts'` (any line that imports a `poly*` symbol) → `from '@cogni/poly-node-contracts'`. Audit count: ~26 files.
- [ ] Add `@cogni/poly-node-contracts` to `nodes/poly/app/package.json` deps
- [ ] Update root `.dependency-cruiser.cjs` if it has rules on the poly contract paths
- [ ] `pnpm install` → targeted: `pnpm --filter @cogni/poly-node-contracts test typecheck` + `pnpm --filter @cogni/node-contracts test typecheck` (shared still valid) + `pnpm --filter @cogni/poly-app typecheck`
- [ ] Commit: `refactor(poly): carve poly contracts into @cogni/poly-node-contracts under nodes/poly/packages/`

### Batch 4 — Script move + standard codification

- [ ] `git mv scripts/experiments/approve-polymarket-allowances.ts nodes/poly/scripts/experiments/`
- [ ] Update any `package.json` script entries that reference the old path
- [ ] Add the **"Node-owned packages"** section to `docs/spec/node-ci-cd-contract.md` (rule + naming + workspace plumbing + drive-by stale-dep cleanup); link `nodes/node-template/packages/knowledge/` and the just-carved poly packages as canonical examples
- [ ] Cross-link from `docs/spec/node-operator-contract.md` if it covers ownership boundaries
- [ ] Targeted: `pnpm biome check docs/spec/node-ci-cd-contract.md` + spot-check moved script runs (`tsx --noEmit nodes/poly/scripts/experiments/approve-polymarket-allowances.ts` if cheap, otherwise skip)
- [ ] Commit: `docs(node-boundary): codify node-owned packages standard + finish poly carve-out`

### Pre-PR

- [ ] Push branch — pre-push hook runs `check:fast`. Do not run it manually first; if the hook flags anything, fix and re-push.
- [ ] PR body uses the validation block from §Validation
- [ ] After merge: open the trivial poly-only validation PR (one-line tweak under `nodes/poly/app/src/**`); confirm `single-node-scope` MATCHED=`["poly"]`. Comment that result back on this PR before flipping `deploy_verified`.

Per-node dep-cruiser configs are explicitly **not** touched here — task.0422.

**Codify (node-template):**

- Document that `nodes/node-template/packages/knowledge/` is the existing example of the same pattern.
- No code moves required there — it's already correctly placed.

## Out of scope

- Per-node dep-cruiser configs → task.0422.
- Splitting `@cogni/temporal-workflows` per-node → task.0411 (already in flight).
- Migrating `node-contracts` cross-node shapes → leave shared.

## Validation

```yaml
exercise: |
  After merge, open a trivial poly-only PR (e.g. one-line tweak under nodes/poly/app/src/**)
  and verify CI's `single-node-scope` job classifies it as ["poly"] and passes.
observability: |
  CI run page for the trivial PR: `single-node-scope` job logs MATCHED=["poly"] (no operator).
```

## Risk

- `@cogni/market-provider` removal from non-poly `app/package.json` files — confirmed only `nodes/poly/app/**` imports it in code (53 import sites, all poly), so the three other declarations are safe to drop.
- The shared `packages/node-contracts/` will still be valid and importable after Batch 3 — only the 13 poly files leave; everything else stays.
- Batch 2 and 3 each touch 50+ files in find-replace mode. Use `git grep -l` audits before each commit to confirm nothing was missed.

## Refs

- Failing CI surface: [run #25082460609 PR #1118](https://github.com/Cogni-DAO/node-template/actions/runs/25082460609/job/73490473681?pr=1118)
- Classifier: `tests/ci-invariants/classify.ts`
- Related: task.0411 (per-node temporal-workflows), task.0317 (per-node graph catalogs), task.0413 (test-repo as operator-template scaffold)
