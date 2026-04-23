---
id: task.0341
type: task
title: "Canary — self-scheduling brain loop + revenue-per-graph Dolt table"
status: needs_design
priority: 2
estimate: 5
rank: 5
summary: "Give the 4o-mini brain a governance charter that lets it propose its own future charters within the scope fence. Capture revenue + cost per graph in Dolt so the canary can learn what actors pay for."
outcome: "A hourly `CANARY_BRAIN_LOOP` charter runs 4o-mini with tools to (a) read current charters, (b) propose a new charter via PR to `nodes/canary/.cogni/repo-spec.yaml`, (c) read `canary_graph_revenue` to prioritize. PRs it opens are auto-gated by the `ai-only-repo` policy (task.0342). Monthly revenue ≥ cost ≥ 3 months → unlocks CP5."
spec_refs:
  - canary
  - governance-council
assignees: derekg1729
project: proj.cogni-canary
created: 2026-04-20
updated: 2026-04-20
labels: [canary, governance, 4o-mini, dolt, autonomy]
external_refs:
  - docs/spec/governance-council.md
  - work/items/task.0342.gitcogni-ai-only-repo-policy.md
---

# Canary self-scheduler

## Context

CP4's `SINGULARITY_SCORE_DAILY` proves the brain can run a pre-written charter. CP5 needs the brain to _write_ new charters — that's the "self-scheduling" loop. The brain's scope fence (enforced by the `ai-only-repo` gitcogni policy) means it cannot propose charters outside `nodes/canary/**` or entrypoints it doesn't own.

## Deliverables

- [ ] Governance charter `CANARY_BRAIN_LOOP` — cron `0 * * * *` (hourly), entrypoint `CANARY_BRAIN_LOOP`
- [ ] Brain graph `nodes/canary/graphs/brain-loop/graph.ts` — 4o-mini with tools:
  - `canary__read_charters` — read `nodes/canary/.cogni/repo-spec.yaml` `governance.schedules`
  - `canary__propose_charter` — open PR to add/modify a charter entry (scope-fenced)
  - `canary__read_revenue` — `SELECT * FROM canary_graph_revenue ORDER BY month DESC LIMIT 3`
  - `canary__propose_graph` — open PR with a new graph under `nodes/canary/graphs/<name>/`
- [ ] Dolt schema `canary_graph_revenue` (columns: `graph_name`, `month`, `revenue_usd`, `cost_usd`, `invocations`, `unique_callers`)
- [ ] Revenue ingestion — per-graph USDC receipts via x402 endpoint + cost from LiteLLM audit log
- [ ] Scope-fence enforcement at tool layer (not just policy layer) — `canary__propose_charter` refuses to write outside allowed entrypoint set
- [ ] Budget ceiling — LiteLLM per-key cap keeps each brain-loop run ≤ $0.05

## Validation

- `exercise:` — Manually invoke `CANARY_BRAIN_LOOP` once. The graph should open a PR (or explicitly log "no proposal this tick") within 30s. PR, if opened, must be within scope fence.
- `observability:` — Loki `{app="canary", graph="brain-loop"}` shows exactly one run per hour; Dolt `canary_graph_revenue` has ≥ 1 row within 30 days of deploy.

## Guardrails

- Scope-fence is enforced at THREE layers (defense in depth):
  1. Tool implementation refuses out-of-scope writes
  2. gitcogni `ai-only-repo` policy rejects PRs touching forbidden paths
  3. GitHub branch protection + PAT scope limit the blast radius if (1)+(2) are bypassed
- Claude models explicitly excluded from the brain-loop's allowed model list in LiteLLM config until CP5 revenue threshold clears.
- Human-review gate: any `canary__propose_graph` PR that touches new outbound credentials (non-public APIs, secrets) requires Derek approval regardless of other green checks.

## Non-goals

- Cross-node charter proposals (canary cannot write to operator/poly/resy)
- Self-funded Claude promotion (that's CP5 + explicit Derek sign-off)

## Open questions

- Should the brain's PR title/body include its reasoning chain or just the diff? Lean: include reasoning as a folded-summary block; it's valuable for postmortem even if noisy.
