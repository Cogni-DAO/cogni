---
id: bug.0132
type: bug
title: "Pipeline config leaks source-specific knobs into repo-spec; weight derivation divorced from plugin system"
status: needs_triage
priority: 1
rank: 99
estimate: 3
summary: "repo-spec `streams` field is GitHub-specific config masquerading as operator config; `deriveWeightConfigV0()` is hardcoded in the workflow instead of owned by the profile/allocator; identity resolution only handles GitHub. The spec (attribution-pipeline-overview) describes the intended source-agnostic design — the code doesn't match."
outcome: "Operator configures `attribution_pipeline` + `source_refs` only. Streams, weight derivation, and identity resolution are owned by profiles/plugins, not leaked into repo-spec or hardcoded in the workflow."
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
created: 2026-03-03
updated: 2026-03-03
labels: [architecture, attribution]
external_refs:
---

# Pipeline config leaks source-specific knobs into repo-spec

## Requirements

### Observed

Three related coupling issues where the code doesn't match the intended design in `attribution-pipeline-overview.md`:

**1. `streams` is a GitHub implementation detail exposed as operator config**

`repo-spec.yaml` requires operators to specify `streams: ["pull_requests", "reviews", "issues"]`, but these values are only meaningful to the GitHub adapter. The workflow iterates over them (`collect-epoch.workflow.ts:153`), but there is no validation that a given source adapter actually supports the declared streams.

- Schema: `packages/repo-spec/src/schema.ts:92` — `streams: z.array(z.string().min(1)).min(1)`
- Workflow iteration: `services/scheduler-worker/src/workflows/collect-epoch.workflow.ts:153` — `for (const stream of sourceConfig.streams)`
- GitHub adapter hard-returns the same list: `services/scheduler-worker/src/adapters/ingestion/github.ts:218` — always `["pull_requests", "reviews", "issues"]`

An operator could set `streams: ["pull_requests"]` thinking they opt out of issue tracking, but `deriveWeightConfigV0()` would still produce weights for `github:issue_closed`.

**2. `deriveWeightConfigV0()` is hardcoded in the workflow, not owned by the profile**

Weight derivation lives as a standalone function in the workflow (`collect-epoch.workflow.ts:229-241`), completely outside the plugin system. It hardcodes GitHub-specific weight keys regardless of what `streams` or `attribution_pipeline` says:

```typescript
function deriveWeightConfigV0(sources) {
  if (source === "github") {
    weights["github:pr_merged"] = 1000;
    weights["github:review_submitted"] = 500;
    weights["github:issue_closed"] = 300;
  }
}
```

Per contracts AGENTS.md, `PROFILE_SELECTS_ALLOCATOR` means the profile is the sole authority for allocation behavior. But the weight config — which directly determines credit distribution — bypasses the profile entirely.

**3. Identity resolution only handles GitHub**

`materializeSelection` in `services/scheduler-worker/src/activities/ledger.ts:530` only branches on `source === "github"` with `// TODO: add discord etc. when sources expand`. Adding a new source requires editing this activity, violating the plugin architecture's goal of source-agnostic extensibility.

### Expected

Per the attribution-pipeline-overview spec and the contracts AGENTS.md principles:

- `attribution_pipeline` (profile selection) should be the **single knob** that determines enrichers, allocator, AND weight derivation strategy
- `source_refs` is legitimate operator config ("where to look")
- `streams` should be determined by the source adapter or the profile, not by the operator
- Weight derivation should be owned by the allocator plugin or the profile, not hardcoded in the workflow
- Identity resolution should be pluggable per source, not a hardcoded `if/else` chain

### Reproduction

Read `services/scheduler-worker/src/workflows/collect-epoch.workflow.ts:229-241` — `deriveWeightConfigV0()` is a standalone function that ignores the profile and hardcodes GitHub weights.

Read `.cogni/repo-spec.yaml:30` — `streams` field that no operator should need to touch.

### Impact

- **Operator confusion**: `streams` looks configurable but changing it creates inconsistency with hardcoded weights
- **Plugin architecture violation**: adding a new source (Discord, GitLab) requires editing the workflow and identity resolution activity, not just adding a plugin
- **Design debt**: the longer this ships, the more code accumulates around the hardcoded patterns

## Allowed Changes

- `packages/repo-spec/src/schema.ts` — make `streams` optional or remove
- `packages/attribution-pipeline-contracts/src/profile.ts` — extend PipelineProfile if weight config ownership moves here
- `packages/attribution-pipeline-plugins/src/profiles/` — profiles own their weight derivation
- `services/scheduler-worker/src/workflows/collect-epoch.workflow.ts` — remove `deriveWeightConfigV0()`, delegate to profile/allocator
- `services/scheduler-worker/src/activities/ledger.ts` — pluggable identity resolution
- `.cogni/repo-spec.yaml` — simplify `activity_sources` config
- Tests for all of the above

## Plan

- [ ] Design: decide where weight config derivation belongs (profile vs allocator vs new contract)
- [ ] Move `deriveWeightConfigV0` logic into the plugin system (profile or allocator descriptor)
- [ ] Make `streams` either derived from the source adapter or optional in repo-spec schema
- [ ] Extract identity resolution into a pluggable source adapter method
- [ ] Update repo-spec.yaml to remove `streams` if no longer needed
- [ ] Update attribution-pipeline-overview spec if design changes
- [ ] Update tests

## Validation

**Command:**

```bash
pnpm check && pnpm test
```

**Expected:** All tests pass. `deriveWeightConfigV0` no longer exists as a standalone workflow function. Repo-spec schema no longer requires `streams`.

## Review Checklist

- [ ] **Work Item:** `bug.0132` linked in PR body
- [ ] **Spec:** PROFILE_SELECTS_ALLOCATOR invariant upheld — weight config owned by plugin system
- [ ] **Tests:** new/updated tests cover the change
- [ ] **Reviewer:** assigned and approved

## PR / Links

-

## Attribution

-
