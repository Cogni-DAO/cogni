---
id: spec.ai-only-repo-policy
type: spec
title: AI-Only Repo Policy — Federated AI Authorship Rules
status: active
trust: draft
summary: How AI-run nodes author PRs inside the Cogni monorepo without human review, while preserving operator-level gates on shared infrastructure. Enforced by cogni-git-review; override path is a DAO vote.
read_when: Authoring a new AI-run node, changing the gitcogni scope model, auditing the canary's PR flow, or deciding who owns which policy file.
implements: proj.cogni-canary
owner: derekg1729
created: 2026-04-20
verified: 2026-04-20
tags: [gitcogni, governance, ai, canary, scope-fence]
---

# AI-Only Repo Policy — Federated AI Authorship Rules

## Context

Cogni's canary project (`proj.cogni-canary`) ships a 4o-mini-brained node that authors its own PRs. Without policy, every AI PR needs a human reviewer (unscalable) or the bot escapes its scope (unsafe). This spec defines the shape of the enforcement model so every future AI-run node inherits the same pattern.

## Goals

- AI PRs merge without human review when they stay inside their declared scope and pass CI + flight.
- AI PRs are hard-blocked from touching shared infrastructure (CI, k8s, charters, other nodes).
- Every block is overridable by a DAO vote — human governance is always the ceiling.
- Every policy file is owned by exactly one node. No centralized rule registry.

## Non-Goals

