---
id: bug.0143
type: bug
title: "Selection policy hardcoded in ledger.ts — pipeline-agnostic layer contains GitHub-specific promotion logic"
status: needs_triage
priority: 0
rank: 10
estimate: 5
summary: "`materializeSelection` in ledger.ts contains ~100 lines of GitHub-specific production-promotion selection policy (baseBranch, mergeCommitSha cross-referencing, eventType branching). This violates the principle that ledger.ts is a pipeline-agnostic activity layer. Selection policy is not pluggable and `PipelineProfile` has no selection concept."
outcome: "Selection policy is owned by a pluggable component (profile, enricher, or new contract). `materializeSelection` in ledger.ts delegates to it. Adding a new selection policy (or a new source) requires zero edits to ledger.ts."
spec_refs: [attribution-pipeline-overview-spec, plugin-attribution-pipeline]
assignees: []
credit:
project:
branch:
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-03-07
updated: 2026-03-07
labels: [architecture, attribution, priority-0]
external_refs:
---

# Selection policy hardcoded in ledger.ts

## Requirements

### Observed

`materializeSelection` in `services/scheduler-worker/src/activities/ledger.ts:538-700` is supposed to be a generic pipeline activity that materializes selection rows for an epoch. Instead, it contains ~100 lines of hardcoded GitHub-specific, Cogni-workflow-specific production-promotion logic:

**1. Promotion SHA cross-referencing (lines 566-590)**

Iterates all receipts looking for `eventType === "pr_merged"` with `metadata.baseBranch === "main"`, extracts `commitShas`, and builds a `promotedShas` Set. This is Cogni's specific CI/CD promotion workflow (feature→staging→release→main) baked into the generic ledger layer.

```typescript
// ledger.ts:576-590
for (const receipt of allReceipts) {
  if (
    receipt.eventType === "pr_merged" &&
    (receipt.metadata as Record<string, unknown>).baseBranch === "main"
  ) {
    const commitShas = (receipt.metadata as Record<string, unknown>)
      .commitShas as string[] | undefined;
    if (commitShas) {
      for (const sha of commitShas) promotedShas.add(sha);
    }
  }
}
```

**2. Promoted PR number tracking for review matching (lines 592-610)**

Second pass over all receipts to find staging PRs whose `mergeCommitSha` is in the promoted set, building `promotedPrNumbers` for review cross-referencing. Parses receipt IDs to extract PR numbers.

**3. Hardcoded eventType branching for inclusion (lines 651-672)**

Explicit `if (receipt.eventType === "pr_merged")` / `else if (receipt.eventType === "review_submitted")` chain that determines `included` boolean. Any new event type or different selection policy requires editing this activity.

```typescript
// ledger.ts:653-672
if (receipt.eventType === "pr_merged") {
  if (meta.baseBranch === "main") {
    included = false;  // Release PR — reference only
  } else if (meta.mergeCommitSha && promotedShas.has(...)) {
    included = true;   // Promoted staging PR
  }
} else if (receipt.eventType === "review_submitted") {
  if (repo && prNum && promotedPrNumbers.has(`${repo}:${prNum}`)) {
    included = true;
  }
}
```

**4. Identity resolution is source-hardcoded (lines 631-640)**

```typescript
if (source === "github") {
  const result = await attributionStore.resolveIdentities("github", [...ids]);
}
// No other sources handled — silent no-op for non-GitHub
```

**5. `PipelineProfile` has no selection concept**

`packages/attribution-pipeline-contracts/src/profile.ts:39-67` defines `PipelineProfile` with `enricherRefs`, `allocatorRef`, `epochKind`, and `defaultWeightConfig` — but zero support for selection policy. Selection is completely outside the plugin architecture.

### Expected

- `ledger.ts` activities are pipeline-agnostic: they orchestrate steps (load receipts, call policy, write rows) but contain zero source-specific or workflow-specific logic.
- Selection policy is a pluggable contract: `PipelineProfile` (or a new contract) specifies which selection policy to use.
- Adding a new selection policy (e.g., "include all", "include by label", "promotion-based") requires implementing a contract, not editing ledger.ts.
- Identity resolution delegates to source adapters or a resolver registry, not a hardcoded `if/else`.

### Reproduction

Read `services/scheduler-worker/src/activities/ledger.ts:566-672` — the entire block is GitHub-specific promotion logic in what should be a generic pipeline activity.

Read `packages/attribution-pipeline-contracts/src/profile.ts:39-67` — no `selectionPolicy`, `selectionRef`, or equivalent field exists.

### Impact

- **Architecture violation**: ledger.ts is the pipeline-agnostic activity layer. Hardcoding a specific workflow's selection policy here defeats the plugin architecture.
- **Extension blocked**: any project forking this template with a different git workflow (trunk-based, GitLab, no promotion) must rewrite `materializeSelection` — they can't just swap a profile.
- **Testing burden**: external tests must set up the full staging→main promotion fixture flow to test selection, because there's no way to inject a simpler policy.
- **Related**: `bug.0132` covers the same class of problem for `deriveWeightConfigV0()` and `streams` config. This bug is specifically about selection policy, which is the most complex and deeply embedded instance.

## Allowed Changes

- `packages/attribution-pipeline-contracts/src/` — add `SelectionPolicy` contract or extend `PipelineProfile` with `selectionRef`
- `packages/attribution-pipeline-plugins/src/` — implement Cogni's promotion-based selection policy as a plugin
- `services/scheduler-worker/src/activities/ledger.ts` — `materializeSelection` delegates to the policy contract instead of inline logic
- `packages/attribution-pipeline-contracts/src/profile.ts` — add selection policy reference to `PipelineProfile`
- Identity resolution: extract to a resolver contract or source adapter method
- Tests covering the refactored selection path

## Plan

- [ ] Design `SelectionPolicy` contract (or equivalent) — decides `included` for each receipt given epoch context
- [ ] Add `selectionRef` (or similar) to `PipelineProfile`
- [ ] Implement Cogni's production-promotion policy as a plugin implementing the contract
- [ ] Refactor `materializeSelection` to load the policy from the profile and delegate
- [ ] Extract identity resolution to a pluggable resolver (per-source adapter or registry)
- [ ] Implement a simple "include-all" policy for testing and simpler deployments
- [ ] Update external tests to verify policy delegation, not just the promotion workflow
- [ ] Update attribution-pipeline-overview spec

## Validation

**Command:**

```bash
pnpm check && pnpm test
```

**Expected:** All tests pass. `materializeSelection` contains zero references to `baseBranch`, `mergeCommitSha`, `commitShas`, `pr_merged`, or `review_submitted`. Selection logic lives in `packages/attribution-pipeline-plugins/`.

## Review Checklist

- [ ] **Work Item:** `bug.0143` linked in PR body
- [ ] **Spec:** PROFILE_SELECTS_ALLOCATOR pattern extended to selection (PROFILE_SELECTS_SELECTION or equivalent)
- [ ] **Tests:** new/updated tests cover the change
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Related: [bug.0132](bug.0132.pipeline-config-source-coupling.md) — same class of coupling for weight derivation and streams config

## Attribution

- Claude (investigation and filing)
