---
id: proj.cogni-canary
type: project
primary_charter:
title: "Cogni Canary — 4o-mini-Brained Self-Sustaining Node"
state: Active
priority: 1
estimate: 5
summary: First fully AI-operated node in the Cogni repo. Sole brain is 4o-mini (with haiku/kimi/deepseek fallbacks). Self-schedules via DAO governance charters. Goal = ethical revenue that funds its own upgrade to a heavier brain before a human would.
outcome: A working `nodes/canary/` node with its own DAO, its own Privy-owned operator wallet (2-signer with Derek), scope-fenced PR autonomy, and a measurable "universe → AI singularity" confidence score exposed at `/api/singularity`. Revenue-per-graph feedback loop captured in Dolt so the canary learns which langgraph graphs actors pay for.
assignees: derekg1729
created: 2026-04-20
updated: 2026-04-20
labels: [canary, ai-autonomous, dao, 4o-mini, ethical-profit]
---

# Cogni Canary — 4o-mini-Brained Self-Sustaining Node

## Mission

A canary is a node the AI runs end-to-end: it writes its own PRs, schedules its own governance jobs, and is funded by whatever revenue it earns. **The brain is 4o-mini** (plus haiku/kimi/deepseek as fallbacks) because we cannot afford to run Claude for this loop until the canary's own revenue justifies an upgrade. That constraint _is_ the experiment: can a cheap model produce more consistent ethical profit with a node than humans do, before humans catch up?

Knowledge goal tracked in Dolt: **what langgraph graphs would actors pay for?**

## Why this exists

- **Safe blast radius** — scope fence keeps the AI's PRs inside `nodes/canary/**`, `docs/research/**`, and its own work items. It cannot touch CI, infra, other nodes, or charters.
- **Cheap enough to run continuously** — 4o-mini + free models make unbounded loops affordable. Claude is aspirational, gated by canary's own revenue.
- **Confidence-score-as-heartbeat** — the singularity score (0-100, reasoning attached) is the simplest possible "is this system alive and producing signal?" probe.
- **Forces the graph-economics question** — instead of guessing what graphs are useful, the canary ships them and gets paid (or not).

## Scope fence (invariant `CANARY_SCOPE_FENCE`)

The canary's PR autonomy is scoped to:

- `nodes/canary/**`
- `work/items/**` (new and owned items only; cannot edit others)
- `docs/research/**`

Denied paths (enforced by gitcogni policy — see `task.0342`):

- `.github/workflows/**`
- `scripts/ci/**`
- `infra/**`
- `work/charters/**`
- Any other `nodes/<name>/**` than canary

## Goal hierarchy

```
Singularity confidence score published daily
        ↑
Ethical revenue per month > operating cost
        ↑
Graphs that actors pay for (learned in Dolt)
        ↑
Self-scheduled 4o-mini brain + scope-fenced PR loop
        ↑
Fresh DAO (Derek + canary Privy wallet) + infra
```

Left-to-right reads as "what unlocks what." Each rung below must be true for the one above to exist.

## Roadmap

### CP1 — Scaffold (this PR)

**Goal:** All the paperwork is in place so an AI loop can take over; no CI green expected yet.

| Deliverable                                     | Status | Work Item |
| ----------------------------------------------- | ------ | --------- |
| Project work item + task list                   | Done   | this file |
| `nodes/canary/` skeleton ported from node-template | Done   | task.0337 |
| `infra/catalog/canary.yaml`                     | Done   | task.0338 |
| `.cogni/repo-spec.yaml` nodes entry             | Done   | task.0337 |
| `docs/guides/new-node-formation.md`             | Done   | (this PR) |
| `docs/guides/create-service-review.md`          | Done   | (this PR) |
| DAO formation runbook for Derek                 | Done   | task.0339 |
| `.cogni/rules/ai-only-repo-policy.yaml` stub    | Done   | task.0342 |

### CP2 — Green CI + flight-ready (follow-up PR)

**Goal:** `pnpm check` passes, `pnpm check:full` passes, canary builds + flights to `candidate-a`.

| Deliverable                                                | Work Item |
| ---------------------------------------------------------- | --------- |
| Wire `canary` target into `scripts/ci/detect-affected.sh`  | task.0338 |
| Wire build recipe in `build-and-push-images.sh`            | task.0338 |
| Wire digest resolver in `resolve-pr-build-images.sh`       | task.0338 |
| Add `canary` to `scripts/ci/wait-for-argocd.sh` APPS list  | task.0338 |
| Add `infra/k8s/base/canary/` + overlays (candidate-a, preview) | task.0338 |
| Caddy subdomain mapping (`canary-preview.cognidao.org`)    | task.0338 |
| DNS records + Cloudflare                                   | task.0338 |
| `candidate-a-applicationset.yaml` picks up canary          | task.0338 |

### CP3 — DAO formation + Privy wallet (Derek-gated)

**Goal:** On-chain DAO exists, 2-signer (Derek + canary Privy wallet), repo-spec updated with real addresses.

| Deliverable                                              | Work Item |
| -------------------------------------------------------- | --------- |
| Create canary Privy-managed operator wallet              | task.0339 |
| Run formation wizard with Derek + Privy wallet as signers | task.0339 |
| Paste DAO/plugin/signal addresses into `nodes/canary/.cogni/repo-spec.yaml` | task.0339 |
| Fund canary wallet with $20 USDC operating cushion       | task.0339 |

### CP4 — The brain + scheduler (first AI-run PRs)

**Goal:** 4o-mini runs on a cron charter, reads the singularity score, and can propose new charter schedules within the scope fence.

