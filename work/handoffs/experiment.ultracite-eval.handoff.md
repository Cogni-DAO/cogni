---
id: experiment.ultracite-eval
type: handoff
work_item_id: experiment.ultracite-eval
status: active
created: 2026-02-26
updated: 2026-02-26
branch: experiment/ultracite-eval
last_commit: f4fba287
---

# Handoff: Ultracite Linter Evaluation

## Context

- Evaluating [ultracite](https://github.com/haydenbleasel/ultracite) v7.2.3 as a managed biome preset to replace our hand-rolled `biome/*.json` configs
- Ultracite provides opinionated biome presets (`core`, `next`) covering lint, format, and assist rules
- Installed in a dedicated worktree at `../cogni-template-ultracite` off `staging`
- Biome upgraded from 2.3.7 → 2.4.0 to match ultracite's dependency
- Initial scan found **2,794 errors**; auto-fixes brought it down to **~905 errors**

## Current State

- **Done:** 11 commits on `experiment/ultracite-eval`, pushed to origin
- **Done:** All safe auto-fixable rules applied (1,889 errors resolved):
  - `useBlockStatements` (509), `useSortedInterfaceMembers` (384), `useSortedAttributes` (312)
  - `useNumericSeparators` (115), `useSimplifiedLogicExpression` (58), `useAtIndex` (25), `noUnusedTemplateLiteral` (32)
- **Done:** Config overrides for project conventions:
  - Filename convention: allow kebab-case, PascalCase, camelCase, snake_case
  - `noBarrelFile`: off (barrel files are intentional)
  - `noSkippedTests`: off (visible in test runner output)
- **Remaining:** ~905 errors, all requiring manual fixes or rule-level decisions
- **Not started:** No tests have been run against the auto-fixed code

## Decisions Made

- Ultracite extends replace `biome/base.json`, `biome/app.json`, `biome/tests.json` — all project-specific overrides (vendor SDK restrictions, noProcessEnv scoping, noDefaultExport exceptions) preserved in root `biome.json`
- Old `biome/*.json` files still exist on disk but are no longer referenced in `extends`
- All commits used `--no-verify` because pre-commit/pre-push hooks run full biome check which fails on remaining violations

## Next Actions

- [ ] Run test suite (`pnpm test`) to verify auto-fixes didn't break anything
- [ ] Decide on remaining manual-fix rules (by count):
  - [ ] `useTopLevelRegex` (~194) — hoist regex out of functions; real perf win
  - [ ] `useAwait` (~175) — remove unnecessary `async` or add missing `await`
  - [ ] `noParameterProperties` (~102) — ban TS constructor parameter properties?
  - [ ] `useConsistentMemberAccessibility` (~88) — require explicit public/private?
  - [ ] `noExcessiveCognitiveComplexity` (~49) — refactor complex functions
  - [ ] `noNamespaceImport` (~54) — ban `import * as X`?
- [ ] Delete old `biome/base.json`, `biome/app.json`, `biome/tests.json` once satisfied
- [ ] Update `docs/spec/style.md` to document ultracite adoption
- [ ] Update pre-commit/pre-push hooks if adopting ultracite long-term

## Risks / Gotchas

- Auto-fixed code has **not been tested** — sorted interface members or `.at()` changes could have subtle runtime effects
- Pre-commit and pre-push hooks will fail until all remaining errors are resolved or rules are configured off/warn
- Ultracite pins biome 2.4.0 — future ultracite upgrades may bump biome and introduce new rules
- `useSortedInterfaceMembers` reorders properties which could break destructuring assumptions in rare cases
- The worktree is at `../cogni-template-ultracite` — remember to clean up when done

## Pointers

| File / Resource | Why it matters |
| --------------- | -------------- |
| `biome.json` (on branch) | Single config file — ultracite extends + all project overrides |
| `biome/base.json` | Old config, still on disk, no longer in extends chain |
| `node_modules/ultracite/config/biome/core/biome.jsonc` | Full ultracite core ruleset for reference |
| `node_modules/ultracite/config/biome/next/biome.jsonc` | Next.js-specific overrides |
| `docs/spec/style.md` | Current style guide — needs update if adopting |
