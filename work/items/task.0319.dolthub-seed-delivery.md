---
id: task.0319
type: task
title: "Implement DoltHub-Backed Seed Delivery for `knowledge_<node>`"
status: needs_design
priority: 1
rank: 2
estimate: 3
summary: "Replace the local-dev row-INSERT seeding (task.0311 / PR #892) with a Dolt-native path: per-node DoltHub repos (under cogni/ org), dolt_clone on provision, and a CI step that pushes TS-sourced seed content to DoltHub on main merge. Removes root-level knowledge workspace deps once delivery moves into the provision flow."
outcome: "On provision (local, candidate, preview, prod), knowledge_<node> comes up already populated from cogni/<node>-knowledge-seeds via dolt_clone. No manual pnpm seed scripts on VMs. CI keeps DoltHub repos in sync with git-reviewed TS seed content. Root package.json stops depending on per-node knowledge packages."
spec_refs:
  - knowledge-data-plane-spec
  - knowledge-syntropy
assignees: derekg1729
project: proj.poly-prediction-bot
created: 2026-04-17
updated: 2026-04-17
labels: [knowledge, doltgres, dolthub, provisioning, deploy-infra]
---

# Implement DoltHub-Backed Seed Delivery

> Blocked on: [spike.0318](./spike.0318.dolthub-knowledge-seeding-design.md) — design decisions first
> Also blocked on: PR #772 (Doltgres on canary/prod)
> Follows: task.0311 / PR #892 (current row-INSERT stopgap)

## Context

PR #892 seeds `knowledge_poly` locally via `scripts/db/seed-doltgres.mts`. That path does not run on VMs. No prod delivery mechanism exists for knowledge content. Spike.0318 designs the Dolt-native replacement (DoltHub repos + `dolt_clone` on provision).

This task implements that design once the spike lands.

## Expected scope (subject to spike outcome)

- Create `cogni/poly-knowledge-seeds` DoltHub repo; push current `@cogni/poly-knowledge` content as initial commit(s).
- Extend `infra/compose/runtime/doltgres-init/provision.sh`: after `CREATE DATABASE knowledge_<node>`, `dolt_clone cogni/<node>-knowledge-seeds` into it.
- CI workflow: on main merge, diff `nodes/<node>/packages/knowledge/src/seeds/` and push changes to the corresponding DoltHub repo via `dolt_push` with `DOLTHUB_JWK_CREDENTIAL` from GH secrets.
- Remove the three knowledge workspace deps from root `package.json` (added by PR #892) — only `@cogni/knowledge-store` stays at root if the seed script is retained for dev use; otherwise all three come out.
- Retire or rescope `scripts/db/seed-doltgres.mts`: either delete (DoltHub is now the only delivery mechanism) or keep as dev-only convenience for iterating content without a DoltHub round-trip.
- Wire `deploy-infra.sh` to include the Doltgres seed step (depends on PR #772 landing first).

## Acceptance criteria (draft — finalize after spike)

- [ ] Fresh `pnpm dev:infra` brings up `knowledge_poly` already populated via `dolt_clone` — no separate seed step
- [ ] Editing a seed in `nodes/poly/packages/knowledge/src/seeds/poly.ts` and merging to main results in a corresponding DoltHub commit on `cogni/poly-knowledge-seeds`
- [ ] Candidate-a deploy provisions `knowledge_poly` with content via CI-driven seed
- [ ] Root `package.json` no longer references per-node knowledge packages
- [ ] CI secret flow documented (where `DOLTHUB_JWK_CREDENTIAL` comes from, how to rotate)
- [ ] Rollback path documented (if DoltHub is unreachable during provision, does provisioning fail loud or fall back to schema-only?)

## Validation

- Locally: nuke `doltgres_data` volume, run `pnpm dev:infra`, verify `knowledge_poly` has expected seed rows via psql — all arrived via `dolt_clone`, not a pnpm seed script
- CI: seed content change in a PR, merge to main, verify DoltHub repo receives a corresponding commit
- Candidate-a: after PR #772 lands + this task deploys, verify `knowledge_<node>` on the VM has content via `dolt_log`

## Related

- [spike.0318](./spike.0318.dolthub-knowledge-seeding-design.md) — design
- [task.0311](./task.0311.poly-knowledge-syntropy-seed.md) — local-dev predecessor
- PR #892 — current implementation of task.0311
- PR #772 — Doltgres on canary/prod (prerequisite)
- CogniDAO-Memory legacy repo — existing DoltHub `cogni/*` org footprint
