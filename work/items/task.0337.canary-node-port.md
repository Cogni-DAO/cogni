---
id: task.0337
type: task
title: "Canary — port nodes/node-template → nodes/canary"
status: needs_implement
priority: 1
estimate: 3
rank: 1
summary: "Mechanical port of `nodes/node-template` to `nodes/canary` with name, port, and node_id replacements. Scaffold only; green CI is task.0338 territory."
outcome: "`nodes/canary/` exists on disk with a working package name, port (3400), repo-spec entry, and a minimal `/api/singularity` stub route. `pnpm --filter @cogni/canary-app build` locally produces output. CI wiring is deferred to task.0338."
spec_refs:
  - canary
assignees: derekg1729
project: proj.cogni-canary
created: 2026-04-20
updated: 2026-04-20
labels: [canary, scaffold, port]
external_refs:
  - nodes/node-template/
  - .cogni/repo-spec.yaml
---

# Port node-template → canary

## Context

First node port in the repo since poly/resy were created. The mechanical port is the cheap part; the expensive part (CI + k8s) is task.0338.

## Deliverables

- [x] `nodes/canary/` created by copying `nodes/node-template/`
- [x] `nodes/canary/app/package.json` → `@cogni/canary-app`, dev port `3400`, start port `3400`
- [x] `.cogni/repo-spec.yaml` — add canary entry under `nodes:` with new UUID `89612f02-114d-460d-87a5-c2ab212ccf6f` and endpoint `http://canary:3400/api/internal/billing/ingest`
- [x] `nodes/canary/.cogni/repo-spec.yaml` — per-node stub with TODOs for DAO contract addresses (filled by task.0339)
- [ ] `src/app/api/singularity/route.ts` — stub handler returning `{ score: 50, reasoning: "placeholder" }` (real synth = task.0340)

## Validation

- `exercise:` — `pnpm --filter @cogni/canary-app build` exits 0 (local).
- `observability:` — N/A this PR. Real validation is after task.0338 lands CI + flight.

## Non-goals

- CI green (task.0338)
- Real confidence-score synthesis (task.0340)
- Real DAO addresses (task.0339)

## Risks

- Copying node-template brings along unused `@cogni/*` workspace deps; prune aggressively but be prepared to re-add when the real app grows.
- Port 3400 must not collide with anything in `infra/compose/` — verify before commit (operator=3000, poly=3100, resy=3300, node-template=3200).
