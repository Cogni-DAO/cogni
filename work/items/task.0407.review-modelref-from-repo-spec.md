---
id: task.0407
type: task
title: "Wire per-node/per-rule review.modelRef from repo-spec into PR review pipeline"
status: needs_design
priority: 1
rank: 1
estimate: 2
branch:
summary: "PR review currently uses a hardcoded `DEFAULT_REVIEW_MODELREF = { providerKey: 'platform', modelId: 'gpt-4o-mini' }` in `services/scheduler-worker/src/activities/review.ts`. Each sovereign node should be able to declare its own review model — globally per node and optionally per rule — via repo-spec. This task designs the schema slot, override semantics, resolver, and migration story, then wires `fetchPrContextActivity` to honor it. Builds on the `ModelRef`-shape adoption that landed alongside #1067."
outcome: "(1) `repo-spec` schema gains a `review.model: ModelRef` slot at the spec level and an optional `model: ModelRef` on individual rules — both validated by zod. (2) `fetchPrContextActivity` resolves the effective `modelRef` per rule using rule-override → spec-default → hardcoded fallback. (3) At least one sovereign node ships a non-default `review.model` to prove the path works (e.g. resy or poly using `gpt-4o`). (4) Operator-rules-at-root edge case handled (spec lives at repo root for operator vs `nodes/<x>/.cogni/repo.yaml` for sovereign nodes — see task.0380). (5) Stack test covering rule-level override beats spec-level default."
spec_refs:
assignees: derekg1729
credit:
project:
pr:
reviewer:
revision: 1
blocked_by: []
deploy_verified: false
created: 2026-04-27
updated: 2026-04-27
labels: [review, repo-spec, modelref, ai]
external_refs:
  - work/items/task.0380.node-base-path-resolver.md
---

## Context

PR-review's parent workflow (`packages/temporal-workflows/src/workflows/pr-review.workflow.ts`) calls `fetchPrContextActivity` which today returns a hardcoded `modelRef` (was `model: string` until this PR). The activity already parses repo-spec and per-rule YAMLs (`services/scheduler-worker/src/activities/review.ts:269-308`), so the _plumbing_ to read a config-driven model is in place — only the schema slot and resolver are missing.

Per `task.0380.node-base-path-resolver.md:130`, the per-node `review.model` field was identified as a follow-on, gated behind nodeId threading. nodeId threading is **already complete** (`pr-review.workflow.ts:37,67,126`), so this task is unblocked.

`providerKey: "platform"` (LiteLLM-backed, `requiresConnection = false`) is the canonical system-actor provider; sovereign nodes that want a different brain should be able to override.

## Design questions to resolve

1. **Slot location.** Top-level `review.model` on the repo-spec, or nested under `gates.review-limits`? Recommend top-level — gates are about pass/fail policy, not LLM choice.
2. **Per-rule override.** Add optional `model: ModelRef` to `ruleSchema` directly, or to the `ai-rule` gate's `with:` block? Recommend on the rule itself — the rule _is_ the AI prompt, the gate just dispatches to it.
3. **Resolver order.** Rule-level → spec-level → DEFAULT. Codify in `fetchPrContextActivity`.
4. **Operator vs sovereign edge case.** Operator's repo-spec lives at repo root; sovereign nodes' specs live at `nodes/<x>/.cogni/repo.yaml`. Make sure resolver picks the right spec given `nodeId` in workflow input.
5. **Validation.** Should we constrain `providerKey` to a known enum, or accept any string and let the providers registry reject at execution time?

## Out of scope

- Per-user `connectionId` on review modelRefs (system actor only — no user auth in webhook path).
- BYO-AI for review (separate, much larger scope).

## Files likely to touch

- `packages/repo-spec/src/schema.ts` — add `review.model` + optional `rule.model`
- `packages/repo-spec/src/accessors.ts` — `getReviewModelRef(spec, ruleId?)` resolver
- `services/scheduler-worker/src/activities/review.ts` — call resolver, drop the constant
- `nodes/<one>/.cogni/repo.yaml` — proof fixture
- `tests/component/review/` or stack test — exercise rule-level override

## Validation

- **exercise:** flip `review.model` on `nodes/poly/.cogni/repo.yaml` to `{ providerKey: "platform", modelId: "gpt-4o" }`, push a PR that touches `nodes/poly/`, then check that `Cogni Git PR Review` reports a successful review using `gpt-4o` (not `gpt-4o-mini`).
- **observability:** Loki query `{component="webhook-route"} |= "PrReviewWorkflow"` followed by `{service="scheduler-worker", workflowId=~"pr-review:.*"} |= "modelRef"` should show the resolved per-rule modelRef logged by `fetchPrContextActivity` at the deployed candidate-a SHA.
