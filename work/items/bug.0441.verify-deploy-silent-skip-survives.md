---
id: bug.0441
type: bug
title: "verify-deploy step-level `if:` is the silent-green primitive bug.0321 was supposed to kill"
status: needs_implement
priority: 0
rank: 1
estimate: 2
summary: "OBSERVED: 2026-04-30 02:09 + 02:29 promote-and-deploy runs for sha ef56dc95 reported `verify-deploy (operator): success` even though operator wasn't in the affected set and no real verification ran. Steps gated by `if: steps.cell.outputs.promoted == 'true'` were skipped, but the *job* was green. Operators read this as 'preview deploy succeeded' when in reality preview was still serving the broken NULLS LAST image. EXPECTED: When a node isn't promoted in a run, verify-deploy for that node surfaces as visibly skipped (grey check), not green. REPRO: Push a PR touching only one node (e.g. poly), watch promote-and-deploy — every other node's verify-deploy job will say success without exercising the deploy. IMPACT: Hides genuine deploy failures behind affected-only false-positives. Today's preview outage was prolonged because operators trusted the green checks."
outcome: "verify-deploy uses a job-level gate (needs/if at the job declaration) tied to the per-cell promoted status. Empty-promotion jobs surface as skipped (grey), not success. The `release-slot.Decide lease state` pattern (already used elsewhere per skill notes for bug.0321) is the reference."
spec_refs: []
assignees: []
credit:
project: proj.cicd-services-gitops
branch:
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-04-30
updated: 2026-04-30
labels: [ci, observability, deploy, p0]
external_refs:
---

# verify-deploy silent-skip survived bug.0321 fix

## Problem

`.github/workflows/promote-and-deploy.yml` `verify-deploy` job has step-level `if: steps.cell.outputs.promoted == 'true'` on every meaningful step (Setup SSH, Wait for in-cluster services, verify-buildsha). When `cell.promoted == 'false'` (this node wasn't in the affected set), all real steps are skipped. The job conclusion = success.

The skill (`devops-expert`) explicitly flags this anti-pattern:

> **Step-level `if:` for verification gates.** GitHub treats a skipped _step_ inside a running job as contributing to job success. When a verification should be allowed to skip (e.g. empty `promoted_apps`), model it as a _job-level_ gate with `needs:` and `if:` — the job then surfaces as visibly skipped (grey in the checks list), not green. Step-level `if: promoted_apps != ''` is the silent-green primitive that bug.0321 hunted down.

bug.0321 was supposed to eliminate this pattern. It survived in `verify-deploy`.

## Today's evidence

Run 25199435389 for sha `ef56dc95` (poly-only PR):

```
verify-deploy (operator):       success   ← ran 8 seconds, all real steps skipped
verify-deploy (poly):           success
verify-deploy (resy):           success
verify-deploy (scheduler-worker): success
```

Operators read this as "all deploys verified". In reality only poly was actually checked. Operator was still serving the broken NULLS LAST image (bug.0438 / #1162's fix not yet rolled because of a different unrelated issue, bug.0439).

## Approach

Convert `verify-deploy` to a job-level conditional:

```yaml
verify-deploy:
  needs: [decide, promote-k8s, deploy-infra, resolve-cell]
  if: needs.resolve-cell.outputs.promoted == 'true'
```

Or split into a separate `resolve-cell` job per matrix node so the job condition can read it. Then `verify-deploy` either runs (and verifies) OR is visibly skipped — never silently green.

## Validation

A poly-only PR's promote-and-deploy run shows:

- `verify-deploy (poly): success`
- `verify-deploy (operator): skipped` (grey)
- `verify-deploy (resy): skipped`
- `verify-deploy (scheduler-worker): skipped`

Operators can trust green = real verification.
