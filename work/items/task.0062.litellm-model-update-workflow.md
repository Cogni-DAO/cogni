---
id: task.0062
type: task
title: "Standardized LiteLLM model update workflow — REQUIRED billing validation for all new models"
status: needs_design
priority: 1
estimate: 2
summary: "No process ensures billing accuracy when adding models to litellm.config.yaml. Opus 4.6 shipped with $0 cost tracking because LiteLLM's pricing table didn't have it. Need a checklist/test gate that validates response_cost > 0 for paid models before production deployment."
outcome: "Adding a new model to litellm.config.yaml requires passing a billing validation step (automated or documented checklist) that confirms response_cost is non-zero for paid models. No paid model reaches production without verified cost tracking."
spec_refs:
assignees: derekg1729
credit:
project: proj.reliability
branch:
pr:
reviewer:
created: 2026-02-14
updated: 2026-02-14
labels: [billing, litellm, process, reliability]
external_refs:
revision: 0
blocked_by:
deploy_verified: false
rank: 9
---

# Standardized LiteLLM model update workflow — REQUIRED billing validation

## Context

pm.billing-observability-gaps.2026-02-14: `claude-opus-4.6` was added to `litellm.config.yaml` and deployed to production without verifying that LiteLLM could report accurate cost. LiteLLM computes `response_cost` from its internal pricing table, NOT from OpenRouter's actual billed cost. When a model is missing from the table, LiteLLM silently returns `response_cost: 0` — no error, no warning. Result: $10-20+ in untracked OpenRouter spend.

The `/litellm-free-models` skill already updates free models but has no billing validation step. Paid model additions are ad-hoc.

## Requirements

1. **Billing validation gate**: Before any new paid model reaches production, verify that `response_cost > 0` for a test call. This can be:
   - A stack test that makes one call per configured paid model and asserts `response_cost > 0` in the callback
   - A documented manual checklist in the model update skill/process
   - A pre-deploy smoke test

2. **Cost authority documentation**: Document that OpenRouter is the billing source of truth, not LiteLLM's pricing table. If LiteLLM can be configured to pass through provider-reported cost instead of recomputing, prefer that.

3. **Update `/litellm-free-models` skill** (or create companion skill) to include paid model validation steps.

## Acceptance Criteria

- No paid model can be added to `litellm.config.yaml` without a validated billing check
- Process is documented and discoverable (in skill, AGENTS.md, or runbook)
- Ideally automated (stack test), but documented checklist is acceptable as P0

## Validation

- For ANY new paid model added to litellm.config.yaml, run the billing validation gate and confirm `response_cost > 0`

## Related

- pm.billing-observability-gaps.2026-02-14 — incident that motivated this
- bug.0060 — fix cost authority (OpenRouter cost passthrough)
- task.0029 — callback billing (the pipeline this validates)
