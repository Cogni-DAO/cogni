---
id: spike.0318
type: spike
title: "Spike: DoltHub-Backed Knowledge Seeding — Design + Ownership Model"
status: needs_triage
priority: 1
rank: 1
estimate: 2
summary: "Design how per-node knowledge seed content flows from code/DoltHub into knowledge_poly (and future knowledge_<node>) databases on provision. Decides repo layout (per-node vs central), content-ownership model (TS source-of-truth vs Dolt-native vs hybrid), dolt_clone wiring in deploy-infra.sh, and creds/secrets flow. Current row-INSERT seed path (task.0311 / PR #892) is a local-dev stopgap that does not deploy to VMs."
outcome: "A clear design doc + rejected alternatives + tasks to implement. Answers: where do seeds live? How do they land in prod? Who edits them? How do we rotate creds?"
spec_refs:
  - knowledge-data-plane-spec
  - knowledge-syntropy
assignees: derekg1729
project: proj.poly-prediction-bot
created: 2026-04-17
updated: 2026-04-17
labels: [knowledge, doltgres, dolthub, spike, design]
---

# Spike: DoltHub-Backed Knowledge Seeding — Design + Ownership Model

> Spec: [knowledge-data-plane](../../docs/spec/knowledge-data-plane.md) · [knowledge-syntropy](../../docs/spec/knowledge-syntropy.md)
> Blocks: task.0319 (implementation)
> Follows: PR #892 (local-dev seed content + upsert bug fix — merges first)
> Depends on: PR #772 (Doltgres on canary/prod — prerequisite for any prod seeding)

## Question

How does per-node knowledge seed content (today: 13 Polymarket strategy entries in `@cogni/poly-knowledge`) land in `knowledge_poly` on candidate / preview / prod, given that nobody runs `pnpm` scripts on VMs and today's seed script is local-dev only?

## Context

PR #892 (task.0311) ships substantive seed content for `knowledge_poly` and fixes an `upsertKnowledge()` bug. The delivery mechanism is `scripts/db/seed-doltgres.mts` — row INSERTs via `capability.write()` against a connected Doltgres. **It runs only when a human invokes `pnpm db:seed:doltgres:poly` locally.** There is zero prod integration: no migrator-image analogue, no deploy-infra.sh step, no k8s Job.

Parallel gating facts:

- **PR #772** (OPEN, CONFLICTING) is the only path that puts Doltgres on candidate/prod at all. Without it, nothing Doltgres-related deploys.
- **`cogni` DoltHub org already exists** with active creds (seen in the legacy `CogniDAO-Memory/.env` — `DOLTHUB_API_KEY_WRITE`, `DOLTHUB_JWK_CREDENTIAL`). Legacy repo is `cogni/cogni-dao-memory`. New node-knowledge repos would live in the same org.
- **Per-node package convention** (PR #887) has nodes consume their own scoped packages (`@cogni/poly-graphs` merged with `@cogni/langgraph-graphs` at `poly-catalog.ts`). Knowledge seeding should follow that pattern rather than bolt knowledge packages into root deps.

## Key questions

1. **Repo layout on DoltHub** — per-node repos (`cogni/poly-knowledge-seeds`, `cogni/resy-knowledge-seeds`, …) mirroring the per-node package model, or one repo with branches/tags per node? **Strawman: per-node.** Matches Doltgres DB isolation; `dolt_clone cogni/poly-knowledge-seeds → knowledge_poly` is a 1:1 mental model; forks take their own repo.

2. **Content ownership** — the real decision:

   | Model      | Source of truth                                              | Edit flow                                                   | Runtime delivery                                                         |
   | ---------- | ------------------------------------------------------------ | ----------------------------------------------------------- | ------------------------------------------------------------------------ |
   | TS-first   | `nodes/<node>/packages/knowledge/src/seeds/*.ts`             | Git PR                                                      | CI pushes TS → DoltHub on main merge; runtime `dolt_clone`s from DoltHub |
   | Dolt-first | DoltHub repo                                                 | `dolt` CLI or DoltHub web UI; PRs on DoltHub, not this repo | Runtime `dolt_clone`s; TS package deleted                                |
   | Hybrid     | TS for schema + compile-time types; DoltHub for content rows | Schema changes: Git PR; content: DoltHub                    | Runtime `dolt_clone`s + app imports TS types                             |

   **Strawman: TS-first.** Humans review seed changes in git PRs (review audit trail matters for strategy content). Dolt gets content-versioning + remote clone at runtime. Single source of authoritative edits.

3. **Provision wiring** — where does `dolt_clone` run?
   - Strawman: extend `infra/compose/runtime/doltgres-init/provision.sh` to, after `CREATE DATABASE knowledge_<node>`, run `dolt_clone https://doltremoteapi.dolthub.com/cogni/<node>-knowledge-seeds → knowledge_<node>` for each provisioned DB.
   - Alternative: separate `doltgres-seed` compose service that runs post-provision, isolating network egress.

4. **Creds flow** — `DOLTHUB_API_KEY_WRITE` is needed for CI push (TS → DoltHub). `dolt_clone` for public repos needs no creds. For private repos we'd also need creds on the VM. Strawman: public seed repos (content is strategy knowledge, not secrets), no VM creds needed; CI gets the write key via GitHub env secret.

5. **Migration from today's row-INSERT path** — once DoltHub delivery lands, what happens to:
   - `scripts/db/seed-doltgres.mts` — retained as dev-convenience that reads local TS → local Doltgres, or deleted in favor of always-local `dolt_clone`?
   - Root workspace deps added by PR #892 — should be removed once DoltHub is the runtime path (they were only there for the root-level seed script to resolve node packages).

6. **Dev workflow** — does a dev editing seed content need a DoltHub account and push access? Or does the TS-first model mean dev writes TS, CI does the DoltHub push, dev never touches DoltHub directly?

## Findings to produce

1. Decision + rationale on each of 1–6.
2. Exact commands / DDL for `dolt_clone` flow (test against local Doltgres first).
3. CI workflow sketch (push TS → DoltHub on `main` merge).
4. Updated `provision.sh` draft (not final, but concrete enough to file task.0319).
5. Migration plan for content currently in `@cogni/poly-knowledge` — initial `dolt_push` from local state, or write a one-shot converter.
6. Open risks: DoltHub uptime, clone latency during provision, schema-drift between TS types and Dolt tables.

## Proposed deliverable

Design doc at `docs/design/knowledge-dolthub-seeding.md` + task.0319 (implementation) filed with concrete scope.

## Validation

Spike output is a design doc, not code. Success criteria:

- All 6 key questions have a decision + rationale
- Concrete draft of `dolt_clone`-based provision flow included
- task.0319 acceptance criteria locked down

## Related

- [task.0311](./task.0311.poly-knowledge-syntropy-seed.md) — current row-INSERT seeding (local-dev stopgap)
- PR #892 — the above task's implementation
- PR #772 — Doltgres on canary/prod (prerequisite, currently CONFLICTING)
- PR #887 — per-node langgraph pattern (analogue for knowledge packaging)
- [knowledge-syntropy spec](../../docs/spec/knowledge-syntropy.md)
- [CogniDAO-Memory legacy repo](/Users/derek/dev/CogniDAO-Memory) — reference for existing DoltHub `cogni/cogni-dao-memory` integration (do NOT copy its tooling)
