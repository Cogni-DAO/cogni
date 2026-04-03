---
id: bug.0262
type: bug
title: "Operator Postgres env vars lack _OPERATOR suffix — inconsistent with multi-node pattern"
status: needs_design
priority: 3
rank: 10
estimate: 2
summary: "DATABASE_URL and DATABASE_SERVICE_URL lack the _OPERATOR suffix that POLY and RESY nodes use. This inconsistency means the operator is a special case instead of following the same per-node pattern. Rename to DATABASE_URL_OPERATOR / DATABASE_SERVICE_URL_OPERATOR across all 1400+ references."
outcome: "All per-node env vars follow the same pattern: DATABASE_URL_<NODE>, DATABASE_SERVICE_URL_<NODE>, DOLTGRES_URL_<NODE>. No special-casing for operator."
spec_refs: []
assignees: derekg1729
project: proj.poly-prediction-bot
created: 2026-04-02
updated: 2026-04-02
---

# Operator Postgres Env Vars Lack \_OPERATOR Suffix

## Bug

Per-node Postgres env vars use suffixed names (`DATABASE_URL_POLY`, `DATABASE_URL_RESY`) but the operator node uses unsuffixed `DATABASE_URL` and `DATABASE_SERVICE_URL`. This creates inconsistency — the operator is a special case.

## Impact

- Confusing: new developers must learn "operator is special"
- Script complexity: `dev:poly` overrides `DATABASE_URL=$DATABASE_URL_POLY` but operator doesn't need an override
- Pattern breaks: adding a 4th node requires knowing operator is different

## Blast Radius

~1400 files reference `DATABASE_URL` including:

- Docker compose files, CI secrets, drizzle.config.ts
- All node app env schemas, test fixtures, test setup
- Stack test configs, component test configs

## Validation

```bash
pnpm check:fast
pnpm dev:stack
```
