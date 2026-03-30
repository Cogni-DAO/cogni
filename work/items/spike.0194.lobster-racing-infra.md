---
id: spike.0194
type: spike
title: "Spike: Lobster Racing infrastructure and provisioning research"
status: needs_triage
priority: 1
rank: 99
estimate: 2
summary: "Research how to dynamically provision and fund competing OpenClaw instances for lobster racing."
outcome: "Answered research questions with a recommended architecture for race provisioning, funding, and judging."
spec_refs:
assignees: [derekg1729]
credit:
project:
branch:
pr:
reviewer:
revision: 0
blocked_by:
deploy_verified: false
created: 2026-03-23
updated: 2026-03-23
labels: []
external_refs:
---

# Spike: Lobster Racing infrastructure and provisioning research

## Context

Before building lobster racing (`story.0193`), we need to answer key infrastructure questions about provisioning, funding, and judging.

## Research Questions

1. **OpenClaw provisioning at scale** -- Are there existing OSS OpenClaw + Terraform setups for spinning up N instances dynamically? What does the provisioning flow look like? Can we use our existing Docker/OpenTofu stack or do we need something new?

2. **Web3 wallet funding** -- How do CogniDAO agent wallets work today? Can we programmatically create per-lobster wallets and fund them from a race prize pool? What chain/token is used?

3. **Race isolation** -- How do we ensure lobsters can't see each other's work? Separate containers? Network isolation? Filesystem isolation is already handled by OpenClaw workspaces but need to confirm for competitive scenarios.

4. **Judging mechanism** -- How do we evaluate task completion? Options:
   - Human judge reviews outputs
   - Automated test suite (if task has programmatic success criteria)
   - LLM-as-judge (another agent evaluates outputs)
   - Hybrid: automated check + LLM tiebreaker

5. **Cost control** -- Each lobster burns AI tokens. How do we cap spend per lobster? Use existing LiteLLM proxy billing? Hard wallet limits?

6. **Prize payout** -- On-chain transaction from pool to winner's wallet. What's the simplest path using existing CogniDAO infra?

## Allowed Changes

- Research only -- no code changes expected
- Output: written findings added to this item or a linked doc

## Plan

- [ ] Survey existing OSS OpenClaw deployment setups (Terraform, Docker Compose, etc.)
- [ ] Map CogniDAO wallet creation and funding flows
- [ ] Prototype: spin up 2 OpenClaw instances with separate wallets
- [ ] Evaluate judging approaches for a sample task
- [ ] Write up findings and recommended architecture

## Validation

**Expected:** Research questions above are answered with enough detail to scope `story.0193` into implementable tasks.

## Review Checklist

- [ ] **Work Item:** `spike.0194` linked in PR body
- [ ] **Spec:** all invariants of linked specs are upheld
- [ ] **Tests:** N/A (spike)
- [ ] **Reviewer:** assigned and approved

## PR / Links

- Parent story: `story.0193`

## Attribution

-
