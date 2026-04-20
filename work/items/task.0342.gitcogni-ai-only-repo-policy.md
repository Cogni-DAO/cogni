---
id: task.0342
type: task
title: "gitcogni — ai-only-repo-policy rule: scope fence + auto-approve-when-green"
status: needs_design
priority: 1
estimate: 2
rank: 6
summary: "New gitcogni AI rule that canary PRs must satisfy. Enforces CANARY_SCOPE_FENCE (paths the canary may/may not touch) and enables auto-approval when standard CI + candidate-flight are green. No human reviewer required — AI PRs get merged on signal quality alone."
outcome: "`.cogni/rules/ai-only-repo-policy.yaml` exists and is wired into `.cogni/repo-spec.yaml` gates. A canary-authored PR that modifies only `nodes/canary/**` with green CI + green candidate-flight auto-merges. A canary-authored PR touching `infra/**` or other nodes auto-fails the gate."
spec_refs:
  - canary
  - gitcogni-rules
assignees: derekg1729
project: proj.cogni-canary
created: 2026-04-20
updated: 2026-04-20
labels: [canary, gitcogni, policy, autonomy]
external_refs:
  - .cogni/rules/
  - .cogni/repo-spec.yaml
---

# gitcogni ai-only-repo-policy

## Context

The canary is a PR-churn machine. Without a new policy:

- Every PR needs a human reviewer (unscalable)
- Scope fence is enforced only by author convention, not by the gate (brittle)

This rule makes the canary's autonomy enforceable by the bot, not by human vigilance.

## Policy shape

```yaml
id: cogni-git-review-ai-only-repo-policy
schema_version: "0.3"
blocking: true
workflow_id: ai-only-repo

evaluations:
  - scope_fence:
      description: PR only touches allowed paths
      allowed_paths:
        - "nodes/canary/**"
        - "work/items/**"
        - "docs/research/**"
      denied_paths:
        - ".github/workflows/**"
        - "scripts/ci/**"
        - "infra/**"
        - "work/charters/**"
        - "nodes/operator/**"
        - "nodes/poly/**"
        - "nodes/resy/**"
        - "nodes/node-template/**"
  - ci_green:
      description: Standard CI (pnpm check, pnpm check:full) passes
      required_checks: ["ci/check", "ci/check-full"]
  - candidate_flight_green:
      description: candidate-flight.yml reached Healthy + verify-buildsha
      required_checks: ["candidate-flight/verify-buildsha"]
  - author_allowlist:
      description: PR author is a canary-owned bot identity
      allowed_authors: ["canary-bot[bot]", "canary-4omini[bot]"]

success_criteria:
  all_of:
    - metric: scope_fence
      eq: true
    - metric: ci_green
      eq: true
    - metric: candidate_flight_green
      eq: true
    - metric: author_allowlist
      eq: true

auto_merge: true
```

## Deliverables

- [x] `.cogni/rules/ai-only-repo-policy.yaml` — policy file rooted in `docs/spec/ai-only-repo-policy.md`
- [x] `docs/spec/ai-only-repo-policy.md` — federated AI-rules spec (operator-owned infra, node-owned self, DAO override)
- [x] `docs/spec/node-ci-cd-contract.md` — `AI_RULES_FEDERATED` invariant added
- [ ] **gitcogni schema extensions** (blocks all below):
  - [ ] `scope.owner_node` + `scope.owns_paths` — declare authoritative paths per rule
  - [ ] `applies_when.all_of` with `author_in` + `affects_owned_paths` — CI-affected routing
  - [ ] `evaluations[].denied_paths` / `evaluations[].required_checks` — declarative gate eval
  - [ ] `evaluations[].override_source` — `cogni_signal` type reads DAO action events
  - [ ] `success_criteria.any_of` with nested `all_of` — override branch vs clean branch
  - [ ] `auto_merge: true` — invoke GitHub native `--auto`
  - [ ] `on_failure.action: comment_and_block` + templated `comment_template` with `{operator_propose_merge_url}` variable
- [ ] **CI-affected path routing** in cogni-git-review loader — mirror `scripts/ci/detect-affected.sh` algorithm when selecting which `.cogni/rules/*.yaml` files apply to a PR
- [ ] **DAO-override poller** in cogni-git-review — on PR-open and periodic re-check, query Alchemy / EVM RPC for `CogniAction(action="merge-pr", pr=N, sha=X)` events on operator DAO's CogniSignal. Reuse existing `handleSignal()` wiring where possible
- [ ] `.cogni/repo-spec.yaml` root gates block — add `- type: ai-rule / rule_file: ai-only-repo-policy.yaml`
- [ ] GitHub App / PAT for `canary-bot[bot]` — scoped write to `nodes/canary/**`, `work/items/**`, `docs/research/**` only
- [ ] Branch protection on `main` — require `ai-only-repo-policy` check for PRs from allowlisted bot authors
- [ ] Loki audit event: `pr_merged_by_dao_override` emitted every time the override path fires

## Validation

- `exercise:` — manually open a PR as `canary-bot` touching `infra/k8s/base/canary/kustomization.yaml`. The policy gate fails with `scope_fence: false`. Then open a PR touching only `nodes/canary/app/src/foo.ts`. Gate passes (assuming CI + candidate-flight pass).
- `observability:` — policy check event appears in gitcogni audit log for each canary PR; auto-merged PRs have `merged_by: canary-bot[bot]` in GitHub event stream.

## Non-goals

- Applying this policy to non-canary PRs (operator/poly/resy keep human review)
- Replacing human review for charter changes in `work/charters/**` (explicitly denied in scope)

## Open questions

- Does gitcogni's current schema support path-based allow/deny? Spot-check says **no** — this task starts with a gitcogni feature PR that adds the schema fields enumerated under "gitcogni schema extensions" above. The canary policy YAML cannot be enforced until that lands.
- Auto-merge mechanism: GitHub's native `--auto` flag vs. an explicit merge bot. Lean: native `--auto` is simpler.
- DAO-override re-check cadence: poll every 30s during PR open state, or subscribe to Alchemy webhooks and push? Webhooks are cheaper + faster but require the ingestion path to tolerate retries. Lean: reuse the existing `/api/internal/webhooks/alchemy` handler so we get dedup + RPC reverification for free.
- Multi-node bot identity: when a second AI-run node joins, do we add each bot to every rule's `author_in` list, or namespace `author_in` per rule? Lean: per-rule allowlist; operator rule lists all AI bots, node-local rules list only that node's bots.