- Replacing human review for _human_-authored PRs (standard gates unchanged).
- Deciding which models a node may use (that's per-node config in `.cogni/repo-spec.yaml` `providers`).
- Cross-repo enforcement (this spec is monorepo-local; fork forks get their own copy).

## Core Invariants

1. **NODE_OWNS_AI_RULES.** Each node's AI authorship rules live under its own tree:
   - Operator → `/.cogni/rules/*.yaml` (repo-wide infra scope)
   - Child node → `nodes/<name>/.cogni/rules/*.yaml` (node-local scope only)

2. **OPERATOR_OWNS_INFRA_SCOPE.** Paths under `infra/`, `.github/workflows/`, `scripts/ci/`, `work/charters/`, `packages/`, `services/`, `.cogni/rules/`, `.cogni/repo-spec.yaml`, and `nodes/operator/` are gated by the operator's rules. No child-node rule can soften the operator rule for these paths.

3. **NODE_OWNS_SELF_SCOPE.** Paths under `nodes/<name>/` are gated by `<name>`'s own rules. The child node can set stricter rules than the operator for its own tree.

4. **CI_AFFECTED_ROUTING.** cogni-git-review computes the affected path set (same algorithm as `scripts/ci/detect-affected.sh`) and loads the union of applicable rule files:
   - PR touches only `nodes/canary/**` → load canary's rule files
   - PR touches `infra/**` → load operator's rule files
   - PR touches both → load both; if any rule blocks, PR is blocked (strictest wins)

5. **DAO_OVERRIDE_IS_CEILING.** Any blocked PR may be merged via a successful DAO vote emitting a `merge-pr` CogniAction on the operator DAO's CogniSignal. The signal-execution handler (`docs/spec/governance-signal-execution.md`) is the sole override path. There is no admin bypass.

6. **BOT_IDENTITY_BINDS_SCOPE.** Each AI-run node registers its bot identity (`canary-bot[bot]`, `canary-4omini[bot]`, future nodes analogous) in the operator's rule `applies_when.author_in` list. Only these identities are subject to AI-only rules; human authors fall through to standard review.

7. **POLICY_STAYS_LOCAL.** Rule files are plain YAML in the repo. No runtime fetching. No centralized policy server. Forks inherit by cloning (per `node-ci-cd-contract` § POLICY_STAYS_LOCAL + FORK_FREEDOM).

## Design

### Enforcement topology

```
┌─────────────────────────────────────────────────────────────────┐
│  PR opened by canary-bot[bot]                                   │
└────────────────────────┬────────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│  cogni-git-review (operator node)                               │
│                                                                 │
│  1. Compute affected paths (detect-affected.sh algorithm)       │
│  2. Load applicable rule files (union)                          │
│     • operator owns: infra, CI, workflows, packages, services   │
│     • canary owns:   nodes/canary/**                            │
│     • operator ALSO owns: .cogni/rules/**, .cogni/repo-spec.yaml│
│  3. Evaluate each rule against the PR diff                      │
│  4. Check DAO override (CogniSignal merge-pr event)             │
│  5. Block (with comment) OR auto-merge                          │
└────────────────────────┬────────────────────────────────────────┘
                         ▼
                  ┌──────────────┐
                  │ block + DAO  │
                  │ vote option  │
                  └──────────────┘
                         │
                         │  DAO member initiates tx
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│  Aragon TokenVoting → CogniSignal.execute() → CogniAction event │
│  → Alchemy webhook → handleSignal() → GitHub PR merge           │
└─────────────────────────────────────────────────────────────────┘
```

### Rule file location rules

| Path prefix                         | Rule owner | Rule file location                              |
| ----------------------------------- | ---------- | ----------------------------------------------- |
| `nodes/canary/**`                   | canary     | `nodes/canary/.cogni/rules/*.yaml` (future)     |
| `nodes/operator/**`, `infra/**`, `scripts/ci/**`, `.github/workflows/**`, `work/charters/**`, `packages/**`, `services/**`, `.cogni/rules/**`, `.cogni/repo-spec.yaml` | operator | `.cogni/rules/*.yaml` (repo root) |
| `work/items/**` (bot-authored)      | author's node | rule set by author's node |
| `docs/research/**`                  | author's node | rule set by author's node |

For v0, only `.cogni/rules/ai-only-repo-policy.yaml` exists (operator-owned, covers the paths canary's bot must not touch). Canary-specific rules (e.g. budget caps, model allowlist) live in `nodes/canary/.cogni/repo-spec.yaml` `gates:` block.

### Rule schema fields

See [`.cogni/rules/ai-only-repo-policy.yaml`](../../.cogni/rules/ai-only-repo-policy.yaml) for the canonical instance. Key fields git-cogni must support:

| Field                    | Purpose                                                        |
| ------------------------ | -------------------------------------------------------------- |
| `scope.owner_node`       | Which node owns this rule                                       |
| `scope.owns_paths`       | Paths this rule is authoritative for                            |
| `applies_when.author_in` | Bot allowlist; non-matching authors skip this rule              |
| `applies_when.affects_owned_paths` | Only fire when PR touches paths this rule owns        |
| `evaluations[].denied_paths` | Hard-deny regardless of CI state                            |
| `evaluations[].required_checks` | Required GitHub check conclusions                        |
| `evaluations[].override_source` | Declares DAO-signal override path                        |
| `success_criteria.any_of` | Allow override branch vs normal pass branch                    |
| `on_failure.action` + `comment_template` | Loud failures surface override instructions    |

Fields that are not yet in gitcogni schema are listed in [`task.0342`](../../work/items/task.0342.gitcogni-ai-only-repo-policy.md) as the implementation checklist.

### DAO-vote override — end-to-end

1. Bot's PR is blocked (scope violation, CI red, etc.).
2. Failure comment includes a deep link to `/propose/merge?dao=...&plugin=...&pr=N&sha=...` on the operator app.
3. A human DAO member signs the `createProposal` tx via the operator app.
4. Voting period passes (operator DAO's current TokenVoting config).
5. Proposal executes → `CogniSignal.execute()` → `CogniAction(action="merge-pr", pr=N, sha=X)`.
6. Alchemy fires the configured webhook → `/api/internal/webhooks/alchemy`.
7. `handleSignal()` decodes the event, reverifies via RPC, calls `octokit.pulls.merge()`.
8. PR merges. cogni-git-review's auto-merge path is bypassed; the DAO path wins.

The override is observable: every bypass emits a `pr_merged_by_dao_override` audit event to Loki.

## Acceptance Checks

**Automated:**

- cogni-git-review loads this rule file and applies it only to allowlisted bot authors.
- A bot PR touching only `nodes/canary/**` passes (assuming CI + flight green) without human approval.
- A bot PR touching `infra/**` is hard-blocked with `scope_fence: false`.
- A blocked PR can be merged after the configured CogniAction event is emitted on the operator DAO's CogniSignal.

**Manual:**

1. Open a test PR as `canary-bot` that touches `infra/k8s/overlays/canary/kustomization.yaml`. Verify: `ai-only-repo-policy` fails with `scope_fence: false`, and the comment includes the override deep link.
2. Submit a DAO vote via the deep link. After execution, verify: PR merges, Loki audit event logged.
3. Open a test PR as `canary-bot` that touches only `nodes/canary/app/src/foo.ts`. Verify: CI + flight run, auto-merge fires, no human reviewer requested.

## Federation — adding a new AI-run node

When a second AI-run node (say `labrat`) is introduced:

1. Register its bot identity in the operator rule's `applies_when.author_in` list.
2. Add `nodes/labrat/**` to the scope fence's `denied_paths` for _other_ bots (a node's bot cannot touch siblings).
3. The labrat node declares its own stricter rules under `nodes/labrat/.cogni/rules/` or within `nodes/labrat/.cogni/repo-spec.yaml` `gates:`.
4. The DAO-override path is already shared — the operator DAO is the single override authority regardless of node.

No change to this spec is required; the model generalizes.

## Related

- [Node CI/CD Contract](./node-ci-cd-contract.md) — canonical invariants (FORK_FREEDOM, POLICY_STAYS_LOCAL, AI_RULES_FEDERATED)
- [Governance Signal Execution](./governance-signal-execution.md) — CogniSignal → GitHub action flow used by the override
- [Node Formation](./node-formation.md) — how child nodes get DAOs
- [.cogni/rules/ai-only-repo-policy.yaml](../../.cogni/rules/ai-only-repo-policy.yaml) — the canonical rule
- [proj.cogni-canary](../../work/projects/proj.cogni-canary.md) — first consumer
- [task.0342](../../work/items/task.0342.gitcogni-ai-only-repo-policy.md) — gitcogni schema extensions required
