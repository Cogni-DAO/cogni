---
id: task.0425
type: task
title: "Per-node package carve-out standard — `nodes/<X>/packages/*` ownership rules + first carve-out (poly)"
status: done
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
branch: refactor/task-0421-poly-package-carveout
pr: https://github.com/Cogni-DAO/node-template/pull/1125
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
- [x] Commit: `refactor(poly): carve poly-wallet into nodes/poly/packages/wallet (task.0421 batch 1)` — `6a7ddf9e7`

### Batch 2 — `@cogni/market-provider` → `@cogni/poly-market-provider` (rename + ~54 importers)

- [x] `git mv packages/market-provider nodes/poly/packages/market-provider`
- [x] Renamed `package.json` `"name"` to `"@cogni/poly-market-provider"`
- [x] Bulk find-replace `@cogni/market-provider` → `@cogni/poly-market-provider` across all importers (95 files touched incl. internal package refs)
- [x] Dropped stale `@cogni/market-provider` from `nodes/{operator,resy,node-template}/app/package.json` (no code importers there)
- [x] `tsconfig.json`: dropped `./packages/market-provider`, added `./nodes/poly/packages/market-provider`
- [x] `.dependency-cruiser.cjs`: updated `^packages/market-provider/src/policy/` → `^nodes/poly/packages/market-provider/src/policy/` (PURE_POLICY_NO_IO rule still in effect)
- [x] Doc-comment refs (`packages/market-provider/...` in source `Links:` strings) updated to new path
- [x] Fixed two test files referencing `__dirname`-relative `../../../docs/research/fixtures/...` — added 2 levels for the deeper move (`../../../../../docs/...`)
- [x] Fixed `nodes/poly/app/tests/unit/packages/market-provider/position-timelines.test.ts` relative imports — caught + repaired a double-prefix (`nodes/poly/nodes/poly/...`) introduced by overlapping seds
- [x] `pnpm install` → `pnpm packages:build` green → `@cogni/poly-market-provider` 163 tests pass, `position-timelines` 3 tests pass, `@cogni/poly-app typecheck` clean, dep-cruiser config parses
- [x] Commit: `refactor(poly): rename @cogni/market-provider → @cogni/poly-market-provider (task.0421 batch 2)` — `d06a6daba`

### Batch 3 — Carve out `@cogni/poly-node-contracts` (13 contracts; symbol classifier built from actual exports, not just `Poly*` prefix)

- [x] Scaffolded `nodes/poly/packages/node-contracts/` (`package.json`, `tsconfig.json`, `tsup.config.ts`, `src/index.ts`, `AGENTS.md` explaining the boundary)
- [x] `git mv packages/node-contracts/src/poly.*.ts nodes/poly/packages/node-contracts/src/` (13 files)
- [x] Shared `packages/node-contracts/src/index.ts`: dropped 13 poly re-exports, replaced with one-line breadcrumb comment
- [x] New `nodes/poly/packages/node-contracts/src/index.ts`: re-exports the 13 contracts
- [x] Wrote import-splitter (`/tmp/split_poly_imports_v2.py`) that builds the symbol allowlist from the moved files (96 symbols incl. `Poly*` AND `Wallet*` / `WALLET_*` exports the v1 prefix-match missed). 16 importer files split correctly.
- [x] Caught one missed `export {…} from "@cogni/node-contracts"` re-export in `nodes/poly/graphs/src/graphs/poly-research/output-schema.ts` — splitter only handled `import` form. Fixed manually + added `@cogni/poly-node-contracts` to `nodes/poly/graphs/package.json` deps.
- [x] `nodes/poly/app/package.json`: added `@cogni/poly-node-contracts` workspace dep
- [x] `tsconfig.json`: registered `./nodes/poly/packages/node-contracts`
- [x] `.dependency-cruiser.cjs`: no rules referenced poly contract paths — nothing to update
- [x] Boundary audit clean: nothing outside `nodes/poly/**` imports `@cogni/poly-node-contracts`; shared `node-contracts` does NOT depend on poly-scoped pkg
- [x] `pnpm install` → `pnpm packages:build` green (35 pkgs) → `@cogni/poly-node-contracts` typecheck clean → `@cogni/node-contracts` typecheck clean → `@cogni/poly-graphs` typecheck clean → `@cogni/poly-app` typecheck clean → poly-app unit suite 1129/1129 pass + 15 skipped + 1 contract test 6/6 pass
- [x] Commit: `refactor(poly): carve poly contracts to @cogni/poly-node-contracts (task.0421 batch 3)` — `cb89897a8`

### Batch 4 — Script move + standard codification

- [x] `git mv scripts/experiments/approve-polymarket-allowances.ts nodes/poly/scripts/experiments/` (the originally-failing path; other 6 polymarket experiment scripts left as-is — not touched in PR #1118 and zero importers, surgical change only)
- [x] No `package.json` script entries reference the old path
- [x] Added the **"Node-owned packages"** section to `docs/spec/node-ci-cd-contract.md` — rule, `@cogni/<node>-<bare-name>` naming convention with table, workspace plumbing notes, full carve-out playbook (10 steps incl. the gotchas this PR hit: overlapping seds, fixture-relative paths, mixed-symbol importers, re-exports), drive-by stale-dep rule, and pointer to task.0422 for the dep-cruiser split. Existing `nodes/node-template/packages/knowledge/` cited as canonical example.
- [x] `pnpm check:docs` green (`AGENTS.md OK`, 601 doc-header files OK, metadata OK)

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