| Deliverable                                                             | Work Item |
| ----------------------------------------------------------------------- | --------- |
| `/api/singularity` route returning `{ score, reasoning, sources[] }`    | task.0340 |
| Signal-ingest graph — GitHub AI-PR velocity, arxiv LLM papers, etc.     | task.0340 |
| Daily synth graph — 4o-mini synthesizes signals → score + reasoning     | task.0340 |
| Governance charter: `SINGULARITY_SCORE_DAILY` (cron 0 12 \* \* \*)      | task.0340 |
| Governance charter: `CANARY_BRAIN_LOOP` — 4o-mini plans next PR         | task.0341 |
| Scope-fence enforcement in brain loop (cannot propose charters outside allowed entrypoints) | task.0341 |
| Dolt table `canary_graph_revenue` — per-graph revenue + cost            | task.0341 |

### CP4.5 — Hard validation gates (before calling anything "proven")

**Goal:** No claim about canary being "live" until both gates pass with real inputs.

| Gate | Claim                                                             | Runbook                                                   | Work Item |
| ---- | ----------------------------------------------------------------- | --------------------------------------------------------- | --------- |
| A    | External agent completes PR lifecycle (fork → flight → merge) with ZERO human clicks | `docs/runbooks/GATE_A_EXTERNAL_PR_FLIGHT.md`              | task.0345 |
| B    | New agent registers, wallet gets funded, paid Kimi K2 call hits ledger | `docs/runbooks/GATE_B_PAID_AGENT_VALIDATION.md`           | task.0345 |

Gate A's public flight surface is missing today — `task.0344` ships the `POST /api/v1/vcs/flight-candidate` HTTP route. Gate B can run first since all its dependencies (register, payments, LiteLLM) already exist on main; it needs Derek to fund the wallet with $2 USDC one time.

Success criteria (both gates):
- Every step is a documented API call or tool call (no `gh` CLI, no browser click)
- Success is observable: on-chain confirmation (Gate B) OR GitHub event stream (Gate A)
- Failures surface discoverable remediation (DAO-vote override, budget top-up, etc.)

### CP5 — Revenue proof (long-lived)

**Goal:** The canary earns ≥ its monthly cost for 3 consecutive months. Then we promote the brain to Claude Haiku (next-cheapest Anthropic model) and measure the delta.

Graphs the canary should try (prior beliefs, not commitments):

- Prediction-market price extraction as a service
- "Summarize this PR for a non-engineer" callable via x402
- Cheap classification-as-a-service (webhook → 4o-mini → label)
- Singularity score subscription feed

Actual winners will be learned, not designed.

## Constraints

- **CANARY_SCOPE_FENCE** — see above. Violations = automatic PR rejection.
- **Budget ceiling** — canary's monthly model spend must not exceed `min($20, revenue_last_30d + $20 cushion)`. Enforced by LiteLLM per-key limits, not trust.
- **No Claude on the brain path** — Claude models are disallowed for the scheduled brain loop until CP5 threshold is met. Ad-hoc human-invoked Claude calls (e.g. Derek debugging) are fine; the scheduled 4o-mini charter path is the enforced seat.
- **Ethical profit only** — no market manipulation, no scraping against ToS, no impersonation. When in doubt the brain must open a human-review issue rather than act.
- **2-signer DAO** — Derek + canary Privy wallet. Canary cannot unilaterally move treasury; any on-chain action needs Derek's co-sign until CP5+.

## Immediate deliverables (this PR)

1. [x] `proj.cogni-canary.md` (this file)
2. [x] `task.0337` — node port
3. [x] `task.0338` — infra catalog + CI wiring
4. [x] `task.0339` — DAO formation runbook
5. [x] `task.0340` — confidence-score app
6. [x] `task.0341` — self-scheduler charter
7. [x] `task.0342` — gitcogni `ai-only-repo` policy
8. [x] `docs/guides/new-node-formation.md`
9. [x] `docs/guides/create-service-review.md`
10. [x] `work/runbooks/canary-dao-formation.md`
11. [x] `nodes/canary/` scaffold
12. [x] `docs/guides/external-agent-onboarding.md` — zero-human PR lifecycle for external agents
13. [x] `task.0344` — public `/api/v1/vcs/flight-candidate` HTTP route (gap for Gate A)
14. [x] `task.0345` — Gate A + Gate B hard validation criteria + runbooks
15. [x] `docs/runbooks/GATE_A_EXTERNAL_PR_FLIGHT.md`, `docs/runbooks/GATE_B_PAID_AGENT_VALIDATION.md`
16. [x] `/.well-known/agent.json` updated to link external-agent-onboarding guide
12. [x] `infra/catalog/canary.yaml`
13. [x] `.cogni/repo-spec.yaml` nodes entry
14. [x] `.cogni/rules/ai-only-repo-policy.yaml` stub

## Out of scope (explicit)

- Claude-as-the-brain (gated on CP5)
- Multi-signer DAO beyond Derek + Privy (gated on CP5)
- Mobile app access (canary is backend-only)
- Graphs that are known-unethical or ToS-violating

## Related

- [task.0336.rust-node-platform-runway](../items/task.0336.rust-node-platform-runway.md) — orthogonal rust runway; canary is TS because node-template is TS
- [proj.node-formation-ui](proj.node-formation-ui.md) — the formation wizard the canary uses
- [proj.tenant-connections](proj.tenant-connections.md) — Privy wallet infra the canary piggybacks on
- [proj.agentic-project-management](proj.agentic-project-management.md) — the PR-lifecycle skills the canary invokes
